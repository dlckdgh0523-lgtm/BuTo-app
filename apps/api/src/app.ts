import { productConfig } from "../../../packages/config/src/index.ts";
import { fail, ok, type RouteDescriptor, type UserRole } from "../../../packages/contracts/src/index.ts";

import { createStore } from "./bootstrap.ts";
import { AdminService } from "./modules/admin.service.ts";
import { AuthService } from "./modules/auth.service.ts";
import { ChatService } from "./modules/chat.service.ts";
import { CommunityService } from "./modules/community.service.ts";
import { JobsService } from "./modules/jobs.service.ts";
import { PaymentsService } from "./modules/payments.service.ts";
import { ReportsService } from "./modules/reports.service.ts";
import { SafetyService } from "./modules/safety.service.ts";
import { TrackingService } from "./modules/tracking.service.ts";

export interface AppRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body?: Record<string, unknown>;
  headers: Headers;
}

type RequestContext =
  | { kind: "public" }
  | { kind: "internal"; actor: "SYSTEM" }
  | { kind: "user"; userId: string; roleFlags: string[] };

type RouteAuth = "public" | "user" | "admin" | "user-or-internal";
type AppHandler = (request: AppRequest, params: Record<string, string>, context: RequestContext) => unknown;

interface RouteRegistration extends RouteDescriptor {
  auth: RouteAuth;
  handler: AppHandler;
}

