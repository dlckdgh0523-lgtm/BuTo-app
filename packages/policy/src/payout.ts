import type { JobDetail, PayoutReleaseDecision } from "../../contracts/src/index.ts";

export interface PayoutPolicyInput {
  job: Pick<JobDetail, "status" | "transportRequirement" | "riskLevel">;
  hasDispute: boolean;
  hasReport: boolean;
  clientConfirmed: boolean;
  autoConfirmExpired: boolean;
}

export function evaluatePayoutRelease(input: PayoutPolicyInput): PayoutReleaseDecision {
  if (input.job.status !== "COMPLETED") {
    return { status: "HOLD", releasable: false, reason: "job_not_completed" };
  }

  if (input.hasDispute || input.hasReport || input.job.riskLevel === "HIGH") {
    return { status: "HOLD", releasable: false, reason: "risk_or_dispute_present" };
  }

  if (input.job.transportRequirement !== "walk") {
    return { status: "HOLD", releasable: false, reason: "manual_review_required_for_vehicle" };
  }

  if (!(input.clientConfirmed || input.autoConfirmExpired)) {
    return { status: "PENDING", releasable: false, reason: "awaiting_confirmation" };
  }

  return {
    status: "RELEASE_READY",
    releasable: true,
    reason: "eligible_for_batch_payout",
    releaseAt: new Date().toISOString()
  };
}

