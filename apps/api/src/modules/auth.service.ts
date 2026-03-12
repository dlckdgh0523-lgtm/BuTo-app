import { productConfig } from "../../../../packages/config/src/index.ts";
import { fail, ok, type ApiResponse, type AuthenticatedUserSummary, type FaceAuthIntent, type FaceAuthSession } from "../../../../packages/contracts/src/index.ts";

import type { ApiRuntimeConfig } from "../env.ts";
import type { DemoUser, InMemoryStore } from "../store.ts";
import { createId, createSecureToken, decodeBase64Url, encodeBase64Url, nowIso, safeEqualText, signValue } from "../utils.ts";
import type { PersistenceAdapter } from "../persistence.ts";
import type { EnforcementService } from "./enforcement.service.ts";
import type { TossAuthProvider } from "./toss-auth-provider.ts";

interface AccessTokenPayload {
  sub: string;
  iat: number;
  exp: number;
}

interface RefreshTokenPayload {
  userId: string;
  refreshToken: string;
}

export class AuthService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly tossAuthProvider: TossAuthProvider,
    private readonly runtimeConfig: ApiRuntimeConfig,
    private readonly enforcementService: EnforcementService,
    private readonly persistence: PersistenceAdapter
  ) {}

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
    snapshot: ReturnType<AuthService["snapshotUserSessions"]>
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

  private buildAccountStatusFailure(user: DemoUser) {
    const details = user.restriction
      ? {
          accountStatus: user.status,
          reasonCode: user.restriction.reasonCode,
          reasonMessage: user.restriction.reasonMessage,
          source: user.restriction.source,
          scope: user.restriction.scope,
          reviewStatus: user.restriction.reviewStatus,
          actionId: user.restriction.actionId,
          updatedAt: user.restriction.updatedAt,
          supportAction: user.restriction.supportAction
        }
      : {
          accountStatus: user.status
        };

    if (user.status === "RESTRICTED") {
      return fail("ACCOUNT_RESTRICTED", "운영정책에 의해 계정 이용이 일시 제한되었어요.", details);
    }

    if (user.status === "SUSPENDED") {
      return fail("ACCOUNT_SUSPENDED", "운영정책에 의해 계정 이용이 정지되었어요.", details);
    }

    if (user.status === "APPEAL_PENDING") {
      return fail("ACCOUNT_APPEAL_PENDING", "이의제기 검토가 진행 중이에요.", details);
    }

    if (user.status === "PERMANENTLY_BANNED") {
      return fail("ACCOUNT_PERMANENTLY_BANNED", "운영정책에 의해 계정이 영구 정지되었어요.", details);
    }

    if (user.status === "WITHDRAWN") {
      return fail("ACCOUNT_WITHDRAWN", "회원 탈퇴 처리된 계정이에요.", {
        ...details,
        withdrawnAt: user.withdrawnAt
      });
    }

    return fail("ACCOUNT_NOT_ACTIVE", "현재 계정 상태에서는 요청을 처리할 수 없어요.", details);
  }

  private buildOpenJobIdsForUser(userId: string) {
    const terminalStatuses = new Set(["COMPLETED", "CANCELLED", "FAILED_SETTLEMENT"]);
    return [...this.store.jobs.values()]
      .filter(
        (job) =>
          (job.clientUserId === userId || job.matchedRunnerUserId === userId) &&
          !terminalStatuses.has(job.status)
      )
      .map((job) => job.jobId);
  }

  private createAccessToken(userId: string) {
    const issuedAt = Math.floor(Date.now() / 1000);
    const payload: AccessTokenPayload = {
      sub: userId,
      iat: issuedAt,
      exp: issuedAt + productConfig.accessTokenTtlSeconds
    };

    const encodedHeader = encodeBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const encodedPayload = encodeBase64Url(JSON.stringify(payload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signature = signValue(signingInput, this.runtimeConfig.authTokenSecret);
    return `${signingInput}.${signature}`;
  }

  private async createRefreshSession(userId: string) {
    await this.pruneExpiredLoginStates();
    await this.pruneExpiredRefreshSessions();

    const issuedAt = nowIso();
    const refreshToken = createSecureToken();
    const refreshSession = {
      userId,
      issuedAt,
      expiresAt: new Date(Date.now() + this.runtimeConfig.refreshTokenTtlDays * 24 * 60 * 60_000).toISOString()
    };
    this.store.refreshSessions.set(refreshToken, refreshSession);
    await this.persistence.upsertRefreshSession(refreshToken, refreshSession);

    const sessionsForUser = [...this.store.refreshSessions.entries()]
      .filter(([, session]) => session.userId === userId)
      .sort((left, right) => left[1].issuedAt.localeCompare(right[1].issuedAt));

    while (sessionsForUser.length > this.runtimeConfig.maxRefreshSessionsPerUser) {
      const oldest = sessionsForUser.shift();
      if (!oldest) {
        break;
      }

      this.store.refreshSessions.delete(oldest[0]);
      await this.persistence.deleteRefreshSession(oldest[0]);
    }

    return refreshToken;
  }

  private async pruneExpiredLoginStates() {
    const now = Date.now();
    for (const [state, pendingState] of this.store.loginStates.entries()) {
      if (Date.parse(pendingState.expiresAt) <= now) {
        this.store.loginStates.delete(state);
        await this.persistence.deleteLoginState(state);
      }
    }
  }

  private async pruneExpiredRefreshSessions() {
    const now = Date.now();
    for (const [refreshToken, session] of this.store.refreshSessions.entries()) {
      if (Date.parse(session.expiresAt) <= now) {
        this.store.refreshSessions.delete(refreshToken);
        await this.persistence.deleteRefreshSession(refreshToken);
      }
    }
  }

  async startLogin() {
    await this.pruneExpiredLoginStates();
    const state = createSecureToken(24);
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + this.runtimeConfig.loginStateTtlMinutes * 60_000).toISOString();
    const loginState = {
      state,
      createdAt,
      expiresAt
    };
    this.store.loginStates.set(state, loginState);
    await this.persistence.upsertLoginState(loginState);

    return ok({
      state,
      expiresAt
    });
  }

  private parseAccessToken(accessToken: string): ApiResponse<AccessTokenPayload> {
    const parts = accessToken.split(".");
    if (parts.length !== 3) {
      return fail("AUTH_REQUIRED", "로그인이 필요해요.");
    }

    const [encodedHeader, encodedPayload, signature] = parts;
    const expectedSignature = signValue(`${encodedHeader}.${encodedPayload}`, this.runtimeConfig.authTokenSecret);
    if (!safeEqualText(signature, expectedSignature)) {
      return fail("AUTH_REQUIRED", "로그인이 필요해요.");
    }

    try {
      const payload = JSON.parse(decodeBase64Url(encodedPayload)) as AccessTokenPayload;
      if (payload.exp <= Math.floor(Date.now() / 1000)) {
        return fail("AUTH_REQUIRED", "로그인이 필요해요.");
      }

      return ok(payload);
    } catch {
      return fail("AUTH_REQUIRED", "로그인이 필요해요.");
    }
  }

  async loginCallback(input: { authorizationCode: string; state: string }): Promise<ApiResponse<{
    accessToken: string;
    refreshToken: string;
    user: AuthenticatedUserSummary;
    needsSafetyAcknowledgement: boolean;
    needsFaceAuth: boolean;
  }>> {
    await this.pruneExpiredLoginStates();
    const pendingState = this.store.loginStates.get(input.state);
    if (!pendingState || Date.parse(pendingState.expiresAt) <= Date.now()) {
      return fail("TOSS_LOGIN_STATE_INVALID", "토스 로그인 상태값이 유효하지 않아요.");
    }

    this.store.loginStates.delete(input.state);
    await this.persistence.deleteLoginState(input.state);

    const authorizationCode = input.authorizationCode;
    if (!authorizationCode) {
      return fail("TOSS_AUTH_CODE_REQUIRED", "토스 로그인 인가 코드가 필요해요.");
    }

    let loginIdentity;
    try {
      loginIdentity = await this.tossAuthProvider.exchangeLoginAuthorizationCode({ authorizationCode });
    } catch (error) {
      return fail("TOSS_LOGIN_EXCHANGE_FAILED", "토스 로그인 검증에 실패했어요.", {
        reason: error instanceof Error ? error.message : "unknown"
      });
    }

    const currentUser = [...this.store.users.values()].find((user) => user.ciHash === loginIdentity.ciHash);
    if (!currentUser) {
      return fail("USER_REGISTRATION_REQUIRED", "연결된 부토 계정을 찾을 수 없어요.");
    }

    if (loginIdentity.userKey) {
      currentUser.tossUserKey = loginIdentity.userKey;
    }

    if (!this.enforcementService.canAuthenticateForRestrictionShell(currentUser.status)) {
      return this.buildAccountStatusFailure(currentUser);
    }

    currentUser.safetyAcknowledgedAt = undefined;
    await this.persistence.upsertUser(currentUser);

    const user = this.getMe(currentUser.userId);
    if (user.resultType === "ERROR") {
      return user;
    }

    const accessToken = this.createAccessToken(currentUser.userId);
    const refreshToken = await this.createRefreshSession(currentUser.userId);

    return ok({
      accessToken,
      refreshToken,
      user: user.success,
      needsSafetyAcknowledgement: user.success.needsSafetyAcknowledgement,
      needsFaceAuth: !user.success.faceAuthValid
    });
  }

  getMe(userId: string): ApiResponse<AuthenticatedUserSummary> {
    const user = this.store.users.get(userId);
    if (!user) {
      return fail("USER_NOT_FOUND", "사용자를 찾을 수 없어요.");
    }

    const currentFaceAuth = [...this.store.faceAuthSessions.values()]
      .filter(
        (session) =>
          session.userId === userId &&
          Boolean(session.verifiedAt) &&
          !session.consumedAt &&
          Date.parse(session.expiresAt) > Date.now()
      )
      .sort((left, right) => right.expiresAt.localeCompare(left.expiresAt))[0];

    return ok({
      userId: user.userId,
      nickname: user.nickname,
      adultVerified: user.adultVerified,
      status: user.status,
      roleFlags: user.roleFlags,
      needsSafetyAcknowledgement: !user.safetyAcknowledgedAt,
      faceAuthValid: Boolean(currentFaceAuth?.verifiedAt && !currentFaceAuth.consumedAt && Date.parse(currentFaceAuth.expiresAt) > Date.now()),
      runnerVerified: user.runnerVerified,
      restriction: user.restriction
    });
  }

  async verifyAdult(userId: string): Promise<ApiResponse<{ adultVerified: boolean; verifiedAt: string; ciHash: string }>> {
    const user = this.store.users.get(userId);
    if (!user) {
      return fail("USER_NOT_FOUND", "사용자를 찾을 수 없어요.");
    }

    user.adultVerified = true;
    await this.persistence.upsertUser(user);
    return ok({
      adultVerified: true,
      verifiedAt: nowIso(),
      ciHash: `ci_${userId}`
    });
  }

  reauth(userId: string): ApiResponse<{ reauthenticatedAt: string; validUntil: string }> {
    if (!this.store.users.has(userId)) {
      return fail("USER_NOT_FOUND", "사용자를 찾을 수 없어요.");
    }

    const reauthenticatedAt = nowIso();
    const validUntil = new Date(Date.now() + productConfig.sensitiveReauthWindowMinutes * 60_000).toISOString();
    return ok({ reauthenticatedAt, validUntil });
  }

  async refreshAccessToken(refreshToken: string): Promise<ApiResponse<{ accessToken: string; refreshToken: string }>> {
    await this.pruneExpiredRefreshSessions();
    if (!refreshToken) {
      return fail("REFRESH_TOKEN_REQUIRED", "리프레시 토큰이 필요해요.");
    }

    const session = this.store.refreshSessions.get(refreshToken);
    if (!session) {
      return fail("REFRESH_TOKEN_INVALID", "리프레시 토큰이 유효하지 않아요.");
    }

    const user = this.store.users.get(session.userId);
    if (!user) {
      return fail("USER_NOT_FOUND", "사용자를 찾을 수 없어요.");
    }

    if (!this.enforcementService.canAuthenticateForRestrictionShell(user.status)) {
      return this.buildAccountStatusFailure(user);
    }

    this.store.refreshSessions.delete(refreshToken);
    await this.persistence.deleteRefreshSession(refreshToken);
    const rotatedRefreshToken = await this.createRefreshSession(user.userId);

    return ok({
      accessToken: this.createAccessToken(user.userId),
      refreshToken: rotatedRefreshToken
    });
  }

  async logout(input: RefreshTokenPayload): Promise<ApiResponse<{ loggedOut: boolean }>> {
    await this.pruneExpiredRefreshSessions();
    if (!input.refreshToken) {
      return fail("REFRESH_TOKEN_REQUIRED", "리프레시 토큰이 필요해요.");
    }

    const session = this.store.refreshSessions.get(input.refreshToken);
    if (!session || session.userId !== input.userId) {
      return fail("REFRESH_TOKEN_INVALID", "리프레시 토큰이 유효하지 않아요.");
    }

    this.store.refreshSessions.delete(input.refreshToken);
    await this.persistence.deleteRefreshSession(input.refreshToken);
    return ok({ loggedOut: true });
  }

  async handleTossUnlink(input: { tossUserKey: string; reason?: string }) {
    if (!input.tossUserKey) {
      return fail("TOSS_UNLINK_USER_KEY_REQUIRED", "연결 해제 대상 userKey가 필요해요.");
    }

    const user = [...this.store.users.values()].find((entry) => entry.tossUserKey === input.tossUserKey);
    if (!user) {
      return ok({
        unlinked: true,
        foundUser: false
      });
    }

    const before = {
      tossUserKey: user.tossUserKey,
      safetyAcknowledgedAt: user.safetyAcknowledgedAt
    };
    const userSnapshot = structuredClone(user);
    const sessionSnapshot = this.snapshotUserSessions(user.userId);
    const auditLogLength = this.store.auditLogs.length;

    user.tossUserKey = undefined;
    user.safetyAcknowledgedAt = undefined;
    user.lastActiveAt = nowIso();

    const auditEntry = this.appendAuditLog({
      actorUserId: "system",
      action: "TOSS_UNLINKED",
      entityId: user.userId,
      note: input.reason ?? "토스 연결 끊기 콜백으로 세션을 정리했어요.",
      before,
      after: {
        tossUserKey: null,
        safetyAcknowledgedAt: null
      }
    });

    try {
      await this.persistence.withTransaction(async (tx) => {
        await this.clearUserSessions(user.userId, tx);
        await tx.upsertUser(user);
        await tx.appendAuditLog(auditEntry);
      });
    } catch (error) {
      this.store.users.set(user.userId, userSnapshot);
      this.restoreUserSessions(user.userId, sessionSnapshot);
      this.store.auditLogs.length = auditLogLength;
      throw error;
    }

    return ok({
      unlinked: true,
      foundUser: true,
      userId: user.userId
    });
  }

  authenticateAnyAccessToken(accessToken: string): ApiResponse<Pick<DemoUser, "userId" | "status" | "roleFlags">> {
    const token = this.parseAccessToken(accessToken);
    if (token.resultType === "ERROR") {
      return token;
    }

    const user = this.store.users.get(token.success.sub);
    if (!user) {
      return fail("USER_NOT_FOUND", "사용자를 찾을 수 없어요.");
    }

    if (!user.tossUserKey) {
      return fail("AUTH_REQUIRED", "토스 로그인 연결이 필요해요.");
    }

    return ok({
      userId: user.userId,
      status: user.status,
      roleFlags: user.roleFlags
    });
  }

  authenticateAccessToken(accessToken: string): ApiResponse<Pick<DemoUser, "userId" | "status" | "roleFlags">> {
    const authenticated = this.authenticateAnyAccessToken(accessToken);
    if (authenticated.resultType === "ERROR") {
      return authenticated;
    }

    const user = this.store.users.get(authenticated.success.userId);
    if (!user) {
      return fail("USER_NOT_FOUND", "사용자를 찾을 수 없어요.");
    }

    if (!this.enforcementService.isOperationalStatus(user.status)) {
      return this.buildAccountStatusFailure(user);
    }

    return authenticated;
  }

  async withdrawUser(userId: string, input: { confirmed: boolean; reason?: string }) {
    const user = this.store.users.get(userId);
    if (!user) {
      return fail("USER_NOT_FOUND", "사용자를 찾을 수 없어요.");
    }

    if (!input.confirmed) {
      return fail("WITHDRAWAL_CONFIRMATION_REQUIRED", "회원 탈퇴 확인이 필요해요.");
    }

    if (user.status === "WITHDRAWN") {
      return this.buildAccountStatusFailure(user);
    }

    const activeJobIds = this.buildOpenJobIdsForUser(userId);
    if (activeJobIds.length > 0) {
      return fail("WITHDRAWAL_NOT_ALLOWED", "진행 중인 거래나 분쟁이 종료된 후에만 탈퇴할 수 있어요.", {
        activeJobIds
      });
    }

    const withdrawnAt = nowIso();
    const withdrawalReason = input.reason?.trim() || "사용자 요청으로 회원 탈퇴 처리되었어요.";
    const before = {
      status: user.status,
      nickname: user.nickname
    };
    const userSnapshot = structuredClone(user);
    const sessionSnapshot = this.snapshotUserSessions(userId);
    const auditLogLength = this.store.auditLogs.length;

    try {
      user.status = "WITHDRAWN";
      user.withdrawnAt = withdrawnAt;
      user.restriction = undefined;
      user.safetyAcknowledgedAt = undefined;
      user.lastActiveAt = withdrawnAt;
      user.nickname = "탈퇴회원";

      const auditEntry = this.appendAuditLog({
        actorUserId: userId,
        action: "USER_WITHDRAWN",
        entityId: userId,
        note: withdrawalReason,
        before,
        after: {
          status: user.status,
          withdrawnAt,
          nickname: user.nickname
        }
      });

      await this.persistence.withTransaction(async (tx) => {
        await this.clearUserSessions(userId, tx);
        await tx.upsertUser(user);
        await tx.appendAuditLog(auditEntry);
        await tx.enqueueOutboxEvent({
          eventId: createId("evt"),
          aggregateType: "USER",
          aggregateId: userId,
          eventType: "USER_WITHDRAWN",
          payload: {
            userId,
            withdrawnAt
          },
          availableAt: nowIso()
        });
      });

      return ok({
        userId,
        status: user.status,
        withdrawnAt
      });
    } catch (error) {
      this.store.users.set(userId, userSnapshot);
      this.restoreUserSessions(userId, sessionSnapshot);
      this.store.auditLogs.length = auditLogLength;
      throw error;
    }
  }

  async createFaceAuthSession(userId: string, intent: FaceAuthSession["intent"], jobDraftId?: string) {
    const user = this.store.users.get(userId);
    if (!user || !user.adultVerified) {
      return fail("ADULT_VERIFICATION_REQUIRED", "성인 인증 후 이용할 수 있어요.");
    }

    let providerSession;
    try {
      providerSession = await this.tossAuthProvider.startOneTouchAuth({
        userCiHash: user.ciHash,
        intent,
        userId
      });
    } catch (error) {
      return fail("TOSS_ONE_TOUCH_REQUEST_FAILED", "토스 원터치 인증 요청에 실패했어요.", {
        reason: error instanceof Error ? error.message : "unknown"
      });
    }

    const session = {
      faceAuthSessionId: createId("face"),
      userId,
      jobDraftId,
      intent,
      provider: "TOSS_ONE_TOUCH_AUTH" as const,
      providerRequestId: providerSession.providerRequestId,
      txId: providerSession.txId,
      requestUrl: providerSession.requestUrl,
      expiresAt: providerSession.expiresAt
    };

    this.store.faceAuthSessions.set(session.faceAuthSessionId, session);
    await this.persistence.upsertFaceAuthSession(session);
    return ok(session);
  }

  async completeFaceAuth(userId: string, faceAuthSessionId: string) {
    const session = this.store.faceAuthSessions.get(faceAuthSessionId);
    if (!session || session.userId !== userId) {
      return fail("FACE_AUTH_SESSION_NOT_FOUND", "토스 인증 세션이 유효하지 않아요.");
    }

    if (!session.providerRequestId || !session.txId) {
      return fail("FACE_AUTH_SESSION_INVALID", "토스 인증 요청 정보가 누락되었어요.");
    }

    let providerResult;
    try {
      providerResult = await this.tossAuthProvider.completeOneTouchAuth({
        providerRequestId: session.providerRequestId,
        txId: session.txId
      });
    } catch (error) {
      return fail("TOSS_ONE_TOUCH_RESULT_FAILED", "토스 원터치 인증 결과 확인에 실패했어요.", {
        reason: error instanceof Error ? error.message : "unknown"
      });
    }

    if (providerResult.status !== "SUCCESS") {
      this.store.faceAuthSessions.delete(faceAuthSessionId);
      await this.persistence.deleteFaceAuthSession(faceAuthSessionId);
      return ok({
        verified: false,
        validUntil: session.expiresAt,
        riskCode: providerResult.status
      });
    }

    const user = this.store.users.get(userId);
    if (!user) {
      return fail("USER_NOT_FOUND", "사용자를 찾을 수 없어요.");
    }

    if (providerResult.ciHash && providerResult.ciHash !== user.ciHash) {
      this.store.faceAuthSessions.delete(faceAuthSessionId);
      await this.persistence.deleteFaceAuthSession(faceAuthSessionId);
      return fail("TOSS_ONE_TOUCH_IDENTITY_MISMATCH", "토스 인증 사용자와 현재 계정이 일치하지 않아요.");
    }

    session.expiresAt = new Date(Date.now() + productConfig.faceAuthWindowMinutes * 60_000).toISOString();
    session.tossFaceTxId = providerResult.providerTransactionId ?? session.txId;
    session.verifiedAt = providerResult.verifiedAt ?? nowIso();
    session.consumedAt = undefined;
    await this.persistence.upsertFaceAuthSession(session);

    return ok({
      verified: true,
      verifiedAt: providerResult.verifiedAt ?? nowIso(),
      validUntil: session.expiresAt,
      riskCode: "NONE"
    });
  }

  assertValidFaceAuth(userId: string, faceAuthSessionId: string, expectedIntent: FaceAuthIntent) {
    const session = this.store.faceAuthSessions.get(faceAuthSessionId);
    if (!session || session.userId !== userId) {
      return fail("FACE_AUTH_REQUIRED", "토스 원터치 인증이 필요해요.");
    }

    if (!session.verifiedAt) {
      return fail("FACE_AUTH_NOT_COMPLETED", "토스 인증 완료가 필요해요.");
    }

    if (Date.parse(session.expiresAt) <= Date.now()) {
      return fail("FACE_AUTH_EXPIRED", "토스 인증이 만료되었어요.");
    }

    if (session.intent !== expectedIntent) {
      return fail("FACE_AUTH_INTENT_MISMATCH", "이 인증 세션은 해당 작업에 사용할 수 없어요.");
    }

    if (session.consumedAt) {
      return fail("FACE_AUTH_ALREADY_USED", "이 토스 인증 세션은 이미 사용되었어요.");
    }

    return ok({
      userId,
      intent: session.intent,
      verified: true,
      verifiedAt: session.verifiedAt,
      validUntil: session.expiresAt
    });
  }

  async consumeFaceAuth(
    userId: string,
    faceAuthSessionId: string,
    expectedIntent: FaceAuthIntent,
    persistence: PersistenceAdapter = this.persistence
  ) {
    const valid = this.assertValidFaceAuth(userId, faceAuthSessionId, expectedIntent);
    if (valid.resultType === "ERROR") {
      return valid;
    }

    const session = this.store.faceAuthSessions.get(faceAuthSessionId);
    if (!session) {
      return fail("FACE_AUTH_REQUIRED", "토스 원터치 인증이 필요해요.");
    }

    session.consumedAt = nowIso();
    await persistence.upsertFaceAuthSession(session);
    return valid;
  }
}
