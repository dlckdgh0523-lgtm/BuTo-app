import { productConfig } from "../../../../packages/config/src/index.ts";
import { fail, ok, type ApiResponse, type AuthenticatedUserSummary, type FaceAuthIntent, type FaceAuthSession } from "../../../../packages/contracts/src/index.ts";

import type { DemoUser, InMemoryStore } from "../store.ts";
import { createId, nowIso } from "../utils.ts";

export class AuthService {
  constructor(private readonly store: InMemoryStore) {}

  loginCallback(userId: string): ApiResponse<{
    accessToken: string;
    refreshToken: string;
    user: AuthenticatedUserSummary;
    needsSafetyAcknowledgement: boolean;
    needsFaceAuth: boolean;
  }> {
    const currentUser = this.store.users.get(userId);
    if (!currentUser) {
      return fail("USER_NOT_FOUND", "사용자를 찾을 수 없어요.");
    }

    currentUser.safetyAcknowledgedAt = undefined;

    const user = this.getMe(userId);
    if (user.resultType === "ERROR") {
      return user;
    }

    const accessToken = createId("access");
    const refreshToken = createId("refresh");
    this.store.accessSessions.set(accessToken, {
      userId,
      refreshToken,
      issuedAt: nowIso()
    });

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
      .filter((session) => session.userId === userId)
      .sort((left, right) => right.expiresAt.localeCompare(left.expiresAt))[0];

    return ok({
      userId: user.userId,
      nickname: user.nickname,
      adultVerified: user.adultVerified,
      status: user.status,
      roleFlags: user.roleFlags,
      needsSafetyAcknowledgement: !user.safetyAcknowledgedAt,
      faceAuthValid: Boolean(currentFaceAuth && "verifiedAt" in currentFaceAuth && Date.parse(currentFaceAuth.expiresAt) > Date.now()),
      runnerVerified: user.runnerVerified
    });
  }

  verifyAdult(userId: string): ApiResponse<{ adultVerified: boolean; verifiedAt: string; ciHash: string }> {
    const user = this.store.users.get(userId);
    if (!user) {
      return fail("USER_NOT_FOUND", "사용자를 찾을 수 없어요.");
    }

    user.adultVerified = true;
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

  authenticateAccessToken(accessToken: string): ApiResponse<Pick<DemoUser, "userId" | "status" | "roleFlags">> {
    const session = this.store.accessSessions.get(accessToken);
    if (!session) {
      return fail("AUTH_REQUIRED", "로그인이 필요해요.");
    }

    const user = this.store.users.get(session.userId);
    if (!user) {
      return fail("USER_NOT_FOUND", "사용자를 찾을 수 없어요.");
    }

    if (user.status !== "ACTIVE") {
      return fail("ACCOUNT_NOT_ACTIVE", "현재 계정 상태에서는 요청을 처리할 수 없어요.");
    }

    return ok({
      userId: user.userId,
      status: user.status,
      roleFlags: user.roleFlags
    });
  }

  createFaceAuthSession(userId: string, intent: FaceAuthSession["intent"], jobDraftId?: string) {
    const user = this.store.users.get(userId);
    if (!user || !user.adultVerified) {
      return fail("ADULT_VERIFICATION_REQUIRED", "성인 인증 후 이용할 수 있어요.");
    }

    const session = {
      faceAuthSessionId: createId("face"),
      userId,
      jobDraftId,
      intent,
      provider: "TOSS_ONE_TOUCH_AUTH" as const,
      expiresAt: new Date(Date.now() + productConfig.faceAuthWindowMinutes * 60_000).toISOString()
    };

    this.store.faceAuthSessions.set(session.faceAuthSessionId, session);
    return ok(session);
  }

  completeFaceAuth(userId: string, faceAuthSessionId: string, providerTransactionId: string, result: "SUCCESS" | "FAIL" | "CANCELLED") {
    const session = this.store.faceAuthSessions.get(faceAuthSessionId);
    if (!session || session.userId !== userId) {
      return fail("FACE_AUTH_SESSION_NOT_FOUND", "토스 인증 세션이 유효하지 않아요.");
    }

    if (result !== "SUCCESS") {
      this.store.faceAuthSessions.delete(faceAuthSessionId);
      return ok({
        verified: false,
        verifiedAt: nowIso(),
        validUntil: session.expiresAt,
        riskCode: result
      });
    }

    session.expiresAt = new Date(Date.now() + productConfig.faceAuthWindowMinutes * 60_000).toISOString();
    (session as FaceAuthSession & { tossFaceTxId?: string; verifiedAt?: string }).tossFaceTxId = providerTransactionId;
    (session as FaceAuthSession & { tossFaceTxId?: string; verifiedAt?: string }).verifiedAt = nowIso();

    return ok({
      verified: true,
      verifiedAt: nowIso(),
      validUntil: session.expiresAt,
      riskCode: "NONE"
    });
  }

  assertValidFaceAuth(userId: string, faceAuthSessionId: string, expectedIntent: FaceAuthIntent) {
    const session = this.store.faceAuthSessions.get(faceAuthSessionId);
    if (!session || session.userId !== userId) {
      return fail("FACE_AUTH_REQUIRED", "토스 원터치 인증이 필요해요.");
    }

    if (!("verifiedAt" in session)) {
      return fail("FACE_AUTH_NOT_COMPLETED", "토스 인증 완료가 필요해요.");
    }

    if (Date.parse(session.expiresAt) <= Date.now()) {
      return fail("FACE_AUTH_EXPIRED", "토스 인증이 만료되었어요.");
    }

    if (session.intent !== expectedIntent) {
      return fail("FACE_AUTH_INTENT_MISMATCH", "이 인증 세션은 해당 작업에 사용할 수 없어요.");
    }

    return ok({
      userId,
      intent: session.intent,
      verified: true,
      verifiedAt: nowIso(),
      validUntil: session.expiresAt
    });
  }
}
