import { fail, getAllowedTransitions, ok, type CreateJobRequest, type JobCard, type JobStatus, type RunnerEligibilitySnapshot, type UserRole } from "../../../../packages/contracts/src/index.ts";
import { evaluateJobRisk } from "../../../../packages/policy/src/index.ts";

import type { AuthService } from "./auth.service.ts";
import type { CancellationService } from "./cancellation.service.ts";
import type { PersistenceAdapter } from "../persistence.ts";
import type { InMemoryStore, StoredJob } from "../store.ts";
import { createId } from "../utils.ts";
import { makeRunnerSnapshot } from "../store.ts";

export class JobsService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly authService: AuthService,
    private readonly persistence: PersistenceAdapter,
    private readonly cancellationService: CancellationService
  ) {}

  async createJob(userId: string, request: CreateJobRequest, faceAuthSessionId: string) {
    const me = this.authService.getMe(userId);
    if (me.resultType === "ERROR") {
      return me;
    }

    if (me.success.needsSafetyAcknowledgement) {
      return fail("SAFETY_ACK_REQUIRED", "안전수칙 확인이 먼저 필요해요.");
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
    const faceAuthSession = this.store.faceAuthSessions.get(faceAuthSessionId);
    const faceAuthSnapshot = faceAuthSession ? structuredClone(faceAuthSession) : undefined;

    this.store.jobs.set(jobId, job);
    try {
      await this.persistence.withTransaction(async (tx) => {
        const faceAuth = await this.authService.consumeFaceAuth(userId, faceAuthSessionId, "JOB_CREATE", tx);
        if (faceAuth.resultType === "ERROR") {
          throw faceAuth;
        }

        await tx.upsertJob(job);
        await tx.enqueueOutboxEvent({
          eventId: createId("evt"),
          aggregateType: "JOB",
          aggregateId: jobId,
          eventType: "JOB_CREATED",
          payload: {
            jobId,
            clientUserId: userId,
            status
          },
          availableAt: new Date().toISOString()
        });
      });
    } catch (error) {
      this.store.jobs.delete(jobId);
      if (faceAuthSnapshot) {
        this.store.faceAuthSessions.set(faceAuthSessionId, faceAuthSnapshot);
      }
      if (
        error &&
        typeof error === "object" &&
        "resultType" in error &&
        (error as { resultType?: string }).resultType === "ERROR"
      ) {
        return error;
      }

      throw error;
    }

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

  async listActiveJobs(userId: string, roleFlags: string[]) {
    const cancellationSweep = await this.cancellationService.sweepIdleTimeoutsForUser(userId, roleFlags);
    if (cancellationSweep.resultType === "ERROR") {
      return cancellationSweep;
    }

    const isAdmin = roleFlags.includes("ADMIN");
    return ok({
      items: [...this.store.jobs.values()]
        .filter((job) =>
          ["MATCHED", "RUNNER_EN_ROUTE", "RUNNER_ARRIVED", "PICKED_UP", "DELIVERING", "DELIVERY_PROOF_SUBMITTED", "CLIENT_CONFIRM_PENDING"].includes(job.status)
        )
        .filter((job) => isAdmin || userId === job.clientUserId || userId === job.matchedRunnerUserId)
        .map((job) => {
          const proofPhotos = this.store.proofPhotos.filter((photo) => photo.jobId === job.jobId);
          const latestLocationLog = [...this.store.locationLogs]
            .filter((log) => log.jobId === job.jobId)
            .sort((left, right) => Date.parse(right.loggedAt) - Date.parse(left.loggedAt))[0];
          const latestCancellationRequest = [...this.store.jobCancellationRequests.values()]
            .filter((request) => request.jobId === job.jobId)
            .sort((left, right) => Date.parse(right.requestedAt) - Date.parse(left.requestedAt))[0];
          const latestUserMessage = [...(job.chatRoomId ? this.store.chatMessages.get(job.chatRoomId) ?? [] : [])]
            .filter((message) => message.messageType !== "system")
            .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
          const idleAutoCancelAt = latestUserMessage && ["MATCHED", "RUNNER_EN_ROUTE"].includes(job.status)
            ? new Date(Date.parse(latestUserMessage.createdAt) + 20 * 60 * 1000).toISOString()
            : undefined;

          return {
            jobId: job.jobId,
            title: job.title,
            status: job.status,
            transportRequirement: job.transportRequirement,
            riskLevel: job.riskLevel,
            offerAmount: job.offerAmount,
            pickupAddress: job.pickup.address,
            dropoffAddress: job.dropoff.address,
            pickupLat: job.pickup.lat,
            pickupLng: job.pickup.lng,
            dropoffLat: job.dropoff.lat,
            dropoffLng: job.dropoff.lng,
            proofCounts: {
              pickup: proofPhotos.filter((photo) => photo.proofType === "pickup").length,
              delivery: proofPhotos.filter((photo) => photo.proofType === "delivery").length
            },
            lastLocationLoggedAt: latestLocationLog?.loggedAt,
            lastChatMessageAt: latestUserMessage?.createdAt,
            chatIdleAutoCancelAt: idleAutoCancelAt,
            counterpartUserId: userId === job.clientUserId ? job.matchedRunnerUserId : job.clientUserId,
            hasDispute: job.hasDispute || job.status === "DISPUTED",
            cancellationRequest: latestCancellationRequest
              ? {
                  cancellationRequestId: latestCancellationRequest.cancellationRequestId,
                  requestedByUserId: latestCancellationRequest.requestedByUserId,
                  requesterRole: latestCancellationRequest.requesterRole,
                  reason: latestCancellationRequest.reason,
                  status: latestCancellationRequest.status,
                  requestedAt: latestCancellationRequest.requestedAt,
                  respondedAt: latestCancellationRequest.respondedAt,
                  responseNote: latestCancellationRequest.responseNote
                }
              : undefined,
            isRunnerView: userId === job.matchedRunnerUserId,
            isClientView: userId === job.clientUserId
          };
        })
    });
  }

  async updateStatus(jobId: string, actorUserId: string | undefined, actor: UserRole, nextStatus: JobStatus) {
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

    const jobSnapshot = structuredClone(job);
    job.status = nextStatus;
    try {
      await this.persistence.withTransaction(async (tx) => {
        await tx.upsertJob(job);
        await tx.enqueueOutboxEvent({
          eventId: createId("evt"),
          aggregateType: "JOB",
          aggregateId: jobId,
          eventType: "JOB_STATUS_CHANGED",
          payload: {
            jobId,
            actor,
            status: nextStatus
          },
          availableAt: new Date().toISOString()
        });
      });
    } catch (error) {
      this.store.jobs.set(jobId, jobSnapshot);
      throw error;
    }

    return ok({
      jobId,
      status: nextStatus,
      allowedNextStatuses: getAllowedTransitions(nextStatus, actor)
    });
  }

  async matchJob(jobId: string, actorUserId: string, runnerUserId?: string) {
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

    const jobSnapshot = structuredClone(job);
    job.matchedRunnerUserId = requestedRunnerUserId;
    job.status = "MATCHED";
    try {
      await this.persistence.withTransaction(async (tx) => {
        await tx.upsertJob(job);
        await tx.enqueueOutboxEvent({
          eventId: createId("evt"),
          aggregateType: "JOB",
          aggregateId: jobId,
          eventType: "JOB_MATCHED",
          payload: {
            jobId,
            runnerUserId: requestedRunnerUserId
          },
          availableAt: new Date().toISOString()
        });
      });
    } catch (error) {
      this.store.jobs.set(jobId, jobSnapshot);
      throw error;
    }

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
