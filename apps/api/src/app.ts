import { fail, ok, type RouteDescriptor } from "../../../packages/contracts/src/index.ts";

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

type AppHandler = (request: AppRequest, params: Record<string, string>) => unknown;

interface RouteRegistration extends RouteDescriptor {
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
      handler: () => auth.loginCallback()
    },
    {
      method: "POST",
      path: "/auth/verify/adult",
      summary: "성인 인증 상태 확인",
      handler: (request) => auth.verifyAdult(resolveUserId(request.headers))
    },
    {
      method: "POST",
      path: "/auth/reauth",
      summary: "민감 행위 재인증",
      handler: (request) => auth.reauth(resolveUserId(request.headers))
    },
    {
      method: "GET",
      path: "/me",
      summary: "현재 사용자 상태 조회",
      handler: (request) => auth.getMe(resolveUserId(request.headers))
    },
    {
      method: "GET",
      path: "/safety/rules/current",
      summary: "안전수칙 조회",
      handler: () => safety.getCurrentRules()
    },
    {
      method: "POST",
      path: "/safety/acknowledgements",
      summary: "안전수칙 동의 저장",
      handler: (request) =>
        safety.acknowledge(
          resolveUserId(request.headers),
          String(request.body?.rulesVersion ?? ""),
          Boolean(request.body?.acknowledged),
          request.body?.deviceHash ? String(request.body.deviceHash) : undefined
        )
    },
    {
      method: "POST",
      path: "/auth/toss-face/session",
      summary: "토스 얼굴 인증 세션 시작",
      handler: (request) =>
        auth.createFaceAuthSession(
          resolveUserId(request.headers),
          String(request.body?.intent ?? "JOB_CREATE") as "JOB_CREATE" | "PAYMENT_CONFIRM",
          request.body?.jobDraftId ? String(request.body.jobDraftId) : undefined
        )
    },
    {
      method: "POST",
      path: "/auth/toss-face/complete",
      summary: "토스 얼굴 인증 결과 반영",
      handler: (request) =>
        auth.completeFaceAuth(
          resolveUserId(request.headers),
          String(request.body?.faceAuthSessionId ?? ""),
          String(request.body?.providerTransactionId ?? ""),
          String(request.body?.result ?? "FAIL") as "SUCCESS" | "FAIL" | "CANCELLED"
        )
    },
    {
      method: "POST",
      path: "/jobs",
      summary: "의뢰 생성",
      handler: (request) =>
        jobs.createJob(
          resolveUserId(request.headers),
          request.body as never,
          String(request.body?.faceAuthSessionId ?? "")
        )
    },
    {
      method: "GET",
      path: "/jobs/nearby",
      summary: "근처 의뢰 조회",
      handler: () => jobs.getNearbyJobs()
    },
    {
      method: "GET",
      path: "/jobs/:jobId",
      summary: "의뢰 상세 조회",
      handler: (_request, params) => jobs.getJob(params.jobId)
    },
    {
      method: "POST",
      path: "/jobs/:jobId/status",
      summary: "의뢰 상태 변경",
      handler: (request, params) =>
        jobs.updateStatus(
          params.jobId,
          resolveActor(request.headers),
          String(request.body?.nextStatus ?? "") as never
        )
    },
    {
      method: "POST",
      path: "/jobs/:jobId/assign",
      summary: "부르미 확정",
      handler: (request, params) => jobs.matchJob(params.jobId, String(request.body?.runnerUserId ?? ""))
    },
    {
      method: "GET",
      path: "/jobs/:jobId/chat",
      summary: "채팅방 조회",
      handler: (_request, params) => chat.getRoom(params.jobId)
    },
    {
      method: "POST",
      path: "/jobs/:jobId/chat/messages",
      summary: "채팅 메시지 전송",
      handler: (request, params) =>
        chat.sendMessage(
          params.jobId,
          resolveUserId(request.headers),
          String(request.body?.body ?? ""),
          String(request.body?.messageType ?? "text") as "text" | "image"
        )
    },
    {
      method: "POST",
      path: "/jobs/:jobId/location-log",
      summary: "위치 로그 저장",
      handler: (request, params) =>
        tracking.logLocation(params.jobId, resolveUserId(request.headers), {
          role: String(request.body?.role ?? "RUNNER") as "CLIENT" | "RUNNER",
          lat: Number(request.body?.lat ?? 0),
          lng: Number(request.body?.lng ?? 0),
          accuracy: Number(request.body?.accuracy ?? 999),
          source: String(request.body?.source ?? "app") as "app" | "background" | "manual",
          loggedAt: request.body?.loggedAt ? String(request.body.loggedAt) : undefined
        })
    },
    {
      method: "POST",
      path: "/jobs/:jobId/proof-photo/complete",
      summary: "증빙 사진 등록",
      handler: (request, params) =>
        tracking.completeProof(params.jobId, resolveUserId(request.headers), {
          proofType: String(request.body?.proofType ?? "pickup") as "pickup" | "delivery",
          s3Key: String(request.body?.s3Key ?? "")
        })
    },
    {
      method: "POST",
      path: "/payments/jobs/:jobId/init",
      summary: "결제 주문 생성",
      handler: (request, params) => payments.initPayment(params.jobId, resolveUserId(request.headers))
    },
    {
      method: "POST",
      path: "/payments/jobs/:jobId/confirm",
      summary: "결제 승인 및 held 처리",
      handler: (request, params) =>
        payments.confirmPayment(
          params.jobId,
          resolveUserId(request.headers),
          String(request.body?.paymentOrderId ?? ""),
          String(request.body?.faceAuthSessionId ?? "")
        )
    },
    {
      method: "POST",
      path: "/payouts/jobs/:jobId/release",
      summary: "정산 릴리스 가능 여부 평가",
      handler: (_request, params) => payments.evaluateRelease(params.jobId)
    },
    {
      method: "POST",
      path: "/reviews",
      summary: "리뷰 작성",
      handler: (request) =>
        community.createReview(resolveUserId(request.headers), {
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
      handler: (_request, params) => community.listUserReviews(params.userId)
    },
    {
      method: "GET",
      path: "/community/posts",
      summary: "커뮤니티 게시물 조회",
      handler: () => community.listPosts()
    },
    {
      method: "POST",
      path: "/community/posts",
      summary: "커뮤니티 게시물 작성",
      handler: (request) =>
        community.createPost(resolveUserId(request.headers), {
          title: String(request.body?.title ?? ""),
          body: String(request.body?.body ?? ""),
          imageUrl: request.body?.imageUrl ? String(request.body.imageUrl) : undefined
        })
    },
    {
      method: "POST",
      path: "/reports",
      summary: "일반 신고 생성",
      handler: (request) =>
        reports.createReport(request.headers.get("idempotency-key") ?? undefined, {
          jobId: request.body?.jobId ? String(request.body.jobId) : undefined,
          targetUserId: String(request.body?.targetUserId ?? ""),
          reportType: String(request.body?.reportType ?? "OTHER"),
          detail: request.body?.detail ? String(request.body.detail) : undefined
        })
    },
    {
      method: "POST",
      path: "/emergency-events",
      summary: "긴급 이벤트 생성",
      handler: (request) =>
        reports.createEmergency(request.headers.get("idempotency-key") ?? undefined, {
          jobId: String(request.body?.jobId ?? ""),
          eventType: String(request.body?.eventType ?? "SOS"),
          lat: Number(request.body?.lat ?? 0),
          lng: Number(request.body?.lng ?? 0)
        })
    },
    {
      method: "GET",
      path: "/admin/review-queue",
      summary: "위험 검수 큐",
      handler: () => admin.reviewQueue()
    },
    {
      method: "GET",
      path: "/admin/disputes",
      summary: "분쟁 센터",
      handler: () => admin.disputeCenter()
    },
    {
      method: "GET",
      path: "/admin/emergencies",
      summary: "긴급 이벤트 피드",
      handler: () => admin.emergencyFeed()
    },
    {
      method: "GET",
      path: "/admin/documents",
      summary: "서류 승인 큐",
      handler: () => admin.documentsQueue()
    },
    {
      method: "GET",
      path: "/admin/payout-holds",
      summary: "정산 보류 큐",
      handler: () => admin.payoutHolds()
    },
    {
      method: "GET",
      path: "/admin/policies",
      summary: "정책 사전",
      handler: () => admin.policyDictionary()
    },
    {
      method: "GET",
      path: "/health",
      summary: "헬스체크",
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

      const params = extractParams(match.path, request.path);
      return match.handler(request, params);
    }
  };
}

function resolveUserId(headers: Headers): string {
  return headers.get("x-user-id") ?? "client-1";
}

function resolveActor(headers: Headers) {
  return (headers.get("x-actor-role") ?? "CLIENT") as "CLIENT" | "RUNNER" | "SYSTEM" | "ADMIN";
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
