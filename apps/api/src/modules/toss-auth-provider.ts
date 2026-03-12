import { readFileSync } from "node:fs";
import https from "node:https";

import { productConfig } from "../../../../packages/config/src/index.ts";
import type { FaceAuthIntent } from "../../../../packages/contracts/src/index.ts";

export interface TossLoginExchangeResult {
  ciHash: string;
  userKey?: string;
  authenticatedAt: string;
  raw?: unknown;
}

export interface TossOneTouchStartResult {
  providerRequestId: string;
  txId: string;
  requestUrl?: string;
  expiresAt: string;
  raw?: unknown;
}

export interface TossOneTouchCompleteResult {
  status: "SUCCESS" | "PENDING" | "FAIL" | "CANCELLED";
  providerTransactionId?: string;
  ciHash?: string;
  verifiedAt?: string;
  raw?: unknown;
}

export interface TossAuthProvider {
  exchangeLoginAuthorizationCode(input: { authorizationCode: string }): Promise<TossLoginExchangeResult>;
  startOneTouchAuth(input: { userCiHash: string; intent: FaceAuthIntent; userId: string }): Promise<TossOneTouchStartResult>;
  completeOneTouchAuth(input: { providerRequestId: string; txId: string }): Promise<TossOneTouchCompleteResult>;
}

interface MtlsConfig {
  cert: string;
  key: string;
  ca?: string;
}

interface TokenResponse {
  accessToken?: string;
  access_token?: string;
}

export class RealTossAuthProvider implements TossAuthProvider {
  constructor(
    private readonly env = process.env,
    private readonly transport = {
      postJson: postJsonMtls,
      getJson: getJsonMtls
    }
  ) {}

  async exchangeLoginAuthorizationCode(input: { authorizationCode: string }): Promise<TossLoginExchangeResult> {
    const mtls = this.getMtlsConfig();
    const loginTokenUrl = this.requireEnv("TOSS_LOGIN_TOKEN_URL");
    const loginMeUrl = this.requireEnv("TOSS_LOGIN_ME_URL");
    const partnerClientId = this.requireEnv("TOSS_PARTNER_CLIENT_ID");
    const partnerClientSecret = this.requireEnv("TOSS_PARTNER_CLIENT_SECRET");

    const token = await this.transport.postJson<TokenResponse>(loginTokenUrl, {
      authorizationCode: input.authorizationCode,
      clientId: partnerClientId,
      clientSecret: partnerClientSecret
    }, mtls);

    const accessToken = token.accessToken ?? token.access_token;
    if (!accessToken) {
      throw new Error("Toss login token response did not include an access token");
    }

    const profile = await this.transport.getJson<Record<string, unknown>>(loginMeUrl, {
      authorization: `Bearer ${accessToken}`
    }, mtls);

    const ciHash = String(profile.ciHash ?? profile.ci ?? "");
    if (!ciHash) {
      throw new Error("Toss login profile did not include CI");
    }

    return {
      ciHash,
      userKey: profile.userKey ? String(profile.userKey) : undefined,
      authenticatedAt: String(profile.authenticatedAt ?? new Date().toISOString()),
      raw: profile
    };
  }

  async startOneTouchAuth(input: { userCiHash: string; intent: FaceAuthIntent; userId: string }): Promise<TossOneTouchStartResult> {
    const certOauthUrl = this.requireEnv("TOSS_CERT_TOKEN_URL");
    const certRequestUrl = this.requireEnv("TOSS_CERT_REQUEST_URL");
    const clientId = this.requireEnv("TOSS_CERT_CLIENT_ID");
    const clientSecret = this.requireEnv("TOSS_CERT_CLIENT_SECRET");
    const requestUrl = this.requireEnv("TOSS_CERT_REQUEST_URL_SCHEME");

    const oauth = await postFormUrlEncoded<TokenResponse>(certOauthUrl, {
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "ca"
    });

    const accessToken = oauth.accessToken ?? oauth.access_token;
    if (!accessToken) {
      throw new Error("Toss cert token response did not include an access token");
    }

    const request = await postJsonBearer<Record<string, unknown>>(certRequestUrl, accessToken, {
      requestType: "USER_NONE",
      requestUrl,
      userIdentifier: input.userCiHash,
      requestMetadata: {
        intent: input.intent,
        userId: input.userId
      }
    });

    const txId = String(request.txId ?? "");
    if (!txId) {
      throw new Error("Toss cert request did not include txId");
    }

    return {
      providerRequestId: String(request.requestId ?? txId),
      txId,
      requestUrl: String(request.requestUrl ?? requestUrl),
      expiresAt: String(request.expiresAt ?? new Date(Date.now() + productConfig.faceAuthWindowMinutes * 60_000).toISOString()),
      raw: request
    };
  }

