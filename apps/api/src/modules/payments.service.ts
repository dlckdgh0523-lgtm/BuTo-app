import { fail, ok, type ApiResponse, type FaceAuthValidity, type PaymentLedgerEntry } from "../../../../packages/contracts/src/index.ts";
import { evaluatePayoutRelease } from "../../../../packages/policy/src/index.ts";

import type { ApiRuntimeConfig } from "../env.ts";
import type { PersistenceAdapter } from "../persistence.ts";
import type { InMemoryStore, StoredJob } from "../store.ts";
import type { AuthService } from "./auth.service.ts";
import type { TossPayExecuteResult, TossPayProvider, TossPayRefundResult, TossPayStatusResult } from "./toss-pay-provider.ts";
import { createId, nowIso } from "../utils.ts";

export class PaymentsService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly authService: AuthService,
    private readonly persistence: PersistenceAdapter,
    private readonly tossPayProvider: TossPayProvider,
    private readonly runtimeConfig: ApiRuntimeConfig
  ) {}

  async initPayment(jobId: string, clientUserId: string) {
    const job = this.store.jobs.get(jobId);
    if (!job || job.clientUserId !== clientUserId) {
      return fail("PAYMENT_INIT_NOT_ALLOWED", "결제 주문을 생성할 수 없어요.");
    }

    if (job.status !== "PAYMENT_PENDING") {
      return fail("PAYMENT_INIT_NOT_ALLOWED", "이 의뢰 상태에서는 결제를 시작할 수 없어요.");
    }

    const client = this.store.users.get(clientUserId);
    if (!client?.tossUserKey) {
      return fail("PAYMENT_INIT_NOT_ALLOWED", "토스 로그인 userKey가 없어서 결제를 시작할 수 없어요.");
    }

    const existing = [...this.store.payments.values()].find((entry) => entry.jobId === jobId);
    if (existing?.payToken) {
      return ok(this.toPaymentInitResponse(existing));
    }

    const feeAmount = calculateFeeAmount(job.offerAmount);
    const payment: PaymentLedgerEntry = {
      paymentId: createId("pay"),
      jobId,
      userId: clientUserId,
      orderId: createId("order"),
      status: "INITIATED",
      amountTotal: job.offerAmount + feeAmount,
      heldAmount: job.offerAmount,
      feeAmount
    };
    this.store.payments.set(payment.paymentId, payment);

    try {
      const created = await this.tossPayProvider.createPayment({
        orderId: payment.orderId,
        userKey: client.tossUserKey,
        amount: payment.amountTotal,
        productDescription: job.title,
        testMode: this.runtimeConfig.tossPayTestMode
      });

      payment.payToken = created.payToken;
      await this.persistence.withTransaction(async (tx) => {
        await tx.upsertPayment(payment);
        await tx.enqueueOutboxEvent({
          eventId: createId("evt"),
          aggregateType: "PAYMENT",
          aggregateId: payment.paymentId,
          eventType: "PAYMENT_INITIATED",
          payload: {
            paymentId: payment.paymentId,
            jobId,
            orderId: payment.orderId,
            payToken: payment.payToken,
            feeAmount: payment.feeAmount
          },
          availableAt: nowIso()
        });
      });

      return ok(this.toPaymentInitResponse(payment));
    } catch (error) {
      this.store.payments.delete(payment.paymentId);
      return fail("PAYMENT_PROVIDER_INIT_FAILED", "토스페이 결제 준비에 실패했어요.", {
        reason: error instanceof Error ? error.message : "unknown"
      });
    }
  }

  async confirmPayment(jobId: string, clientUserId: string, paymentOrderId: string, faceAuthSessionId: string) {
    const job = this.store.jobs.get(jobId);
    if (!job || job.clientUserId !== clientUserId) {
      return fail("PAYMENT_CONFIRM_NOT_ALLOWED", "결제를 승인할 수 없어요.");
    }

    const payment = [...this.store.payments.values()].find(
      (entry) => entry.jobId === jobId && entry.orderId === paymentOrderId && entry.userId === clientUserId
    );

    if (!payment?.payToken) {
      return fail("PAYMENT_NOT_FOUND", "결제 주문을 찾을 수 없어요.");
    }

    if (job.status !== "PAYMENT_PENDING") {
      return fail("PAYMENT_CONFIRM_NOT_ALLOWED", "이 의뢰 상태에서는 결제를 승인할 수 없어요.");
    }

    if (!["INITIATED", "AUTHENTICATED"].includes(payment.status)) {
      return fail("PAYMENT_CONFIRM_NOT_ALLOWED", "이미 처리된 결제예요.");
    }

    const client = this.store.users.get(clientUserId);
    if (!client?.tossUserKey) {
      return fail("PAYMENT_CONFIRM_NOT_ALLOWED", "토스 로그인 userKey가 없어서 결제를 승인할 수 없어요.");
    }

    const paymentSnapshot = structuredClone(payment);
    const jobSnapshot = structuredClone(job);
    const faceAuthSession = this.store.faceAuthSessions.get(faceAuthSessionId);
    const faceAuthSnapshot = faceAuthSession ? structuredClone(faceAuthSession) : undefined;
    let faceAuthError: ApiResponse<FaceAuthValidity> | undefined;

    const faceAuth = await this.authService.consumeFaceAuth(clientUserId, faceAuthSessionId, "PAYMENT_CONFIRM");
    if (faceAuth.resultType === "ERROR") {
      faceAuthError = faceAuth;
    }
    if (faceAuthError) {
      return faceAuthError;
    }

    payment.status = "AUTHENTICATED";
    try {
      await this.persistence.upsertPayment(payment);
    } catch (error) {
      this.store.payments.set(payment.paymentId, paymentSnapshot);
      this.store.jobs.set(job.jobId, jobSnapshot);
      if (faceAuthSnapshot) {
        this.store.faceAuthSessions.set(faceAuthSessionId, faceAuthSnapshot);
      }
      throw error;
    }

    let providerResult: TossPayExecuteResult | TossPayStatusResult;
    try {
      providerResult = await this.tossPayProvider.executePayment({
        payToken: payment.payToken,
        userKey: client.tossUserKey,
        testMode: this.runtimeConfig.tossPayTestMode
      });
    } catch (error) {
      try {
        providerResult = await this.tossPayProvider.getPaymentStatus({
          payToken: payment.payToken,
          userKey: client.tossUserKey
        });
      } catch (statusError) {
        this.store.payments.set(payment.paymentId, paymentSnapshot);
        this.store.jobs.set(job.jobId, jobSnapshot);
        if (faceAuthSnapshot) {
          this.store.faceAuthSessions.set(faceAuthSessionId, faceAuthSnapshot);
        }
        return fail("PAYMENT_CONFIRM_PENDING", "결제 승인 응답을 바로 확인하지 못했어요. 상태 조회로 다시 확인해 주세요.", {
          reason: error instanceof Error ? error.message : "unknown",
          statusReason: statusError instanceof Error ? statusError.message : "unknown"
        });
      }
    }

    try {
      return await this.applyProviderStatus(payment, job, providerResult, true);
    } catch (error) {
      this.store.payments.set(payment.paymentId, paymentSnapshot);
      this.store.jobs.set(job.jobId, jobSnapshot);
      if (faceAuthSnapshot) {
        this.store.faceAuthSessions.set(faceAuthSessionId, faceAuthSnapshot);
      }
      throw error;
    }
  }

  async reconcilePayment(jobId: string, clientUserId: string, paymentOrderId?: string) {
    const job = this.store.jobs.get(jobId);
    if (!job || job.clientUserId !== clientUserId) {
      return fail("PAYMENT_RECONCILE_NOT_ALLOWED", "결제 상태를 조회할 수 없어요.");
    }

    const payment = [...this.store.payments.values()].find(
      (entry) => entry.jobId === jobId && entry.userId === clientUserId && (!paymentOrderId || entry.orderId === paymentOrderId)
    );
    if (!payment?.payToken) {
      return fail("PAYMENT_NOT_FOUND", "조회할 결제 주문을 찾을 수 없어요.");
    }

    const client = this.store.users.get(clientUserId);
    if (!client?.tossUserKey) {
      return fail("PAYMENT_RECONCILE_NOT_ALLOWED", "토스 로그인 userKey가 없어서 결제 상태를 조회할 수 없어요.");
    }

    try {
      const providerStatus = await this.tossPayProvider.getPaymentStatus({
        payToken: payment.payToken,
        userKey: client.tossUserKey
      });
      return this.applyProviderStatus(payment, job, providerStatus, false);
    } catch (error) {
      return fail("PAYMENT_STATUS_LOOKUP_FAILED", "결제 상태 조회에 실패했어요.", {
        reason: error instanceof Error ? error.message : "unknown"
      });
    }
  }

  evaluateRelease(jobId: string) {
    const job = this.store.jobs.get(jobId);
    if (!job) {
      return fail("JOB_NOT_FOUND", "의뢰를 찾을 수 없어요.");
    }

    const decision = evaluatePayoutRelease({
      job,
      hasDispute: job.hasDispute,
      hasReport: job.hasReport,
      clientConfirmed: job.clientConfirmed,
      autoConfirmExpired: job.autoConfirmExpired
    });

    return ok(decision);
  }

  async refundFailedJob(
    jobId: string,
    clientUserId: string,
    rawReason: string,
    persistence: PersistenceAdapter = this.persistence
  ) {
    const job = this.store.jobs.get(jobId);
    if (!job || job.clientUserId !== clientUserId || job.status !== "CANCELLED") {
      return fail("PAYMENT_REFUND_NOT_ALLOWED", "거래가 불발로 종료된 의뢰만 환불할 수 있어요.");
    }

    const payment = [...this.store.payments.values()].find((entry) => entry.jobId === jobId && entry.userId === clientUserId);
    if (!payment) {
      return fail("PAYMENT_NOT_FOUND", "환불할 결제 정보를 찾을 수 없어요.");
    }

    if (!["HELD", "APPROVED"].includes(payment.status)) {
      return fail("PAYMENT_REFUND_NOT_ALLOWED", "보관 처리된 결제만 환불할 수 있어요.");
    }

    if (!payment.transactionId) {
      return fail("PAYMENT_REFUND_NOT_ALLOWED", "거래번호가 없어서 환불을 진행할 수 없어요.");
    }

    const client = this.store.users.get(clientUserId);
    if (!client?.tossUserKey) {
      return fail("PAYMENT_REFUND_NOT_ALLOWED", "토스 로그인 userKey가 없어서 환불할 수 없어요.");
    }

    const paymentSnapshot = structuredClone(payment);
    const refundReasonNormalized = normalizeRefundReason(rawReason);
    let providerResult: TossPayRefundResult;
    try {
      providerResult = await this.tossPayProvider.refundPayment({
        transactionId: payment.transactionId,
        userKey: client.tossUserKey,
        reason: refundReasonNormalized,
        testMode: this.runtimeConfig.tossPayTestMode
      });
    } catch (error) {
      return fail("PAYMENT_REFUND_FAILED", "거래 불발 환불을 처리하지 못했어요.", {
        reason: error instanceof Error ? error.message : "unknown"
      });
    }

    payment.providerStatus = providerResult.status ?? payment.providerStatus;
    payment.providerPaymentMethod = providerResult.payMethod ?? payment.providerPaymentMethod;
    payment.refundableAmount = providerResult.refundableAmount ?? payment.refundableAmount;
    if (normalizeProviderStatus(providerResult.status) !== "REFUNDED") {
      return fail("PAYMENT_REFUND_PENDING", "환불 상태가 아직 확정되지 않았어요. 운영 확인이 필요해요.", {
        providerStatus: payment.providerStatus
      });
    }
    payment.status = "REFUNDED";

    try {
      await persistence.upsertPayment(payment);
      await persistence.enqueueOutboxEvent({
        eventId: createId("evt"),
        aggregateType: "PAYMENT",
        aggregateId: payment.paymentId,
        eventType: "PAYMENT_REFUNDED",
        payload: {
          paymentId: payment.paymentId,
          jobId,
          transactionId: payment.transactionId,
          refundReasonNormalized
        },
        availableAt: nowIso()
      });
    } catch (error) {
      Object.assign(payment, paymentSnapshot);
      throw error;
    }

    return ok({
      paymentStatus: payment.status,
      providerStatus: payment.providerStatus,
      refundReasonNormalized,
      refundableAmount: payment.refundableAmount
    });
  }

  private async applyProviderStatus(
    payment: PaymentLedgerEntry,
    job: StoredJob,
    providerResult: TossPayExecuteResult | TossPayStatusResult,
    emitHeldEvent: boolean
  ) {
    const paymentSnapshot = structuredClone(payment);
    const jobSnapshot = structuredClone(job);

    payment.transactionId = providerResult.transactionId ?? payment.transactionId;
    payment.providerPaymentMethod = providerResult.payMethod ?? payment.providerPaymentMethod;
    payment.providerStatus = providerResult.status ?? payment.providerStatus;
    payment.refundableAmount = providerResult.refundableAmount ?? payment.refundableAmount;

    const normalizedStatus = normalizeProviderStatus(providerResult.status);
    if (normalizedStatus === "PENDING") {
      payment.status = "AUTHENTICATED";
      await this.persistence.upsertPayment(payment);
      return ok({
        paymentStatus: payment.status,
        heldAmount: payment.heldAmount,
        feeAmount: payment.feeAmount,
        providerStatus: payment.providerStatus,
        jobStatus: job.status,
        transactionId: payment.transactionId
      });
    }

    if (normalizedStatus === "REFUNDED") {
      payment.status = "REFUNDED";
      await this.persistence.upsertPayment(payment);
      return ok({
        paymentStatus: payment.status,
        heldAmount: payment.heldAmount,
        feeAmount: payment.feeAmount,
        providerStatus: payment.providerStatus,
        jobStatus: job.status,
        transactionId: payment.transactionId
      });
    }

    if (normalizedStatus === "FAILED") {
      payment.status = "INITIATED";
      await this.persistence.upsertPayment(payment);
      return fail("PAYMENT_PROVIDER_EXECUTION_FAILED", "토스페이 승인에 실패했어요.", {
        providerStatus: payment.providerStatus
      });
    }

    payment.status = "HELD";
    payment.approvedAt = nowIso();
    job.status = job.requiresManualReview ? "OPEN" : "OFFERING";

    try {
      await this.persistence.withTransaction(async (tx) => {
        await tx.upsertPayment(payment);
        await tx.upsertJob(job);
        if (emitHeldEvent) {
          await tx.enqueueOutboxEvent({
            eventId: createId("evt"),
            aggregateType: "PAYMENT",
            aggregateId: payment.paymentId,
            eventType: "PAYMENT_HELD",
            payload: {
              paymentId: payment.paymentId,
              jobId: job.jobId,
              jobStatus: job.status,
              feeAmount: payment.feeAmount,
              heldAmount: payment.heldAmount,
              transactionId: payment.transactionId
            },
            availableAt: nowIso()
          });
        }
      });
    } catch (error) {
      Object.assign(payment, paymentSnapshot);
      Object.assign(job, jobSnapshot);
      throw error;
    }

    return ok({
      paymentStatus: payment.status,
      heldAmount: payment.heldAmount,
      feeAmount: payment.feeAmount,
      jobStatus: job.status,
      providerStatus: payment.providerStatus,
      transactionId: payment.transactionId
    });
  }

  private toPaymentInitResponse(payment: PaymentLedgerEntry) {
    return {
      paymentOrderId: payment.orderId,
      payToken: payment.payToken,
      amount: payment.amountTotal,
      heldAmount: payment.heldAmount,
      feeAmount: payment.feeAmount
    };
  }
}

function calculateFeeAmount(offerAmount: number) {
  return Math.max(1500, Math.round(offerAmount * 0.18));
}

function normalizeProviderStatus(status?: string) {
  const normalized = String(status ?? "").toUpperCase();
  if (!normalized) {
    return "APPROVED";
  }

  if (["DONE", "SUCCESS", "APPROVED", "PAID", "PAYMENT_COMPLETED", "SETTLEMENT_COMPLETE"].includes(normalized)) {
    return "APPROVED";
  }

  if (["PENDING", "READY", "AUTHENTICATED", "IN_PROGRESS"].includes(normalized)) {
    return "PENDING";
  }

  if (["REFUNDED", "REFUND_COMPLETED", "PARTIALLY_REFUNDED", "SETTLEMENT_REFUND_COMPLETE"].includes(normalized)) {
    return "REFUNDED";
  }

  return "FAILED";
}

function normalizeRefundReason(reason: string) {
  const normalized = reason
    .replace(/[^\p{Script=Hangul}\p{Letter}\p{Number}\s.,!?:()/_-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || "거래 불발로 환불";
}
