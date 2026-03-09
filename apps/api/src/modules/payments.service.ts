import { fail, ok } from "../../../../packages/contracts/src/index.ts";
import { evaluatePayoutRelease } from "../../../../packages/policy/src/index.ts";

import type { AuthService } from "./auth.service.ts";
import type { InMemoryStore } from "../store.ts";
import { createId, nowIso } from "../utils.ts";

export class PaymentsService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly authService: AuthService
  ) {}

  initPayment(jobId: string, clientUserId: string) {
    const job = this.store.jobs.get(jobId);
    if (!job || job.clientUserId !== clientUserId) {
      return fail("PAYMENT_INIT_NOT_ALLOWED", "결제 주문을 생성할 수 없어요.");
    }

    const payment = {
      paymentId: createId("pay"),
      jobId,
      userId: clientUserId,
      orderId: createId("order"),
      status: "INITIATED" as const,
      amountTotal: job.offerAmount + Math.max(1500, Math.round(job.offerAmount * 0.18)),
      heldAmount: job.offerAmount
    };

    this.store.payments.set(payment.paymentId, payment);
    return ok({
      paymentOrderId: payment.orderId,
      amount: payment.amountTotal,
      feeAmount: payment.amountTotal - payment.heldAmount
    });
  }

  confirmPayment(jobId: string, clientUserId: string, paymentOrderId: string, faceAuthSessionId: string) {
    const job = this.store.jobs.get(jobId);
    if (!job || job.clientUserId !== clientUserId) {
      return fail("PAYMENT_CONFIRM_NOT_ALLOWED", "결제를 승인할 수 없어요.");
    }

    const payment = [...this.store.payments.values()].find(
      (entry) => entry.jobId === jobId && entry.orderId === paymentOrderId && entry.userId === clientUserId
    );

    if (!payment) {
      return fail("PAYMENT_NOT_FOUND", "결제 주문을 찾을 수 없어요.");
    }

    const faceAuth = this.authService.assertValidFaceAuth(clientUserId, faceAuthSessionId);
    if (faceAuth.resultType === "ERROR") {
      return faceAuth;
    }

    payment.status = "HELD";
    payment.approvedAt = nowIso();
    job.status = job.requiresManualReview ? "OPEN" : "OFFERING";

    return ok({
      paymentStatus: payment.status,
      heldAmount: payment.heldAmount,
      jobStatus: job.status
    });
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
}

