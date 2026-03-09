import { fail, getAllowedTransitions, ok, type CreateJobRequest, type JobCard, type JobStatus, type RunnerEligibilitySnapshot, type UserRole } from "../../../../packages/contracts/src/index.ts";
import { evaluateJobRisk } from "../../../../packages/policy/src/index.ts";

import type { AuthService } from "./auth.service.ts";
import type { InMemoryStore, StoredJob } from "../store.ts";
import { createId } from "../utils.ts";
import { makeRunnerSnapshot } from "../store.ts";

export class JobsService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly authService: AuthService
  ) {}

  createJob(userId: string, request: CreateJobRequest, faceAuthSessionId: string) {
    const me = this.authService.getMe(userId);
    if (me.resultType === "ERROR") {
      return me;
    }

    if (me.success.needsSafetyAcknowledgement) {
      return fail("SAFETY_ACK_REQUIRED", "안전수칙 확인이 먼저 필요해요.");
    }

    const faceAuth = this.authService.assertValidFaceAuth(userId, faceAuthSessionId, "JOB_CREATE");
    if (faceAuth.resultType === "ERROR") {
      return faceAuth;
    }

    const risk = evaluateJobRisk(request);
    if (risk.disposition === "BLOCK") {
      return fail("JOB_BLOCKED", "허용되지 않는 심부름이에요.", { reasons: risk.reasons });
    }

    const jobId = createId("job");
    const status: JobStatus = "PAYMENT_PENDING";
    const job: StoredJob = {
      ...request,
      jobId,
      clientUserId: userId,
      status,
      riskLevel: risk.level,
      requiresManualReview: risk.disposition === "REVIEW",
      paymentInitRequired: true,
      hasReport: false,
      hasDispute: false,
      clientConfirmed: false,
      autoConfirmExpired: false
    };

    this.store.jobs.set(jobId, job);
    return ok({
      jobId,
      status,
      riskLevel: risk.level,
      requiresManualReview: job.requiresManualReview,
      paymentInitRequired: true,
      policyDisposition: risk.disposition
    });
  }

  getJob(jobId: string, requesterUserId: string, requesterRoleFlags: string[]) {
    const job = this.store.jobs.get(jobId);
    if (!job) {
      return fail("JOB_NOT_FOUND", "의뢰를 찾을 수 없어요.");
    }

    const isAdmin = requesterRoleFlags.includes("ADMIN");
    const isParticipant = requesterUserId === job.clientUserId || requesterUserId === job.matchedRunnerUserId;
    if (!isAdmin && !isParticipant) {
      return fail("JOB_ACCESS_DENIED", "이 의뢰 상세를 볼 권한이 없어요.");
    }

    return ok(job);
  }

  getNearbyJobs(): ReturnType<typeof ok<{ items: JobCard[] }>> {
    return ok({
      items: [...this.store.jobs.values()].filter(
        (job) => (job.status === "OPEN" || job.status === "OFFERING") && !job.requiresManualReview
      ).map((job) => ({
        jobId: job.jobId,
        title: job.title,
        distanceKm: 0,
        offerAmount: job.offerAmount,
        transportRequirement: job.transportRequirement,
        status: job.status,
        riskLevel: job.riskLevel
      }))
    });
  }

  updateStatus(jobId: string, actorUserId: string | undefined, actor: UserRole, nextStatus: JobStatus) {
    const job = this.store.jobs.get(jobId);
    if (!job) {
      return fail("JOB_NOT_FOUND", "의뢰를 찾을 수 없어요.");
    }

    if (actor === "CLIENT" && actorUserId !== job.clientUserId) {
      return fail("JOB_ACTOR_NOT_AUTHORIZED", "의뢰자만 이 상태를 변경할 수 있어요.");
    }

    if (actor === "RUNNER" && actorUserId !== job.matchedRunnerUserId) {
      return fail("JOB_ACTOR_NOT_AUTHORIZED", "매칭된 부르미만 이 상태를 변경할 수 있어요.");
    }

    if (!getAllowedTransitions(job.status, actor).includes(nextStatus)) {
      return fail("INVALID_JOB_TRANSITION", "허용되지 않는 상태 변경이에요.", {
        currentStatus: job.status,
        nextStatus,
        actor
      });
    }

    job.status = nextStatus;
    return ok({
      jobId,
      status: nextStatus,
      allowedNextStatuses: getAllowedTransitions(nextStatus, actor)
    });
  }

  matchJob(jobId: string, actorUserId: string, runnerUserId?: string) {
    const job = this.store.jobs.get(jobId);
    const requestedRunnerUserId = runnerUserId ?? actorUserId;
    const runner = this.store.users.get(requestedRunnerUserId);
    if (!job || !runner) {
      return fail("MATCH_NOT_AVAILABLE", "매칭할 수 없어요.");
    }

    if (actorUserId !== requestedRunnerUserId) {
      return fail("MATCH_NOT_ALLOWED", "부르미 본인만 의뢰를 수락할 수 있어요.");
    }

    if (job.status !== "OFFERING") {
      return fail("MATCH_NOT_AVAILABLE", "지금은 이 의뢰를 수락할 수 없어요.");
    }

    if (job.matchedRunnerUserId) {
      return fail("MATCH_NOT_AVAILABLE", "이미 매칭된 의뢰예요.");
    }

    const eligibility = this.getRunnerEligibility(requestedRunnerUserId);
    if (eligibility.resultType === "ERROR") {
      return eligibility;
    }

    if (!this.isRunnerEligibleForJob(job, eligibility.success)) {
      return fail("RUNNER_NOT_ELIGIBLE", "이 의뢰를 수락할 수 없는 부르미예요.");
    }

    job.matchedRunnerUserId = requestedRunnerUserId;
    job.status = "MATCHED";
    return ok({
      jobId,
      runnerUserId: requestedRunnerUserId,
      status: job.status
    });
  }

  getRunnerEligibility(runnerUserId: string) {
    const runner = this.store.users.get(runnerUserId);
    if (!runner || !runner.runnerVerified) {
      return fail("RUNNER_NOT_VERIFIED", "부르미 검증이 필요해요.");
    }

    return ok(makeRunnerSnapshot(runner));
  }

  private isRunnerEligibleForJob(job: StoredJob, eligibility: RunnerEligibilitySnapshot) {
    if (!eligibility.payoutAccountVerified || eligibility.riskScore >= 80 || eligibility.activeJobs >= 3) {
      return false;
    }

    if (job.transportRequirement === "walk") {
      return true;
    }

    if (job.transportRequirement === "vehicle" && eligibility.transportMode === "vehicle") {
      return true;
    }

    return job.transportRequirement === "truck_1t_plus" && eligibility.vehicleTier === "1t_truck";
  }
}