export function createApp() {
  const store = createStore();
  const auth = new AuthService(store);
  const safety = new SafetyService(store);
  const jobs = new JobsService(store, auth);
  const chat = new ChatService(store);
  const payments = new PaymentsService(store, auth);
  const reports = new ReportsService(store);
  const admin = new AdminService(store);
  const tracking = new TrackingService(store);
  const community = new CommunityService(store);

  const routes: RouteRegistration[] = [
    {
      method: "POST",
      path: "/auth/toss/login/callback",
      summary: "토스 로그인 콜백 처리",
      auth: "public",
      handler: (request) => auth.loginCallback(resolveLoginUserId(request.headers))
    },
    {
      method: "POST",
      path: "/auth/verify/adult",
      summary: "성인 인증 상태 확인",
      auth: "user",
      handler: (_request, _params, context) => auth.verifyAdult(requireUserContext(context).userId)
    },
    {
      method: "POST",
      path: "/auth/reauth",
      summary: "민감 행위 재인증",
      auth: "user",
      handler: (_request, _params, context) => auth.reauth(requireUserContext(context).userId)
    },
    {
      method: "GET",
      path: "/me",
      summary: "현재 사용자 상태 조회",
      auth: "user",
      handler: (_request, _params, context) => auth.getMe(requireUserContext(context).userId)
    },
    {
      method: "GET",
      path: "/safety/rules/current",
      summary: "안전수칙 조회",
      auth: "public",
      handler: () => safety.getCurrentRules()
    },
    {
      method: "POST",
      path: "/safety/acknowledgements",
      summary: "안전수칙 동의 저장",
      auth: "user",
      handler: (request, _params, context) =>
        safety.acknowledge(
          requireUserContext(context).userId,
          String(request.body?.rulesVersion ?? ""),
          Boolean(request.body?.acknowledged),
          request.body?.deviceHash ? String(request.body.deviceHash) : undefined
        )
    },
    {
      method: "POST",
      path: "/auth/toss-face/session",
      summary: "토스 원터치 인증 세션 시작",
      auth: "user",
      handler: (request, _params, context) =>
        auth.createFaceAuthSession(
          requireUserContext(context).userId,
          String(request.body?.intent ?? "JOB_CREATE") as "JOB_CREATE" | "PAYMENT_CONFIRM",
          request.body?.jobDraftId ? String(request.body.jobDraftId) : undefined
        )
    },
    {
      method: "POST",
      path: "/auth/toss-face/complete",
      summary: "토스 원터치 인증 결과 반영",
      auth: "user",
      handler: (request, _params, context) =>
        auth.completeFaceAuth(
          requireUserContext(context).userId,
          String(request.body?.faceAuthSessionId ?? ""),
          String(request.body?.providerTransactionId ?? ""),
          String(request.body?.result ?? "FAIL") as "SUCCESS" | "FAIL" | "CANCELLED"
        )
    },
    {
      method: "POST",
      path: "/jobs",
      summary: "의뢰 생성",
      auth: "user",
      handler: (request, _params, context) =>
        jobs.createJob(
          requireUserContext(context).userId,
          request.body as never,
          String(request.body?.faceAuthSessionId ?? "")
        )
    },
    {
      method: "GET",
      path: "/jobs/nearby",
      summary: "근처 의뢰 조회",
      auth: "user",
      handler: () => jobs.getNearbyJobs()
    },
    {
      method: "GET",
      path: "/jobs/:jobId",
      summary: "의뢰 상세 조회",
      auth: "user",
      handler: (_request, params, context) => {
        const userContext = requireUserContext(context);
        return jobs.getJob(params.jobId, userContext.userId, userContext.roleFlags);
      }
    },
    {
      method: "POST",
      path: "/jobs/:jobId/status",
      summary: "의뢰 상태 변경",
      auth: "user-or-internal",
      handler: (request, params, context) => {
        const actor = resolveActor(context, request.headers);
        if (actor.resultType === "ERROR") {
          return actor;
        }

        return jobs.updateStatus(
          params.jobId,
          context.kind === "user" ? context.userId : undefined,
          actor.success,
          String(request.body?.nextStatus ?? "") as never
        );
      }
    },
    {
      method: "POST",
      path: "/jobs/:jobId/assign",
      summary: "부르미 확정",
      auth: "user",
      handler: (request, params, context) => {
        const actor = resolveActor(context, request.headers);
        if (actor.resultType === "ERROR") {
          return actor;
        }

        if (actor.success !== "RUNNER") {
          return fail("MATCH_NOT_ALLOWED", "부르미만 의뢰를 수락할 수 있어요.");
        }

        return jobs.matchJob(
          params.jobId,
          requireUserContext(context).userId,
          request.body?.runnerUserId ? String(request.body.runnerUserId) : undefined
        );
      }
    },
    {
      method: "GET",
      path: "/jobs/:jobId/chat",
      summary: "채팅방 조회",
      auth: "user",
      handler: (_request, params, context) => chat.getRoom(params.jobId, requireUserContext(context).userId)
    },
    {
      method: "POST",
      path: "/jobs/:jobId/chat/messages",
      summary: "채팅 메시지 전송",
      auth: "user",
      handler: (request, params, context) =>
        chat.sendMessage(
          params.jobId,
          requireUserContext(context).userId,
          String(request.body?.body ?? ""),
          String(request.body?.messageType ?? "text") as "text" | "image"
        )
    },
    {
      method: "POST",
      path: "/jobs/:jobId/location-log",
      summary: "위치 로그 저장",
      auth: "user",
      handler: (request, params, context) =>
        tracking.logLocation(params.jobId, requireUserContext(context).userId, {
          lat: Number(request.body?.lat ?? 0),
          lng: Number(request.body?.lng ?? 0),
          accuracy: Number(request.body?.accuracy ?? 999),
          source: String(request.body?.source ?? "app") as "app" | "background" | "manual"
        })
    },
    {
      method: "POST",
      path: "/jobs/:jobId/proof-photo/complete",
      summary: "증빙 사진 등록",
      auth: "user",
      handler: (request, params, context) =>
        tracking.completeProof(params.jobId, requireUserContext(context).userId, {
          proofType: String(request.body?.proofType ?? "pickup") as "pickup" | "delivery",
          s3Key: String(request.body?.s3Key ?? "")
        })
    },
    {
      method: "POST",
      path: "/payments/jobs/:jobId/init",
      summary: "결제 주문 생성",
      auth: "user",
      handler: (_request, params, context) => payments.initPayment(params.jobId, requireUserContext(context).userId)
    },
    {
      method: "POST",
      path: "/payments/jobs/:jobId/confirm",
      summary: "결제 승인 및 held 처리",
      auth: "user",
      handler: (request, params, context) =>
        payments.confirmPayment(
          params.jobId,
          requireUserContext(context).userId,
          String(request.body?.paymentOrderId ?? ""),
          String(request.body?.faceAuthSessionId ?? "")
        )
    },
    {
      method: "POST",
      path: "/payouts/jobs/:jobId/release",
      summary: "정산 릴리스 가능 여부 평가",
      auth: "admin",
      handler: (_request, params) => payments.evaluateRelease(params.jobId)
    },
    {
      method: "POST",
      path: "/reviews",
      summary: "리뷰 작성",
      auth: "user",
      handler: (request, _params, context) =>
        community.createReview(requireUserContext(context).userId, {
          jobId: String(request.body?.jobId ?? ""),
          targetUserId: String(request.body?.targetUserId ?? ""),
          ratingValue: Number(request.body?.ratingValue ?? 0),
          body: String(request.body?.body ?? "")
        })
    },
    {
      method: "GET",
      path: "/users/:userId/reviews",
      summary: "사용자 리뷰 조회",
      auth: "user",
      handler: (_request, params) => community.listUserReviews(params.userId)
    },
    {
      method: "GET",
      path: "/community/posts",
      summary: "커뮤니티 게시물 조회",
      auth: "user",
      handler: () => community.listPosts()
    },
    {
      method: "POST",
      path: "/community/posts",
      summary: "커뮤니티 게시물 작성",
      auth: "user",
      handler: (request, _params, context) =>
        community.createPost(requireUserContext(context).userId, {
          title: String(request.body?.title ?? ""),
          body: String(request.body?.body ?? ""),
          imageUrl: request.body?.imageUrl ? String(request.body.imageUrl) : undefined
        })
    },
    {
      method: "POST",
      path: "/reports",
      summary: "일반 신고 생성",
      auth: "user",
      handler: (request, _params, context) =>
        reports.createReport(
          request.headers.get("idempotency-key") ?? undefined,
          requireUserContext(context).userId,
          {
            jobId: request.body?.jobId ? String(request.body.jobId) : undefined,
            targetUserId: String(request.body?.targetUserId ?? ""),
            reportType: String(request.body?.reportType ?? "OTHER"),
            detail: request.body?.detail ? String(request.body.detail) : undefined
          }
        )
    },
    {
      method: "POST",
      path: "/emergency-events",
      summary: "긴급 이벤트 생성",
      auth: "user",
      handler: (request, _params, context) =>
        reports.createEmergency(
          request.headers.get("idempotency-key") ?? undefined,
          requireUserContext(context).userId,
          {
            jobId: String(request.body?.jobId ?? ""),
            eventType: String(request.body?.eventType ?? "SOS"),
            lat: Number(request.body?.lat ?? 0),
            lng: Number(request.body?.lng ?? 0)
          }
        )
    },
    {
      method: "GET",
      path: "/admin/review-queue",
      summary: "위험 검수 큐",
      auth: "admin",
      handler: () => admin.reviewQueue()
    },
    {
      method: "GET",
      path: "/admin/disputes",
      summary: "분쟁 센터",
      auth: "admin",
      handler: () => admin.disputeCenter()
    },
    {
      method: "GET",
      path: "/admin/emergencies",
      summary: "긴급 이벤트 피드",
      auth: "admin",
      handler: () => admin.emergencyFeed()
    },
    {
      method: "GET",
      path: "/admin/documents",
      summary: "서류 승인 큐",
      auth: "admin",
      handler: () => admin.documentsQueue()
    },
    {
      method: "GET",
      path: "/admin/payout-holds",
      summary: "정산 보류 큐",
      auth: "admin",
      handler: () => admin.payoutHolds()
    },
    {
      method: "GET",
      path: "/admin/policies",
      summary: "정책 사전",
      auth: "admin",
      handler: () => admin.policyDictionary()
    },
    {
      method: "GET",
      path: "/health",
      summary: "헬스체크",
      auth: "public",
      handler: () => ok({ status: "ok" })
    }
  ];

  return {
    routes,
    dispatch(request: AppRequest) {
      const match = routes.find((route) => route.method === request.method && matchPath(route.path, request.path));
      if (!match) {
        return fail("NOT_FOUND", "요청한 경로를 찾을 수 없어요.");
      }

      const context = resolveRequestContext(match.auth, request.headers, auth);
      if (context.resultType === "ERROR") {
        return context;
      }

      const params = extractParams(match.path, request.path);
      return match.handler(request, params, context.success);
    }
  };
}

