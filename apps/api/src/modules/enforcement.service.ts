import {
  fail,
  ok,
  type AccountStatus,
  type ApiResponse,
  type AppealDecision,
  type EnforcementEvidenceBundle,
  type EnforcementReviewStatus,
  type EnforcementScope,
  type EnforcementStatusSummary,
  type UserAppeal,
  type UserEnforcementAction
} from "../../../../packages/contracts/src/index.ts";

import type { DemoUser, InMemoryStore } from "../store.ts";
import type { PersistenceAdapter } from "../persistence.ts";
import { createId, nowIso } from "../utils.ts";

const AUTO_PERMANENT_BAN_REASON_CODES = new Set([
  "CONFIRMED_CREDENTIAL_THEFT",
  "CONFIRMED_PAYMENT_FRAUD",
  "CHILD_SAFETY_CRITICAL"
]);

export class EnforcementService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly persistence: PersistenceAdapter
  ) {}

  private runWithPersistence<T>(
    persistence: PersistenceAdapter,
    fn: (tx: PersistenceAdapter) => Promise<T>
  ) {
    return persistence === this.persistence ? persistence.withTransaction(fn) : fn(persistence);
  }

  private appendAuditLog(entry: {
    actorUserId: string;
    action: string;
    entityId: string;
    note?: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  }) {
    const auditEntry = {
      auditId: createId("audit"),
      actorUserId: entry.actorUserId,
      action: entry.action,
      entityType: "USER",
      entityId: entry.entityId,
      note: entry.note,
      before: entry.before,
      after: entry.after,
      createdAt: nowIso()
    };
    this.store.auditLogs.push(auditEntry);
    return auditEntry;
  }

  private snapshotUserSessions(userId: string) {
    return {
      refreshSessions: [...this.store.refreshSessions.entries()]
        .filter(([, session]) => session.userId === userId)
        .map(([token, session]) => [token, structuredClone(session)] as const),
      faceAuthSessions: [...this.store.faceAuthSessions.entries()]
        .filter(([, session]) => session.userId === userId)
        .map(([faceAuthSessionId, session]) => [faceAuthSessionId, structuredClone(session)] as const)
    };
  }

  private restoreUserSessions(
    userId: string,
    snapshot: ReturnType<EnforcementService["snapshotUserSessions"]>
  ) {
    for (const [refreshToken, session] of [...this.store.refreshSessions.entries()]) {
      if (session.userId === userId) {
        this.store.refreshSessions.delete(refreshToken);
      }
    }

    for (const [faceAuthSessionId, session] of [...this.store.faceAuthSessions.entries()]) {
      if (session.userId === userId) {
        this.store.faceAuthSessions.delete(faceAuthSessionId);
      }
    }

    for (const [refreshToken, session] of snapshot.refreshSessions) {
      this.store.refreshSessions.set(refreshToken, session);
    }

    for (const [faceAuthSessionId, session] of snapshot.faceAuthSessions) {
      this.store.faceAuthSessions.set(faceAuthSessionId, session);
    }
  }

  private async clearUserSessions(userId: string, persistence: PersistenceAdapter = this.persistence) {
    for (const [refreshToken, session] of this.store.refreshSessions.entries()) {
      if (session.userId === userId) {
        this.store.refreshSessions.delete(refreshToken);
        await persistence.deleteRefreshSession(refreshToken);
      }
    }

    for (const [faceAuthSessionId, session] of this.store.faceAuthSessions.entries()) {
      if (session.userId === userId) {
        this.store.faceAuthSessions.delete(faceAuthSessionId);
        await persistence.deleteFaceAuthSession(faceAuthSessionId);
      }
    }
  }

  private getLatestAction(userId: string) {
    return [...this.store.userEnforcementActions.values()]
      .filter((action) => action.userId === userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  }

  private getLatestAppeal(userId: string) {
    return [...this.store.userAppeals.values()]
      .filter((appeal) => appeal.userId === userId)
      .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt))[0];
  }

  private setUserRestriction(user: DemoUser, input: {
    actionId: string;
    status: Exclude<AccountStatus, "ACTIVE" | "WITHDRAWN">;
    reasonCode: string;
    reasonMessage: string;
    source: "AI_MODERATION" | "ADMIN_POLICY";
    scope: EnforcementScope;
    reviewStatus: EnforcementReviewStatus;
  }) {
    user.status = input.status;
    user.restriction = {
      status: input.status,
      actionId: input.actionId,
      reasonCode: input.reasonCode,
      reasonMessage: input.reasonMessage,
      source: input.source,
      scope: input.scope,
      reviewStatus: input.reviewStatus,
      updatedAt: nowIso(),
      supportAction: "KAKAO_CHANNEL"
    };
    user.lastActiveAt = nowIso();
  }

  isOperationalStatus(status: AccountStatus) {
    return status === "ACTIVE" || status === "REINSTATED";
  }

  canAuthenticateForRestrictionShell(status: AccountStatus) {
    return status !== "WITHDRAWN";
  }

  listUserEnforcementActions(userId: string) {
    return ok({
      items: [...this.store.userEnforcementActions.values()]
        .filter((action) => action.userId === userId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((action) => ({
          ...action,
          evidenceBundle: this.store.enforcementEvidenceBundles.get(action.evidenceBundleId)
        }))
    });
  }

  getEnforcementStatus(userId: string): ApiResponse<EnforcementStatusSummary> {
    const user = this.store.users.get(userId);
    if (!user) {
      return fail("USER_NOT_FOUND", "사용자를 찾을 수 없어요.");
    }

    return ok({
      userId,
      status: user.status,
      restriction: user.restriction,
      latestAction: this.getLatestAction(userId),
      latestAppeal: this.getLatestAppeal(userId),
      supportAction: user.restriction?.supportAction
    });
  }

  async applyAutomatedRestriction(userId: string, input: {
    reasonCode: string;
    reasonMessage: string;
    scope: EnforcementScope;
    evidenceType: EnforcementEvidenceBundle["evidenceType"];
    evidenceSummary: string;
    evidenceMetadata?: Record<string, unknown>;
  }, persistence: PersistenceAdapter = this.persistence) {
    const user = this.store.users.get(userId);
    if (!user || user.status === "WITHDRAWN") {
      return fail("USER_NOT_FOUND", "사용자를 찾을 수 없어요.");
    }

    const actionId = createId("enforce");
    const evidenceBundleId = createId("evidence");
    const createdAt = nowIso();
    const statusApplied = AUTO_PERMANENT_BAN_REASON_CODES.has(input.reasonCode) ? "PERMANENTLY_BANNED" : "RESTRICTED";
    const reviewStatus: EnforcementReviewStatus = statusApplied === "PERMANENTLY_BANNED" ? "UPHELD" : "UNDER_REVIEW";
    const userSnapshot = structuredClone(user);
    const sessionSnapshot = this.snapshotUserSessions(userId);
    const auditLogLength = this.store.auditLogs.length;

    const evidenceBundle: EnforcementEvidenceBundle = {
      evidenceBundleId,
      userId,
      sourceActionId: actionId,
      evidenceType: input.evidenceType,
      summary: input.evidenceSummary,
      metadata: input.evidenceMetadata,
      createdAt
    };
    this.store.enforcementEvidenceBundles.set(evidenceBundleId, evidenceBundle);

    const action: UserEnforcementAction = {
      actionId,
      userId,
      statusApplied,
      source: "AI_MODERATION",
      scope: input.scope,
      reviewStatus,
      reasonCode: input.reasonCode,
      reasonMessage: input.reasonMessage,
      appealEligible: true,
      evidenceBundleId,
      createdAt
    };
    this.store.userEnforcementActions.set(actionId, action);

    const before = {
      status: user.status,
      restriction: user.restriction
    };
    this.setUserRestriction(user, {
      actionId,
      status: statusApplied,
      reasonCode: input.reasonCode,
      reasonMessage: input.reasonMessage,
      source: "AI_MODERATION",
      scope: input.scope,
      reviewStatus
    });
    const auditEntry = this.appendAuditLog({
      actorUserId: "system-ai",
      action: "USER_ENFORCEMENT_APPLIED",
      entityId: userId,
      note: input.reasonCode,
      before,
      after: {
        status: user.status,
        actionId
      }
    });

    try {
      await this.runWithPersistence(persistence, async (tx) => {
        await this.clearUserSessions(userId, tx);
        await tx.upsertEvidenceBundle(evidenceBundle);
        await tx.upsertEnforcementAction(action);
        await tx.upsertUser(user);
        await tx.appendAuditLog(auditEntry);
        await tx.enqueueOutboxEvent({
          eventId: createId("evt"),
          aggregateType: "USER",
          aggregateId: userId,
          eventType: "USER_ENFORCEMENT_APPLIED",
          payload: {
            userId,
            actionId,
            statusApplied,
            reasonCode: input.reasonCode
          },
          availableAt: nowIso()
        });
      });

      return ok(action);
    } catch (error) {
      this.store.users.set(userId, userSnapshot);
      this.store.enforcementEvidenceBundles.delete(evidenceBundleId);
      this.store.userEnforcementActions.delete(actionId);
      this.restoreUserSessions(userId, sessionSnapshot);
      this.store.auditLogs.length = auditLogLength;
      throw error;
    }
  }

  async applyAdminRestriction(adminUserId: string, targetUserId: string, input: {
    status: "RESTRICTED" | "SUSPENDED" | "PERMANENTLY_BANNED" | "ACTIVE" | "REINSTATED";
    reasonCode: string;
    reasonMessage: string;
    scope: EnforcementScope;
  }) {
    const user = this.store.users.get(targetUserId);
    if (!user) {
      return fail("USER_NOT_FOUND", "사용자를 찾을 수 없어요.");
    }

    const before = {
      status: user.status,
      restriction: user.restriction
    };
    const userSnapshot = structuredClone(user);
    const auditLogLength = this.store.auditLogs.length;

    if (input.status === "ACTIVE" || input.status === "REINSTATED") {
      const latestAction = this.getLatestAction(targetUserId);
      if (!latestAction) {
        return fail("ENFORCEMENT_ACTION_NOT_FOUND", "복구할 제재 이력이 없어요.");
      }
      const latestActionSnapshot = structuredClone(latestAction);

      const liftedAt = nowIso();
      latestAction.reviewStatus = "REINSTATED";
      latestAction.liftedAt = liftedAt;
      latestAction.liftedByActionId = latestAction.liftedByActionId ?? createId("reinstate");
      user.status = input.status;
      user.restriction = undefined;
      user.lastActiveAt = liftedAt;

      const auditEntry = this.appendAuditLog({
        actorUserId: adminUserId,
        action: "USER_REINSTATED",
        entityId: targetUserId,
        note: input.reasonMessage,
        before,
        after: {
          status: user.status
        }
      });
      try {
        await this.persistence.withTransaction(async (tx) => {
          await tx.upsertEnforcementAction(latestAction);
          await tx.upsertUser(user);
          await tx.appendAuditLog(auditEntry);
          await tx.enqueueOutboxEvent({
            eventId: createId("evt"),
            aggregateType: "USER",
            aggregateId: targetUserId,
            eventType: "USER_REINSTATED",
            payload: {
              userId: targetUserId,
              status: user.status
            },
            availableAt: nowIso()
          });
        });

        return ok({
          userId: targetUserId,
          status: user.status
        });
      } catch (error) {
        this.store.users.set(targetUserId, userSnapshot);
        this.store.userEnforcementActions.set(latestAction.actionId, latestActionSnapshot);
        this.store.auditLogs.length = auditLogLength;
        throw error;
      }
    }

    const actionId = createId("enforce");
    const evidenceBundleId = createId("evidence");
    const createdAt = nowIso();
    const sessionSnapshot = this.snapshotUserSessions(targetUserId);

    this.store.enforcementEvidenceBundles.set(evidenceBundleId, {
      evidenceBundleId,
      userId: targetUserId,
      sourceActionId: actionId,
      evidenceType: "ADMIN_NOTE",
      summary: input.reasonMessage,
      metadata: {
        reasonCode: input.reasonCode,
        adminUserId
      },
      createdAt
    });

    const action: UserEnforcementAction = {
      actionId,
      userId: targetUserId,
      statusApplied: input.status,
      source: "ADMIN_POLICY",
      scope: input.scope,
      reviewStatus: "UPHELD",
      reasonCode: input.reasonCode,
      reasonMessage: input.reasonMessage,
      appealEligible: true,
      evidenceBundleId,
      createdAt
    };
    this.store.userEnforcementActions.set(actionId, action);
    this.setUserRestriction(user, {
      actionId,
      status: input.status,
      reasonCode: input.reasonCode,
      reasonMessage: input.reasonMessage,
      source: "ADMIN_POLICY",
      scope: input.scope,
      reviewStatus: "UPHELD"
    });
    const auditEntry = this.appendAuditLog({
      actorUserId: adminUserId,
      action: "USER_ENFORCEMENT_APPLIED",
      entityId: targetUserId,
      note: input.reasonCode,
      before,
      after: {
        status: user.status,
        actionId
      }
    });
    try {
      await this.persistence.withTransaction(async (tx) => {
        await this.clearUserSessions(targetUserId, tx);
        await tx.upsertEvidenceBundle(this.store.enforcementEvidenceBundles.get(evidenceBundleId)!);
        await tx.upsertEnforcementAction(action);
        await tx.upsertUser(user);
        await tx.appendAuditLog(auditEntry);
        await tx.enqueueOutboxEvent({
          eventId: createId("evt"),
          aggregateType: "USER",
          aggregateId: targetUserId,
          eventType: "USER_ENFORCEMENT_APPLIED",
          payload: {
            userId: targetUserId,
            actionId,
            status: user.status,
            reasonCode: input.reasonCode
          },
          availableAt: nowIso()
        });
      });

      return ok({
        userId: targetUserId,
        status: user.status,
        actionId
      });
    } catch (error) {
      this.store.users.set(targetUserId, userSnapshot);
      this.store.enforcementEvidenceBundles.delete(evidenceBundleId);
      this.store.userEnforcementActions.delete(actionId);
      this.restoreUserSessions(targetUserId, sessionSnapshot);
      this.store.auditLogs.length = auditLogLength;
      throw error;
    }
  }

  async createAppeal(userId: string, input: { actionId?: string; appealText: string }) {
    const user = this.store.users.get(userId);
    if (!user) {
      return fail("USER_NOT_FOUND", "사용자를 찾을 수 없어요.");
    }

    if (!input.appealText.trim()) {
      return fail("APPEAL_TEXT_REQUIRED", "이의제기 내용을 입력해 주세요.");
    }

    const action = input.actionId ? this.store.userEnforcementActions.get(input.actionId) : this.getLatestAction(userId);
    if (!action || action.userId !== userId) {
      return fail("ENFORCEMENT_ACTION_NOT_FOUND", "이의제기 대상 제재를 찾을 수 없어요.");
    }

    if (!action.appealEligible) {
      return fail("APPEAL_NOT_ALLOWED", "이 제재는 이의제기를 지원하지 않아요.");
    }

    const existingOpenAppeal = [...this.store.userAppeals.values()].find(
      (appeal) =>
        appeal.actionId === action.actionId &&
        (appeal.status === "SUBMITTED" || appeal.status === "MORE_INFO_REQUESTED")
    );
    if (existingOpenAppeal) {
      return fail("APPEAL_ALREADY_OPEN", "이미 진행 중인 이의제기가 있어요.", {
        appealId: existingOpenAppeal.appealId
      });
    }

    const submittedAt = nowIso();
    const userSnapshot = structuredClone(user);
    const actionSnapshot = structuredClone(action);
    const auditLogLength = this.store.auditLogs.length;
    const appeal: UserAppeal = {
      appealId: createId("appeal"),
      userId,
      actionId: action.actionId,
      appealText: input.appealText,
      status: "SUBMITTED",
      submittedAt,
      lastUpdatedAt: submittedAt
    };
    this.store.userAppeals.set(appeal.appealId, appeal);
    action.reviewStatus = "APPEAL_PENDING";

    if (user.status !== "WITHDRAWN") {
      user.status = "APPEAL_PENDING";
      if (user.restriction) {
        user.restriction.reviewStatus = "APPEAL_PENDING";
        user.restriction.updatedAt = submittedAt;
      }
    }

    const auditEntry = this.appendAuditLog({
      actorUserId: userId,
      action: "USER_APPEAL_SUBMITTED",
      entityId: userId,
      note: action.actionId,
      after: {
        appealId: appeal.appealId,
        actionId: action.actionId
      }
    });
    try {
      await this.persistence.withTransaction(async (tx) => {
        await tx.upsertAppeal(appeal);
        await tx.upsertEnforcementAction(action);
        await tx.upsertUser(user);
        await tx.appendAuditLog(auditEntry);
        await tx.enqueueOutboxEvent({
          eventId: createId("evt"),
          aggregateType: "USER",
          aggregateId: userId,
          eventType: "USER_APPEAL_SUBMITTED",
          payload: {
            userId,
            appealId: appeal.appealId,
            actionId: action.actionId
          },
          availableAt: nowIso()
        });
      });

      return ok(appeal);
    } catch (error) {
      this.store.users.set(userId, userSnapshot);
      this.store.userEnforcementActions.set(action.actionId, actionSnapshot);
      this.store.userAppeals.delete(appeal.appealId);
      this.store.auditLogs.length = auditLogLength;
      throw error;
    }
  }

  getAppeal(userId: string, appealId: string) {
    const appeal = this.store.userAppeals.get(appealId);
    if (!appeal || appeal.userId !== userId) {
      return fail("APPEAL_NOT_FOUND", "이의제기를 찾을 수 없어요.");
    }

    return ok({
      ...appeal,
      action: this.store.userEnforcementActions.get(appeal.actionId),
      reviewActions: [...this.store.appealReviewActions.values()]
        .filter((action) => action.appealId === appealId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    });
  }

  requestMoreInfo(adminUserId: string, appealId: string, note?: string) {
    return this.reviewAppeal(adminUserId, appealId, "REQUEST_MORE_INFO", note);
  }

  approveAppeal(adminUserId: string, appealId: string, note?: string) {
    return this.reviewAppeal(adminUserId, appealId, "APPROVE", note);
  }

  rejectAppeal(adminUserId: string, appealId: string, note?: string) {
    return this.reviewAppeal(adminUserId, appealId, "REJECT", note);
  }

  async reinstateAction(adminUserId: string, actionId: string, note?: string) {
    const action = this.store.userEnforcementActions.get(actionId);
    if (!action) {
      return fail("ENFORCEMENT_ACTION_NOT_FOUND", "제재 이력을 찾을 수 없어요.");
    }

    const user = this.store.users.get(action.userId);
    if (!user) {
      return fail("USER_NOT_FOUND", "사용자를 찾을 수 없어요.");
    }

    const actionSnapshot = structuredClone(action);
    const userSnapshot = structuredClone(user);
    const auditLogLength = this.store.auditLogs.length;
    action.reviewStatus = "REINSTATED";
    action.liftedAt = nowIso();
    action.liftedByActionId = createId("reinstate");
    user.status = "REINSTATED";
    user.restriction = undefined;
    user.lastActiveAt = action.liftedAt;

    const auditEntry = this.appendAuditLog({
      actorUserId: adminUserId,
      action: "USER_REINSTATED",
      entityId: action.userId,
      note,
      after: {
        status: user.status,
        actionId
      }
    });
    try {
      await this.persistence.withTransaction(async (tx) => {
        await tx.upsertEnforcementAction(action);
        await tx.upsertUser(user);
        await tx.appendAuditLog(auditEntry);
        await tx.enqueueOutboxEvent({
          eventId: createId("evt"),
          aggregateType: "USER",
          aggregateId: user.userId,
          eventType: "USER_REINSTATED",
          payload: {
            userId: user.userId,
            actionId
          },
          availableAt: nowIso()
        });
      });

      return ok({
        userId: user.userId,
        status: user.status,
        actionId
      });
    } catch (error) {
      this.store.userEnforcementActions.set(actionId, actionSnapshot);
      this.store.users.set(user.userId, userSnapshot);
      this.store.auditLogs.length = auditLogLength;
      throw error;
    }
  }

  private async reviewAppeal(adminUserId: string, appealId: string, decision: AppealDecision, note?: string) {
    const appeal = this.store.userAppeals.get(appealId);
    if (!appeal) {
      return fail("APPEAL_NOT_FOUND", "이의제기를 찾을 수 없어요.");
    }

    const action = this.store.userEnforcementActions.get(appeal.actionId);
    const user = this.store.users.get(appeal.userId);
    if (!action || !user) {
      return fail("ENFORCEMENT_ACTION_NOT_FOUND", "연결된 제재를 찾을 수 없어요.");
    }

    const createdAt = nowIso();
    const reviewActionId = createId("appeal-review");
    const appealSnapshot = structuredClone(appeal);
    const actionSnapshot = structuredClone(action);
    const userSnapshot = structuredClone(user);
    const auditLogLength = this.store.auditLogs.length;
    this.store.appealReviewActions.set(reviewActionId, {
      reviewActionId,
      appealId,
      actionId: action.actionId,
      reviewerUserId: adminUserId,
      decision,
      note,
      createdAt
    });
    const reviewAction = this.store.appealReviewActions.get(reviewActionId)!;

    if (decision === "REQUEST_MORE_INFO") {
      appeal.status = "MORE_INFO_REQUESTED";
      appeal.lastUpdatedAt = createdAt;
      action.reviewStatus = "MORE_INFO_REQUESTED";
      if (user.restriction) {
        user.restriction.reviewStatus = "MORE_INFO_REQUESTED";
        user.restriction.updatedAt = createdAt;
      }
      const auditEntry = this.appendAuditLog({
        actorUserId: adminUserId,
        action: "APPEAL_MORE_INFO_REQUESTED",
        entityId: user.userId,
        note,
        after: {
          appealId,
          actionId: action.actionId,
          appealStatus: appeal.status
        }
      });
      try {
        await this.persistence.withTransaction(async (tx) => {
          await tx.upsertAppealReviewAction(reviewAction);
          await tx.upsertAppeal(appeal);
          await tx.upsertEnforcementAction(action);
          await tx.upsertUser(user);
          await tx.appendAuditLog(auditEntry);
          await tx.enqueueOutboxEvent({
            eventId: createId("evt"),
            aggregateType: "APPEAL",
            aggregateId: appealId,
            eventType: "APPEAL_MORE_INFO_REQUESTED",
            payload: {
              appealId,
              actionId: action.actionId,
              userId: user.userId
            },
            availableAt: nowIso()
          });
        });
        return ok({ appealId, status: appeal.status });
      } catch (error) {
        this.store.appealReviewActions.delete(reviewActionId);
        this.store.userAppeals.set(appealId, appealSnapshot);
        this.store.userEnforcementActions.set(action.actionId, actionSnapshot);
        this.store.users.set(user.userId, userSnapshot);
        this.store.auditLogs.length = auditLogLength;
        throw error;
      }
    }

    if (decision === "APPROVE") {
      appeal.status = "APPROVED";
      appeal.lastUpdatedAt = createdAt;
      action.reviewStatus = "REINSTATED";
      action.liftedAt = createdAt;
      action.liftedByActionId = reviewActionId;
      user.status = "REINSTATED";
      user.restriction = undefined;
      user.lastActiveAt = createdAt;
      const auditEntry = this.appendAuditLog({
        actorUserId: adminUserId,
        action: "APPEAL_APPROVED",
        entityId: user.userId,
        note,
        after: {
          appealId,
          actionId: action.actionId,
          appealStatus: appeal.status,
          userStatus: user.status
        }
      });
      try {
        await this.persistence.withTransaction(async (tx) => {
          await tx.upsertAppealReviewAction(reviewAction);
          await tx.upsertAppeal(appeal);
          await tx.upsertEnforcementAction(action);
          await tx.upsertUser(user);
          await tx.appendAuditLog(auditEntry);
          await tx.enqueueOutboxEvent({
            eventId: createId("evt"),
            aggregateType: "APPEAL",
            aggregateId: appealId,
            eventType: "APPEAL_APPROVED",
            payload: {
              appealId,
              actionId: action.actionId,
              userId: user.userId
            },
            availableAt: nowIso()
          });
        });
        return ok({ appealId, status: appeal.status, userStatus: user.status });
      } catch (error) {
        this.store.appealReviewActions.delete(reviewActionId);
        this.store.userAppeals.set(appealId, appealSnapshot);
        this.store.userEnforcementActions.set(action.actionId, actionSnapshot);
        this.store.users.set(user.userId, userSnapshot);
        this.store.auditLogs.length = auditLogLength;
        throw error;
      }
    }

    appeal.status = "REJECTED";
    appeal.lastUpdatedAt = createdAt;
    action.reviewStatus = "UPHELD";
    user.status = action.statusApplied;
    if (user.restriction) {
      user.restriction.reviewStatus = "UPHELD";
      user.restriction.updatedAt = createdAt;
    }
    const auditEntry = this.appendAuditLog({
      actorUserId: adminUserId,
      action: "APPEAL_REJECTED",
      entityId: user.userId,
      note,
      after: {
        appealId,
        actionId: action.actionId,
        appealStatus: appeal.status,
        userStatus: user.status
      }
    });
    try {
      await this.persistence.withTransaction(async (tx) => {
        await tx.upsertAppealReviewAction(reviewAction);
        await tx.upsertAppeal(appeal);
        await tx.upsertEnforcementAction(action);
        await tx.upsertUser(user);
        await tx.appendAuditLog(auditEntry);
        await tx.enqueueOutboxEvent({
          eventId: createId("evt"),
          aggregateType: "APPEAL",
          aggregateId: appealId,
          eventType: "APPEAL_REJECTED",
          payload: {
            appealId,
            actionId: action.actionId,
            userId: user.userId
          },
          availableAt: nowIso()
        });
      });

      return ok({ appealId, status: appeal.status, userStatus: user.status });
    } catch (error) {
      this.store.appealReviewActions.delete(reviewActionId);
      this.store.userAppeals.set(appealId, appealSnapshot);
      this.store.userEnforcementActions.set(action.actionId, actionSnapshot);
      this.store.users.set(user.userId, userSnapshot);
      this.store.auditLogs.length = auditLogLength;
      throw error;
    }
  }
}
