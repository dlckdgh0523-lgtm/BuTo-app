import { readFileSync } from "node:fs";
import https from "node:https";

export interface TossPayCreatePaymentResult {
  payToken: string;
  orderId: string;
  amount: number;
  raw?: unknown;
}

export interface TossPayExecuteResult {
  transactionId?: string;
  status?: string;
  payMethod?: string;
  refundableAmount?: number;
  raw?: unknown;
}

export interface TossPayStatusResult {
  transactionId?: string;
  status?: string;
  payMethod?: string;
  refundableAmount?: number;
  raw?: unknown;
}

export interface TossPayRefundResult {
  transactionId?: string;
  status?: string;
  payMethod?: string;
  refundableAmount?: number;
  raw?: unknown;
}

export interface TossPayProvider {
  createPayment(input: {
    orderId: string;
    userKey: string;
    amount: number;
    productDescription: string;
    testMode: boolean;
  }): Promise<TossPayCreatePaymentResult>;
  executePayment(input: {
    payToken: string;
    userKey: string;
    testMode: boolean;
  }): Promise<TossPayExecuteResult>;
  getPaymentStatus(input: {
    payToken: string;
    userKey: string;
  }): Promise<TossPayStatusResult>;
  refundPayment(input: {
    transactionId: string;
    userKey: string;
    reason: string;
    testMode: boolean;
  }): Promise<TossPayRefundResult>;
}

interface MtlsConfig {
  cert: string;
  key: string;
  ca?: string;
}

export class RealTossPayProvider implements TossPayProvider {
  constructor(
    private readonly env = process.env,
    private readonly transport = {
      postJson: requestJsonMtls
    }
  ) {}

  async createPayment(input: {
    orderId: string;
    userKey: string;
    amount: number;
    productDescription: string;
    testMode: boolean;
  }): Promise<TossPayCreatePaymentResult> {
    const response = await this.transport.postJson<Record<string, unknown>>(
      `${this.requireBaseUrl()}/api-partner/v1/apps-in-toss/pay/make-payment`,
      {
        orderNo: input.orderId,
        amount: input.amount,
        productDescription: input.productDescription,
        testMode: input.testMode
      },
      {
        "x-toss-user-key": input.userKey
      },
      this.getMtlsConfig()
    );

    return {
      payToken: String(response.payToken ?? ""),
      orderId: String(response.orderNo ?? input.orderId),
      amount: Number(response.amount ?? input.amount),
      raw: response
    };
  }

  async executePayment(input: {
    payToken: string;
    userKey: string;
    testMode: boolean;
  }): Promise<TossPayExecuteResult> {
    const response = await this.transport.postJson<Record<string, unknown>>(
      `${this.requireBaseUrl()}/api-partner/v1/apps-in-toss/pay/execute-payment`,
      {
        payToken: input.payToken,
        testMode: input.testMode
      },
      {
        "x-toss-user-key": input.userKey
      },
      this.getMtlsConfig()
    );

    return this.normalizeStatusResponse(response);
  }

  async getPaymentStatus(input: {
    payToken: string;
    userKey: string;
  }): Promise<TossPayStatusResult> {
    const response = await this.transport.postJson<Record<string, unknown>>(
      `${this.requireBaseUrl()}/api-partner/v1/apps-in-toss/pay/get-payment-status`,
      {
        payToken: input.payToken
      },
      {
        "x-toss-user-key": input.userKey
      },
      this.getMtlsConfig()
    );

    return this.normalizeStatusResponse(response);
  }

  async refundPayment(input: {
    transactionId: string;
    userKey: string;
    reason: string;
    testMode: boolean;
  }): Promise<TossPayRefundResult> {
    const response = await this.transport.postJson<Record<string, unknown>>(
      `${this.requireBaseUrl()}/api-partner/v1/apps-in-toss/pay/refund-payment`,
      {
        transactionId: input.transactionId,
        reason: input.reason,
        testMode: input.testMode
      },
      {
        "x-toss-user-key": input.userKey
      },
      this.getMtlsConfig()
    );

    return this.normalizeStatusResponse(response);
  }

  private normalizeStatusResponse(response: Record<string, unknown>) {
    return {
      transactionId: response.transactionId ? String(response.transactionId) : undefined,
      status: response.status ? String(response.status) : response.paymentStatus ? String(response.paymentStatus) : undefined,
      payMethod: response.payMethod ? String(response.payMethod) : undefined,
      refundableAmount: response.refundableAmount ? Number(response.refundableAmount) : undefined,
      raw: response
    };
  }

  private requireBaseUrl() {
    return this.env.TOSS_PAY_BASE_URL ?? "https://pay-apps-in-toss-api.toss.im";
  }

  private getMtlsConfig(): MtlsConfig {
    const certPath = this.requireEnv("TOSS_PARTNER_CERT_PATH");
    const keyPath = this.requireEnv("TOSS_PARTNER_KEY_PATH");
    const caPath = this.env.TOSS_PARTNER_CA_PATH;

    return {
      cert: readFileSync(certPath, "utf8"),
      key: readFileSync(keyPath, "utf8"),
      ca: caPath ? readFileSync(caPath, "utf8") : undefined
    };
  }

  private requireEnv(name: string) {
    const value = this.env[name];
    if (!value) {
      throw new Error(`Missing Toss pay configuration: ${name}`);
    }

    return value;
  }
}

function requestJsonMtls<T>(
  url: string,
  payload: Record<string, unknown>,
  headers: Record<string, string>,
  mtls: MtlsConfig
) {
  return new Promise<T>((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "POST",
        cert: mtls.cert,
        key: mtls.key,
        ca: mtls.ca,
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          ...headers
        }
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        response.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          const statusCode = response.statusCode ?? 0;
          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`Toss pay request failed with ${statusCode}: ${raw}`));
            return;
          }

          try {
            resolve((raw ? JSON.parse(raw) : {}) as T);
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    request.on("error", reject);
    request.write(JSON.stringify(payload));
    request.end();
  });
}
