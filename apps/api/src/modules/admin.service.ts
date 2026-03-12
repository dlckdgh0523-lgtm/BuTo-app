import { fail, getAllowedTransitions, ok, type AdminOpsDashboard, type JobStatus } from "../../../../packages/contracts/src/index.ts";

import type { PersistenceAdapter } from "../persistence.ts";
import type { InMemoryStore, StoredJob } from "../store.ts";
import { createId, nowIso } from "../utils.ts";
import type { EnforcementService } from "./enforcement.service.ts";

export class AdminService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly enforcementService: EnforcementService,
    private readonly persistence: PersistenceAdapter
  ) {}

  private appendAuditLog(entry: {
    actorUserId: string;
    action: string;
    entityType: "JOB" | "USER";
    entityId: string;
    note?: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  }) {
    const auditEntry = {
      auditId: createId("audit"),
      actorUserId: entry.actorUserId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      note: entry.note,
      before: entry.before,
      after: entry.after,
      createdAt: nowIso()
    };
    this.store.auditLogs.push(auditEntry);
    return auditEntry;
  }

  private buildDisputeItem(job: StoredJob) {
    return {
      jobId: job.jobId,
      clientUserId: job.clientUserId,
      matchedRunnerUserId: job.matchedRunnerUserId,
      title: job.title,
      description: job.description,
      status: job.status,
      riskLevel: job.riskLevel,
      hasReport: job.hasReport,
      hasDispute: job.hasDispute
    };
  }

  reviewQueue() {
    return ok({
      items: [...this.store.jobs.values()].filter((job) => job.requiresManualReview || job.riskLevel === "HIGH")
    });
  }

  disputeCenter(filters?: {
    status?: string;
    riskLevel?: string;
    query?: string;
    sort?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = filters?.page && filters.page > 0 ? filters.page : 1;
    const pageSize = filters?.pageSize && filters.pageSize > 0 ? Math.min(filters.pageSize, 50) : 10;
    const normalizedQuery = filters?.query?.trim().toLowerCase();
    const filtered = [...this.store.jobs.values()]
      .filter((job) => job.hasDispute || job.status === "DISPUTED")
      .filter((job) => !filters?.status || job.status === filters.status)
      .filter((job) => !filters?.riskLevel || job.riskLevel === filters.riskLevel)
      .filter((job) => {
        if (!normalizedQuery) {
          return true;
        }

        return [job.jobId, job.title, job.description].some((value) => value.toLowerCase().includes(normalizedQuery));
      });

    const riskWeight = (riskLevel: string) => (riskLevel === "HIGH" ? 3 : riskLevel === "MEDIUM" ? 2 : 1);
    filtered.sort((left, right) => {
      switch (filters?.sort) {
        case "risk_desc":
          return riskWeight(right.riskLevel) - riskWeight(left.riskLevel) || right.jobId.localeCompare(left.jobId);
        case "status_asc":
          return left.status.localeCompare(right.status) || right.jobId.localeCompare(left.jobId);
        case "title_asc":
          return left.title.localeCompare(right.title, "ko") || right.jobId.localeCompare(left.jobId);
        default:
          return right.jobId.localeCompare(left.jobId);
      }
    });

    return ok({
      items: filtered
        .slice((page - 1) * pageSize, page * pageSize)
        .map((job) => this.buildDisputeItem(job)),
      page,
      pageSize,
      total: filtered.length,
      hasNextPage: page * pageSize < filtered.length
    });
  }

  disputeDetail(jobId: string) {
    const job = this.store.jobs.get(jobId);
    if (!job || (!job.hasDispute && job.status !== "DISPUTED")) {
      return fail("DISPUTE_NOT_FOUND", "열린 분쟁 의뢰를 찾을 수 없어요.");
    }

    const payment = [...this.store.payments.values()].find((entry) => entry.jobId === job.jobId);
    const proofPhotos = this.store.proofPhotos
      .filter((photo) => photo.jobId === job.jobId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const locationLogs = [...this.store.locationLogs]
      .filter((log) => log.jobId === job.jobId)
      .sort((left, right) => right.loggedAt.localeCompare(left.loggedAt))
      .slice(0, 5);
    const chatMessages = [...(job.chatRoomId ? this.store.chatMessages.get(job.chatRoomId) ?? [] : [])]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 8)
      .map((message) => ({
        messageId: message.messageId,
        senderUserId: message.senderUserId,
        senderNickname: this.store.users.get(message.senderUserId)?.nickname ?? message.senderUserId,
        messageType: message.messageType,
        body: message.body,
        moderationStatus: message.moderationStatus,
        actionTaken: message.actionTaken,
        createdAt: message.createdAt
      }));
    const reports = [...this.store.reports.values()]
      .filter((report) => report.jobId === job.jobId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const emergencies = [...this.store.emergencies.values()]
      .filter((event) => event.jobId === job.jobId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const latestCancellationRequest = [...this.store.jobCancellationRequests.values()]
      .filter((request) => request.jobId === job.jobId)
      .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt))[0];

    return ok({
      job: {
        ...this.buildDisputeItem(job),
        offerAmount: job.offerAmount,
        pickupAddress: job.pickup.address,
        dropoffAddress: job.dropoff.address,
        chatRoomId: job.chatRoomId,
        clientConfirmed: job.clientConfirmed,
        autoConfirmExpired: job.autoConfirmExpired
      },
      payment: payment
        ? {
            paymentId: payment.paymentId,
            status: payment.status,
            amountTotal: payment.amountTotal,
            heldAmount: payment.heldAmount,
            feeAmount: payment.feeAmount,
            providerPaymentMethod: payment.providerPaymentMethod,
            providerStatus: payment.providerStatus,
            transactionId: payment.transactionId,
            approvedAt: payment.approvedAt
          }
        : undefined,
      proofPhotos,
      locationLogs,
      chatMessages,
      reports,
      emergencies,
      latestCancellationRequest
    });
  }

  emergencyFeed() {
    return ok({
      items: [...this.store.emergencies.values()]
    });
  }

  blockedUsers() {
    return ok({
      items: [...this.store.users.values()]
        .filter((user) => ["RESTRICTED", "SUSPENDED", "APPEAL_PENDING", "PERMANENTLY_BANNED"].includes(user.status))
        .map((user) => ({
          userId: user.userId,
          nickname: user.nickname,
          status: user.status,
          restriction: user.restriction
        }))
    });
  }

  withdrawnUsers() {
    return ok({
      items: [...this.store.users.values()]
        .filter((user) => user.status === "WITHDRAWN")
        .map((user) => ({
          userId: user.userId,
          nickname: user.nickname,
          withdrawnAt: user.withdrawnAt
        }))
    });
  }

  documentsQueue() {
    return ok({
      items: [...this.store.users.values()]
        .filter((user) => user.roleFlags.includes("RUNNER"))
        .map((user) => ({
          userId: user.userId,
          nickname: user.nickname,
          businessVerified: user.businessVerified,
          vehicleTier: user.vehicleTier ?? "walk_only"
        }))
    });
  }

  payoutHolds() {
    return ok({
      items: [...this.store.jobs.values()].filter((job) => job.hasDispute || job.hasReport || job.riskLevel === "HIGH")
    });
  }

  policyDictionary() {
    return ok({
      blockedTerms: ["약", "담배", "술", "현금", "OTP"],
      reviewTerms: ["병원", "약국", "관공서", "법원", "경찰서"]
    });
  }

  async pushSubscriptions(limit = 100) {
    const persisted = await this.persistence.listPushSubscriptions(limit);
    if (persisted) {
      for (const subscription of persisted) {
        this.store.pushSubscriptions.set(subscription.subscriptionId, subscription);
      }
    }

    const items = [...this.store.pushSubscriptions.values()]
      .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
      .slice(0, limit);

    return ok({
      items,
      summary: {
        total: items.length,
        active: items.filter((item) => !item.disabledAt).length,
        disabled: items.filter((item) => Boolean(item.disabledAt)).length,
        failing: items.filter((item) => item.failureCount > 0 && !item.disabledAt).length
      }
    });
  }

  async pushDeliveries(limit = 100) {
    const persisted = await this.persistence.listPushDeliveryAttempts(limit);
    if (persisted) {
      for (const attempt of persisted) {
        this.store.pushDeliveryAttempts.set(attempt.deliveryAttemptId, attempt);
      }
    }

    const items = [...this.store.pushDeliveryAttempts.values()]
      .sort((left, right) => right.attemptedAt.localeCompare(left.attemptedAt))
      .slice(0, limit);

    return ok({
      items,
      summary: {
        total: items.length,
        success: items.filter((item) => item.status === "SUCCESS").length,
        failed: items.filter((item) => item.status === "FAILED").length,
        skipped: items.filter((item) => item.status === "SKIPPED").length
      }
    });
  }

  async supportFallbacks(limit = 100) {
    const persisted = await this.persistence.listSupportFallbacks(limit);
    if (persisted) {
      for (const fallback of persisted) {
        this.store.supportFallbacks.set(fallback.fallbackId, fallback);
      }
    }

    const items = [...this.store.supportFallbacks.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);

    return ok({
      items,
      summary: {
        total: items.length,
        open: items.filter((item) => item.status === "OPEN").length,
        acknowledged: items.filter((item) => item.status === "ACKNOWLEDGED").length
      }
    });
  }

  async runtimeWorkers() {
    const persisted = await this.persistence.listWorkerHeartbeats();
    if (persisted) {
      for (const heartbeat of persisted) {
        this.store.workerHeartbeats.set(heartbeat.workerKey, heartbeat);
      }
    }

    return ok({
      items: [...this.store.workerHeartbeats.values()].sort((left, right) => left.workerKey.localeCompare(right.workerKey))
    });
  }

  async opsDashboard(): Promise<ReturnType<typeof ok<AdminOpsDashboard>>> {
    const [pushSubscriptions, pushDeliveries, supportFallbacks] = await Promise.all([
      this.pushSubscriptions(100),
      this.pushDeliveries(100),
      this.supportFallbacks(100)
    ]);

    const pushSubscriptionSummary =
      pushSubscriptions.resultType === "SUCCESS"
        ? pushSubscriptions.success.summary
        : { total: 0, active: 0, disabled: 0, failing: 0 };
    const pushDeliverySummary =
      pushDeliveries.resultType === "SUCCESS"
        ? pushDeliveries.success.summary
        : { total: 0, success: 0, failed: 0, skipped: 0 };
    const supportFallbackSummary =
      supportFallbacks.resultType === "SUCCESS"
        ? supportFallbacks.success.summary
        : { total: 0, open: 0, acknowledged: 0 };
    const runtimeWorkers = await this.runtimeWorkers();
    const workerSummary = runtimeWorkers.resultType === "SUCCESS" ? runtimeWorkers.success.items : [];

    const recentAlerts = [
      ...[...this.store.emergencies.values()].map((event) => ({
        kind: "EMERGENCY" as const,
        entityId: event.emergencyEventId,
        title: `긴급 이벤트 ${event.eventType}`,
        createdAt: event.createdAt
      })),
      ...[...this.store.supportFallbacks.values()].map((fallback) => ({
        kind: "SUPPORT_FALLBACK" as const,
        entityId: fallback.fallbackId,
        title: `상담 채널 전환 ${fallback.reasonCode}`,
        createdAt: fallback.createdAt
      })),
      ...[...this.store.pushDeliveryAttempts.values()]
        .filter((attempt) => attempt.status === "FAILED")
        .map((attempt) => ({
          kind: "PUSH_FAILURE" as const,
          entityId: attempt.deliveryAttemptId,
          title: `푸시 전달 실패 ${attempt.provider}`,
          createdAt: attempt.attemptedAt
        })),
      ...[...this.store.workerHeartbeats.values()]
        .filter((heartbeat) => heartbeat.lastStatus === "FAILED")
        .map((heartbeat) => ({
          kind: "WORKER_FAILURE" as const,
          entityId: heartbeat.workerKey,
          title: `worker 실패 ${heartbeat.workerKey}`,
          createdAt: heartbeat.lastCompletedAt ?? heartbeat.lastStartedAt
        }))
    ]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 10);

    return ok({
      queueCounts: {
        reviewQueue: [...this.store.jobs.values()].filter((job) => job.requiresManualReview || job.riskLevel === "HIGH").length,
        disputes: [...this.store.jobs.values()].filter((job) => job.hasDispute || job.status === "DISPUTED").length,
        emergencies: this.store.emergencies.size,
        blockedUsers: [...this.store.users.values()].filter((user) => ["RESTRICTED", "SUSPENDED", "APPEAL_PENDING", "PERMANENTLY_BANNED"].includes(user.status)).length,
        withdrawnUsers: [...this.store.users.values()].filter((user) => user.status === "WITHDRAWN").length
      },
      push: {
        subscriptions: pushSubscriptionSummary,
        deliveries: pushDeliverySummary
      },
      supportFallbacks: supportFallbackSummary,
      workers: workerSummary,
      recentAlerts
    });
  }

  async reviewJob(adminUserId: string, jobId: string, decision: "APPROVE" | "REJECT", note?: string) {
    const job = this.store.jobs.get(jobId);
    if (!job) {
      return fail("JOB_NOT_FOUND", "의뢰를 찾을 수 없어요.");
    }

    if (!job.requiresManualReview) {
      return fail("JOB_REVIEW_NOT_REQUIRED", "수동 검수가 필요한 의뢰가 아니에요.");
    }

    const before = {
      status: job.status,
      requiresManualReview: job.requiresManualReview
    };
    const jobSnapshot = structuredClone(job);
    const auditLogLength = this.store.auditLogs.length;

    if (decision === "APPROVE") {
      if (!getAllowedTransitions(job.status, "ADMIN").includes("OFFERING")) {
        return fail("INVALID_JOB_TRANSITION", "이 의뢰를 승인할 수 없는 상태예요.");
      }

      job.requiresManualReview = false;
      job.status = "OFFERING";
    } else {
      if (!getAllowedTransitions(job.status, "ADMIN").includes("CANCELLED")) {
        return fail("INVALID_JOB_TRANSITION", "이 의뢰를 거절할 수 없는 상태예요.");
      }

      job.status = "CANCELLED";
    }

    const auditEntry = this.appendAuditLog({
      actorUserId: adminUserId,
      action: decision === "APPROVE" ? "JOB_REVIEW_APPROVED" : "JOB_REVIEW_REJECTED",
      entityType: "JOB",
      entityId: job.jobId,
      note,
      before,
      after: {
        status: job.status,
        requiresManualReview: job.requiresManualReview
      }
    });
    try {
      await this.persistence.withTransaction(async (tx) => {
        await tx.upsertJob(job);
        await tx.appendAuditLog(auditEntry);
        await tx.enqueueOutboxEvent({
          eventId: createId("evt"),
          aggregateType: "JOB",
          aggregateId: job.jobId,
          eventType: "JOB_REVIEW_DECIDED",
          payload: {
            jobId: job.jobId,
            decision,
            status: job.status,
            requiresManualReview: job.requiresManualReview
          },
          availableAt: nowIso()
        });
      });
    } catch (error) {
      this.store.jobs.set(jobId, jobSnapshot);
      this.store.auditLogs.length = auditLogLength;
      throw error;
    }

    return ok({
      jobId: job.jobId,
      status: job.status,
      requiresManualReview: job.requiresManualReview
    });
  }

  async resolveDispute(adminUserId: string, jobId: string, resolution: Extract<JobStatus, "COMPLETED" | "CANCELLED" | "FAILED_SETTLEMENT">, note?: string) {
    const job = this.store.jobs.get(jobId);
    if (!job) {
      return fail("JOB_NOT_FOUND", "의뢰를 찾을 수 없어요.");
    }

    if (job.status !== "DISPUTED") {
      return fail("DISPUTE_NOT_OPEN", "분쟁 상태의 의뢰만 처리할 수 있어요.");
    }

    if (!getAllowedTransitions(job.status, "ADMIN").includes(resolution)) {
      return fail("INVALID_JOB_TRANSITION", "이 분쟁 처리 결과를 적용할 수 없어요.");
    }

    const before = {
      status: job.status,
      hasDispute: job.hasDispute
    };
    const jobSnapshot = structuredClone(job);
    const auditLogLength = this.store.auditLogs.length;

    job.status = resolution;
    job.hasDispute = false;

    const auditEntry = this.appendAuditLog({
      actorUserId: adminUserId,
      action: "DISPUTE_RESOLVED",
      entityType: "JOB",
      entityId: job.jobId,
      note,
      before,
      after: {
        status: job.status,
        hasDispute: job.hasDispute
      }
    });
    try {
      await this.persistence.withTransaction(async (tx) => {
        await tx.upsertJob(job);
        await tx.appendAuditLog(auditEntry);
        await tx.enqueueOutboxEvent({
          eventId: createId("evt"),
          aggregateType: "JOB",
          aggregateId: job.jobId,
          eventType: "DISPUTE_RESOLVED",
          payload: {
            jobId: job.jobId,
            resolution,
            status: job.status
          },
          availableAt: nowIso()
        });
      });
    } catch (error) {
      this.store.jobs.set(jobId, jobSnapshot);
      this.store.auditLogs.length = auditLogLength;
      throw error;
    }

    return ok({
      jobId: job.jobId,
      status: job.status
    });
  }

  setUserStatus(
    adminUserId: string,
    targetUserId: string,
    status: "ACTIVE" | "RESTRICTED" | "SUSPENDED" | "PERMANENTLY_BANNED" | "REINSTATED",
    reason: string
  ) {
    const user = this.store.users.get(targetUserId);
    if (!user) {
      return fail("USER_NOT_FOUND", "사용자를 찾을 수 없어요.");
    }

    if (!reason.trim()) {
      return fail("ADMIN_REASON_REQUIRED", "관리 사유가 필요해요.");
    }

    const reasonCode =
      status === "RESTRICTED"
        ? "ADMIN_RESTRICTED"
        : status === "SUSPENDED"
          ? "ADMIN_SUSPENDED"
          : status === "PERMANENTLY_BANNED"
            ? "ADMIN_PERMANENT_BAN"
            : "ADMIN_REINSTATED";

    return this.enforcementService.applyAdminRestriction(adminUserId, targetUserId, {
      status,
      reasonCode,
      reasonMessage: reason,
      scope: "ACCOUNT_FULL"
    });
  }

  auditLogs() {
    return ok({
      items: [...this.store.auditLogs]
    });
  }
}