  async completeOneTouchAuth(input: { providerRequestId: string; txId: string }): Promise<TossOneTouchCompleteResult> {
    const certOauthUrl = this.requireEnv("TOSS_CERT_TOKEN_URL");
    const certStatusUrl = this.requireEnv("TOSS_CERT_STATUS_URL");
    const certResultUrl = this.requireEnv("TOSS_CERT_RESULT_URL");
    const clientId = this.requireEnv("TOSS_CERT_CLIENT_ID");
    const clientSecret = this.requireEnv("TOSS_CERT_CLIENT_SECRET");

    const oauth = await postFormUrlEncoded<TokenResponse>(certOauthUrl, {
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "ca"
    });

    const accessToken = oauth.accessToken ?? oauth.access_token;
    if (!accessToken) {
      throw new Error("Toss cert token response did not include an access token");
    }

    const status = await postJsonBearer<Record<string, unknown>>(certStatusUrl, accessToken, {
      txId: input.txId
    });

    const normalizedStatus = String(status.status ?? "").toUpperCase();
    if (normalizedStatus && normalizedStatus !== "DONE" && normalizedStatus !== "SUCCESS") {
      return {
        status: normalizedStatus === "PENDING" ? "PENDING" : normalizedStatus === "CANCELLED" ? "CANCELLED" : "FAIL",
        raw: status
      };
    }

    const result = await postJsonBearer<Record<string, unknown>>(certResultUrl, accessToken, {
      txId: input.txId
    });

    return {
      status: String(result.status ?? "SUCCESS").toUpperCase() as TossOneTouchCompleteResult["status"],
      providerTransactionId: String(result.txId ?? input.txId),
      ciHash: result.userCi ? String(result.userCi) : result.ciHash ? String(result.ciHash) : undefined,
      verifiedAt: String(result.authenticatedAt ?? new Date().toISOString()),
      raw: result
    };
  }

  private requireEnv(name: string) {
    const value = this.env[name];
    if (!value) {
      throw new Error(`Missing Toss auth configuration: ${name}`);
    }

    return value;
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
}

function requestJson<T>(
  url: string,
  options: https.RequestOptions,
  body?: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = https.request(url, options, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        const statusCode = response.statusCode ?? 0;
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`Toss request failed with ${statusCode}: ${raw}`));
          return;
        }

        try {
          resolve((raw ? JSON.parse(raw) : {}) as T);
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("error", reject);
    if (body) {
      request.write(body);
    }
    request.end();
  });
}

async function postJsonMtls<T>(url: string, payload: Record<string, unknown>, mtls: MtlsConfig) {
  return requestJson<T>(url, {
    method: "POST",
    cert: mtls.cert,
    key: mtls.key,
    ca: mtls.ca,
    headers: {
      "content-type": "application/json",
      accept: "application/json"
    }
  }, JSON.stringify(payload));
}

async function getJsonMtls<T>(url: string, headers: Record<string, string>, mtls: MtlsConfig) {
  return requestJson<T>(url, {
    method: "GET",
    cert: mtls.cert,
    key: mtls.key,
    ca: mtls.ca,
    headers: {
      accept: "application/json",
      ...headers
    }
  });
}

async function postFormUrlEncoded<T>(url: string, payload: Record<string, string>) {
  return requestJson<T>(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json"
    }
  }, new URLSearchParams(payload).toString());
}

async function postJsonBearer<T>(url: string, accessToken: string, payload: Record<string, unknown>) {
  return requestJson<T>(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      accept: "application/json"
    }
  }, JSON.stringify(payload));
}