function resolveLoginUserId(headers: Headers): string {
  return headers.get("x-user-id") ?? "client-1";
}

function requireUserContext(context: RequestContext) {
  if (context.kind !== "user") {
    throw new Error("User context required");
  }

  return context;
}

function resolveRequestContext(authMode: RouteAuth, headers: Headers, authService: AuthService) {
  if (authMode === "public") {
    return ok({ kind: "public" } as const);
  }

  if (authMode === "user-or-internal" && headers.get("x-internal-key") === productConfig.internalSystemKey) {
    return ok({ kind: "internal", actor: "SYSTEM" as const });
  }

  const authorization = headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return fail("AUTH_REQUIRED", "로그인이 필요해요.");
  }

  const authenticated = authService.authenticateAccessToken(authorization.slice("Bearer ".length));
  if (authenticated.resultType === "ERROR") {
    return authenticated;
  }

  if (authMode === "admin" && !authenticated.success.roleFlags.includes("ADMIN")) {
    return fail("FORBIDDEN", "관리자 권한이 필요해요.");
  }

  return ok({
    kind: "user" as const,
    userId: authenticated.success.userId,
    roleFlags: authenticated.success.roleFlags
  });
}

function resolveActor(context: RequestContext, headers: Headers) {
  if (context.kind === "internal") {
    return ok("SYSTEM" as const);
  }

  const requestedActor = headers.get("x-actor-role");
  if (!requestedActor) {
    if (context.roleFlags.includes("CLIENT")) {
      return ok("CLIENT" as const);
    }
    if (context.roleFlags.includes("RUNNER")) {
      return ok("RUNNER" as const);
    }
    if (context.roleFlags.includes("ADMIN")) {
      return ok("ADMIN" as const);
    }

    return fail("ACTOR_ROLE_NOT_ALLOWED", "이 요청을 수행할 역할이 없어요.");
  }

  if (requestedActor === "CLIENT" && context.roleFlags.includes("CLIENT")) {
    return ok("CLIENT" as const);
  }
  if (requestedActor === "RUNNER" && context.roleFlags.includes("RUNNER")) {
    return ok("RUNNER" as const);
  }
  if (requestedActor === "ADMIN" && context.roleFlags.includes("ADMIN")) {
    return ok("ADMIN" as const);
  }

  return fail("ACTOR_ROLE_NOT_ALLOWED", "해당 역할로 요청할 수 없어요.");
}

function matchPath(routePath: string, actualPath: string): boolean {
  const routeParts = routePath.split("/").filter(Boolean);
  const actualParts = actualPath.split("/").filter(Boolean);
  if (routeParts.length !== actualParts.length) {
    return false;
  }

  return routeParts.every((part, index) => part.startsWith(":") || part === actualParts[index]);
}

function extractParams(routePath: string, actualPath: string): Record<string, string> {
  const params: Record<string, string> = {};
  const routeParts = routePath.split("/").filter(Boolean);
  const actualParts = actualPath.split("/").filter(Boolean);

  for (const [index, part] of routeParts.entries()) {
    if (part.startsWith(":")) {
      params[part.slice(1)] = actualParts[index];
    }
  }

  return params;
}
