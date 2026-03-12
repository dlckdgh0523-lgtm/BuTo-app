import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import { fail, ok, type RouteDescriptor, type RuntimeReadinessSummary, type UserRole } from "../../../packages/contracts/src/index.ts";

import { createStore } from "./bootstrap.ts";
import { loadApiRuntimeConfig, type ApiRuntimeConfig } from "./env.ts";
import { AdminService } from "./modules/admin.service.ts";
import { AuthService } from "./modules/auth.service.ts";
import { ChatService } from "./modules/chat.service.ts";
import { CancellationService } from "./modules/cancellation.service.ts";
import { CommunityService } from "./modules/community.service.ts";
import { EnforcementService } from "./modules/enforcement.service.ts";
import { JobsService } from "./modules/jobs.service.ts";
import { NotificationsService } from "./modules/notifications.service.ts";
import { PaymentsService } from "./modules/payments.service.ts";
import { PushService } from "./modules/push.service.ts";
import { ReportsService } from "./modules/reports.service.ts";
import { formatRuntimeReadinessMarkdown } from "./modules/runtime-readiness-report.ts";
import { RuntimeReadinessService } from "./modules/runtime-readiness.service.ts";
import { buildReleaseSubmissionDecision, findRecentBundleNames, formatReleaseStatusReport, listRecentSubmissionBundles, parseChecklistSummary, readSubmissionBundleDetail, recommendSubmissionBundle } from "./modules/release-status-report.ts";
import { SafetyService } from "./modules/safety.service.ts";
import { formatOwnerActionPlan, formatOwnerEnvHandoff, formatSingleOwnerEnvHandoff } from "./modules/submission-bundle.ts";
import { SupportService } from "./modules/support.service.ts";
import { TrackingService } from "./modules/tracking.service.ts";
import { createProofAssetStorageProvider } from "./modules/proof-asset-storage.ts";
import { RealTossAuthProvider, type TossAuthProvider } from "./modules/toss-auth-provider.ts";
import { RealTossPayProvider, type TossPayProvider } from "./modules/toss-pay-provider.ts";
import type { InMemoryStore } from "./store.ts";
import { NoopPersistenceAdapter, PostgresPersistenceAdapter, type PersistenceAdapter } from "./persistence.ts";
import { parseBasicAuthorization, safeEqualText } from "./utils.ts";

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

type RouteAuth = "public" | "user" | "restricted-user" | "admin" | "user-or-internal";
type AppHandler = (request: AppRequest, params: Record<string, string>, context: RequestContext) => Promise<unknown> | unknown;

interface RouteRegistration extends RouteDescriptor {
  auth: RouteAuth;
  handler: AppHandler;
}

export function createApp(options?: {
  tossAuthProvider?: TossAuthProvider;
  tossPayProvider?: TossPayProvider;
  runtimeConfig?: ApiRuntimeConfig;
  env?: NodeJS.ProcessEnv;
  store?: InMemoryStore;
  persistence?: PersistenceAdapter;
}) {
  const store = options?.store ?? createStore();
  const runtimeConfig = options?.runtimeConfig ?? loadApiRuntimeConfig();
  const persistence = options?.persistence ?? new NoopPersistenceAdapter();
  const enforcement = new EnforcementService(store, persistence);
  const auth = new AuthService(store, options?.tossAuthProvider ?? new RealTossAuthProvider(), runtimeConfig, enforcement, persistence);
  const safety = new SafetyService(store, persistence);
  const payments = new PaymentsService(store, auth, persistence, options?.tossPayProvider ?? new RealTossPayProvider(), runtimeConfig);
  const cancellation = new CancellationService(store, persistence, payments);
  const jobs = new JobsService(store, auth, persistence, cancellation);
  const chat = new ChatService(store, enforcement, persistence, cancellation);
  const push = new PushService(store, persistence);
  const reports = new ReportsService(store, persistence);
  const admin = new AdminService(store, enforcement, persistence);
  const support = new SupportService(store, persistence);
  const proofAssetStorage = createProofAssetStorageProvider(runtimeConfig);
  const tracking = new TrackingService(store, persistence, proofAssetStorage);
  const community = new CommunityService(store, persistence);
  const notifications = new NotificationsService(store, persistence);
  const runtimeReadiness = new RuntimeReadinessService(runtimeConfig, options?.env ?? process.env);
  const runtimeEnvironmentLabel = options?.env?.NODE_ENV ?? process.env.NODE_ENV ?? "production";
  const runtimeEnvSources = [
    {
      sourcePath: fileURLToPath(new URL("../.env.production.example", import.meta.url))
    },
    {
      sourcePath: fileURLToPath(new URL("../../miniapp/.env.production.example", import.meta.url))
    }
  ];
  const releaseChecklistPath = fileURLToPath(new URL("../../../docs/apps-in-toss-release-checklist.md", import.meta.url));
  const submissionBundlesDir = fileURLToPath(new URL("../../../docs/submission/bundles", import.meta.url));

  const routes: RouteRegistration[] = [
    {
      method: "POST",
      path: "/auth/toss/login/start",
      summary: "토스 로그인 state 발급",
      auth: "public",
      handler: () => auth.startLogin()
    },
    {
      method: "POST",
      path: "/auth/toss/login/callback",
      summary: "토스 로그인 콜백 처리",
      auth: "public",
      handler: async (request) => {
        const authorizationCode = String(request.body?.authorizationCode ?? "");
        const state = request.body?.state ? String(request.body.state) : undefined;
        return auth.loginCallback({
          authorizationCode,
          state: state ?? ""
        });
      }
    },
    {
      method: "POST",
      path: "/auth/toss/unlink",
      summary: "토스 연결 끊기 콜백 처리",
      auth: "public",
      handler: (request) => {
        const basic = parseBasicAuthorization(request.headers.get("authorization"));
        if (
          !basic ||
          !safeEqualText(basic.username, runtimeConfig.tossUnlinkBasicUser) ||
          !safeEqualText(basic.password, runtimeConfig.tossUnlinkBasicPassword)
        ) {
          return fail("FORBIDDEN", "토스 연결 끊기 콜백 인증에 실패했어요.");
        }

        return auth.handleTossUnlink({
          tossUserKey: String(request.body?.userKey ?? request.body?.tossUserKey ?? request.query.get("userKey") ?? ""),
          reason: request.body?.reason ? String(request.body.reason) : request.query.get("reason") ?? undefined
        });
      }
    },
    {
      method: "GET",
      path: "/auth/toss/unlink",
      summary: "토스 연결 끊기 콜백 처리",
      auth: "public",
      handler: (request) => {
        const basic = parseBasicAuthorization(request.headers.get("authorization"));
        if (
          !basic ||
          !safeEqualText(basic.username, runtimeConfig.tossUnlinkBasicUser) ||
          !safeEqualText(basic.password, runtimeConfig.tossUnlinkBasicPassword)
        ) {
          return fail("FORBIDDEN", "토스 연결 끊기 콜백 인증에 실패했어요.");
        }

        return auth.handleTossUnlink({
          tossUserKey: String(request.query.get("userKey") ?? ""),
          reason: request.query.get("reason") ?? undefined
        });
      }
    },
    {
      method: "POST",
      path: "/auth/refresh",
      summary: "액세스 토큰 재발급",
      auth: "public",
      handler: (request) => auth.refreshAccessToken(String(request.body?.refreshToken ?? ""))
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
      method: "POST",
      path: "/auth/logout",
      summary: "로그아웃",
      auth: "restricted-user",
      handler: (request, _params, context) =>
        auth.logout({
          userId: requireUserContext(context).userId,
          refreshToken: String(request.body?.refreshToken ?? "")
        })
    },
    {
      method: "GET",
      path: "/me",
      summary: "현재 사용자 상태 조회",
      auth: "restricted-user",
      handler: (_request, _params, context) => auth.getMe(requireUserContext(context).userId)
    },
    {
      method: "GET",
      path: "/me/enforcement-status",
      summary: "현재 제재 상태 조회",
      auth: "restricted-user",
      handler: (_request, _params, context) => enforcement.getEnforcementStatus(requireUserContext(context).userId)
    },
    {
      method: "GET",
      path: "/me/enforcement-actions",
      summary: "제재 이력 조회",
      auth: "restricted-user",
      handler: (_request, _params, context) => enforcement.listUserEnforcementActions(requireUserContext(context).userId)
    },
    {
      method: "GET",
      path: "/me/notifications",
      summary: "내 알림 조회",
      auth: "restricted-user",
      handler: (_request, _params, context) => notifications.listUserNotifications(requireUserContext(context).userId)
    },
    {
      method: "GET",
      path: "/me/support-fallbacks",
      summary: "상담 채널 fallback 조회",
      auth: "restricted-user",
      handler: (_request, _params, context) => support.listUserFallbacks(requireUserContext(context).userId)
    },
    {
      method: "POST",
      path: "/me/support-fallbacks/:fallbackId/acknowledge",
      summary: "상담 채널 fallback 확인 처리",
      auth: "restricted-user",
      handler: (_request, params, context) =>
        support.acknowledgeFallback(requireUserContext(context).userId, params.fallbackId)
    },
    {
      method: "POST",
      path: "/me/notifications/:notificationId/read",
      summary: "알림 읽음 처리",
      auth: "restricted-user",
      handler: (_request, params, context) =>
        notifications.markNotificationRead(requireUserContext(context).userId, params.notificationId)
    },
    {
      method: "POST",
      path: "/me/withdraw",
      summary: "회원 탈퇴",
      auth: "user",
      handler: (request, _params, context) =>
        auth.withdrawUser(requireUserContext(context).userId, {
          confirmed: Boolean(request.body?.confirmed),
          reason: request.body?.reason ? String(request.body.reason) : undefined
        })
    },
    {
      method: "GET",
      path: "/me/push-subscriptions",
      summary: "내 푸시 구독 조회",
      auth: "restricted-user",
      handler: (_request, _params, context) => push.listUserSubscriptions(requireUserContext(context).userId)
    },
    {
      method: "POST",
      path: "/me/push-subscriptions",
      summary: "푸시 구독 등록 또는 갱신",
      auth: "restricted-user",
      handler: (request, _params, context) =>
        push.registerSubscription(requireUserContext(context).userId, {
          provider: String(request.body?.provider ?? "WEBHOOK") as "WEBHOOK" | "FCM" | "APNS",
          endpoint: String(request.body?.endpoint ?? ""),
          authSecret: request.body?.authSecret ? String(request.body.authSecret) : undefined,
          p256dh: request.body?.p256dh ? String(request.body.p256dh) : undefined,
          deviceLabel: request.body?.deviceLabel ? String(request.body.deviceLabel) : undefined,
          subscriptionId: request.body?.subscriptionId ? String(request.body.subscriptionId) : undefined
        })
    },
    {
      method: "POST",
      path: "/me/push-subscriptions/:subscriptionId/disable",
      summary: "푸시 구독 비활성화",
      auth: "restricted-user",
      handler: (_request, params, context) =>
        push.disableSubscription(requireUserContext(context).userId, params.subscriptionId)
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
      handler: async (request, _params, context) =>
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
      handler: async (request, _params, context) =>
        auth.completeFaceAuth(
          requireUserContext(context).userId,
          String(request.body?.faceAuthSessionId ?? "")
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
      path: "/me/jobs/active",
      summary: "내 진행중 의뢰 조회",
      auth: "user",
      handler: (_request, _params, context) => {
        const userContext = requireUserContext(context);
        return jobs.listActiveJobs(userContext.userId, userContext.roleFlags);
      }
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
      path: "/jobs/:jobId/cancellations/request",
      summary: "의뢰자 합의 취소 요청",
      auth: "user",
      handler: (request, params, context) =>
        cancellation.requestClientCancellation(
          params.jobId,
          requireUserContext(context).userId,
          String(request.body?.reason ?? "")
        )
    },
    {
      method: "POST",
      path: "/jobs/:jobId/cancellations/respond",
      summary: "부르미 취소 요청 응답",
      auth: "user",
      handler: (request, params, context) =>
        cancellation.respondRunnerCancellation(
          params.jobId,
          requireUserContext(context).userId,
          String(request.body?.decision ?? "REJECT") as "ACCEPT" | "REJECT",
          request.body?.note ? String(request.body.note) : undefined
        )
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
      path: "/jobs/:jobId/proof-photo/session",
      summary: "증빙 업로드 세션 발급",
      auth: "user",
      handler: (request, params, context) =>
        tracking.createProofUploadSession(params.jobId, requireUserContext(context).userId, {
          proofType: String(request.body?.proofType ?? "pickup") as "pickup" | "delivery",
          source: String(request.body?.source ?? "camera") as "camera" | "album",
          mimeType: String(request.body?.mimeType ?? "image/jpeg")
        })
    },
    {
      method: "POST",
      path: "/uploads/proof/:uploadSessionId",
      summary: "signed upload url로 증빙 사진 업로드",
      auth: "public",
      handler: (request, params) =>
        tracking.uploadProofAssetViaSignedUrl(params.uploadSessionId, {
          expiresAt: String(request.query.get("expiresAt") ?? ""),
          signature: String(request.query.get("signature") ?? ""),
          dataUri: String(request.body?.dataUri ?? ""),
          imageId: request.body?.imageId ? String(request.body.imageId) : undefined,
          mimeTypeHint: request.body?.mimeTypeHint ? String(request.body.mimeTypeHint) : undefined
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
          uploadSessionId: String(request.body?.uploadSessionId ?? "")
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
      path: "/payments/jobs/:jobId/reconcile",
      summary: "결제 상태 조회 및 복구",
      auth: "user",
      handler: (request, params, context) =>
        payments.reconcilePayment(
          params.jobId,
          requireUserContext(context).userId,
          request.body?.paymentOrderId ? String(request.body.paymentOrderId) : undefined
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
      path: "/admin/ops-dashboard",
      summary: "운영 대시보드 요약",
      auth: "admin",
      handler: () => admin.opsDashboard()
    },
    {
      method: "GET",
      path: "/admin/disputes",
      summary: "분쟁 센터",
      auth: "admin",
      handler: (request) =>
        admin.disputeCenter({
          status: request.query.get("status") ?? undefined,
          riskLevel: request.query.get("riskLevel") ?? undefined,
          query: request.query.get("q") ?? undefined,
          sort: request.query.get("sort") ?? undefined,
          page: Number(request.query.get("page") ?? "1"),
          pageSize: Number(request.query.get("pageSize") ?? "10")
        })
    },
    {
      method: "GET",
      path: "/admin/disputes/:jobId",
      summary: "분쟁 상세",
      auth: "admin",
      handler: (_request, params) => admin.disputeDetail(params.jobId)
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
      path: "/admin/users/blocked",
      summary: "차단 사용자 목록",
      auth: "admin",
      handler: () => admin.blockedUsers()
    },
    {
      method: "GET",
      path: "/admin/users/withdrawn",
      summary: "탈퇴 사용자 목록",
      auth: "admin",
      handler: () => admin.withdrawnUsers()
    },
    {
      method: "POST",
      path: "/appeals",
      summary: "이의제기 제출",
      auth: "restricted-user",
      handler: (request, _params, context) =>
        enforcement.createAppeal(requireUserContext(context).userId, {
          actionId: request.body?.actionId ? String(request.body.actionId) : undefined,
          appealText: String(request.body?.appealText ?? "")
        })
    },
    {
      method: "GET",
      path: "/appeals/:appealId",
      summary: "이의제기 상세 조회",
      auth: "restricted-user",
      handler: (_request, params, context) => enforcement.getAppeal(requireUserContext(context).userId, params.appealId)
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
      path: "/admin/push-subscriptions",
      summary: "푸시 구독 모니터링",
      auth: "admin",
      handler: (request) => admin.pushSubscriptions(Number(request.query.get("limit") ?? "100"))
    },
    {
      method: "GET",
      path: "/admin/push-deliveries",
      summary: "푸시 전달 이력 모니터링",
      auth: "admin",
      handler: (request) => admin.pushDeliveries(Number(request.query.get("limit") ?? "100"))
    },
    {
      method: "GET",
      path: "/admin/support-fallbacks",
      summary: "상담 채널 fallback 모니터링",
      auth: "admin",
      handler: (request) => admin.supportFallbacks(Number(request.query.get("limit") ?? "100"))
    },
    {
      method: "GET",
      path: "/admin/runtime-workers",
      summary: "worker 실행 상태",
      auth: "admin",
      handler: () => admin.runtimeWorkers()
    },
    {
      method: "GET",
      path: "/admin/runtime-readiness",
      summary: "출시 준비 상태 점검",
      auth: "admin",
      handler: () => runtimeReadiness.evaluate()
    },
    {
      method: "GET",
      path: "/admin/runtime-readiness/report",
      summary: "출시 준비 리포트 markdown",
      auth: "admin",
      handler: () => {
        const readiness = runtimeReadiness.evaluate();
        if (readiness.resultType === "ERROR") {
          return readiness;
        }

        return ok({
          fileName: "runtime-readiness-report.md",
          markdown: formatRuntimeReadinessMarkdown(readiness.success, {
            environmentLabel: runtimeEnvironmentLabel
          })
        });
      }
    },
    {
      method: "GET",
      path: "/admin/runtime-readiness/action-plan",
      summary: "owner별 출시 준비 액션 플랜 markdown",
      auth: "admin",
      handler: () => {
        const readiness = runtimeReadiness.evaluate();
        if (readiness.resultType === "ERROR") {
          return readiness;
        }

        return ok({
          fileName: "owner-action-plan.md",
          markdown: formatOwnerActionPlan({
            bundleLabel: `${runtimeEnvironmentLabel}-${new Date().toISOString().slice(0, 10)}`,
            environmentLabel: runtimeEnvironmentLabel,
            readiness: readiness.success
          })
        });
      }
    },
    {
      method: "GET",
      path: "/admin/runtime-readiness/env-handoff",
      summary: "owner별 env handoff markdown",
      auth: "admin",
      handler: () => {
        const readiness = runtimeReadiness.evaluate();
        if (readiness.resultType === "ERROR") {
          return readiness;
        }

        return ok({
          fileName: "owner-env-handoff.md",
          markdown: formatOwnerEnvHandoff({
            bundleLabel: `${runtimeEnvironmentLabel}-${new Date().toISOString().slice(0, 10)}`,
            environmentLabel: runtimeEnvironmentLabel,
            readiness: readiness.success,
            envSources: runtimeEnvSources
          })
        });
      }
    },
    {
      method: "GET",
      path: "/admin/runtime-readiness/env-handoff/:owner",
      summary: "특정 owner의 env handoff markdown",
      auth: "admin",
      handler: (_request, params) => {
        const owner = String(params.owner ?? "") as RuntimeReadinessSummary["owners"][number]["owner"];
        if (!["INFRA", "SECURITY", "PARTNERSHIP", "BACKEND", "RISK_OPS"].includes(owner)) {
          return fail("INVALID_OWNER", "알 수 없는 owner예요.");
        }

        const readiness = runtimeReadiness.evaluate();
        if (readiness.resultType === "ERROR") {
          return readiness;
        }

        return ok({
          fileName: `${owner.toLowerCase()}-env-handoff.md`,
          markdown: formatSingleOwnerEnvHandoff({
            bundleLabel: `${runtimeEnvironmentLabel}-${new Date().toISOString().slice(0, 10)}`,
            environmentLabel: runtimeEnvironmentLabel,
            owner,
            readiness: readiness.success,
            envSources: runtimeEnvSources
          })
        });
      }
    },
    {
      method: "GET",
      path: "/admin/release-status/report",
      summary: "현재 출시 진행 상태 snapshot markdown",
      auth: "admin",
      handler: () => {
        const readiness = runtimeReadiness.evaluate();
        if (readiness.resultType === "ERROR") {
          return readiness;
        }

        const checklistMarkdown = readFileSync(releaseChecklistPath, "utf8");
        const recentBundleSummaries = listRecentSubmissionBundles(submissionBundlesDir, 5, readiness.success);
        const recommendation = recommendSubmissionBundle(recentBundleSummaries);
        return ok({
          fileName: "release-status-snapshot.md",
          markdown: formatReleaseStatusReport({
            generatedAt: new Date().toISOString(),
            environmentLabel: runtimeEnvironmentLabel,
            readiness: readiness.success,
            checklistSections: parseChecklistSummary(checklistMarkdown),
            recentBundles: findRecentBundleNames(submissionBundlesDir),
            recentBundleSummaries,
            recommendation,
            decision: buildReleaseSubmissionDecision({
              readiness: readiness.success,
              recommendation
            })
          })
        });
      }
    },
    {
      method: "GET",
      path: "/admin/release-status/decision",
      summary: "제출 가능 여부 요약",
      auth: "admin",
      handler: () => {
        const readiness = runtimeReadiness.evaluate();
        if (readiness.resultType === "ERROR") {
          return readiness;
        }

        const bundles = listRecentSubmissionBundles(submissionBundlesDir, 10, readiness.success);
        const recommendation = recommendSubmissionBundle(bundles);
        return ok(
          buildReleaseSubmissionDecision({
            readiness: readiness.success,
            recommendation
          })
        );
      }
    },
    {
      method: "GET",
      path: "/admin/submission-bundles",
      summary: "최근 제출 번들 목록",
      auth: "admin",
      handler: (request) => {
        const limit = Math.max(1, Math.min(20, Number(request.query.get("limit") ?? "10") || 10));
        const readiness = runtimeReadiness.evaluate();
        if (readiness.resultType === "ERROR") {
          return readiness;
        }

        return ok({
          items: listRecentSubmissionBundles(submissionBundlesDir, limit, readiness.success)
        });
      }
    },
    {
      method: "GET",
      path: "/admin/submission-bundles/recommendation",
      summary: "제출 후보 번들 추천",
      auth: "admin",
      handler: () => {
        const readiness = runtimeReadiness.evaluate();
        if (readiness.resultType === "ERROR") {
          return readiness;
        }

        const bundles = listRecentSubmissionBundles(submissionBundlesDir, 10, readiness.success);
        return ok(recommendSubmissionBundle(bundles));
      }
    },
    {
      method: "GET",
      path: "/admin/submission-bundles/:bundleLabel",
      summary: "제출 번들 상세",
      auth: "admin",
      handler: (_request, params) => {
        const readiness = runtimeReadiness.evaluate();
        if (readiness.resultType === "ERROR") {
          return readiness;
        }

        const detail = readSubmissionBundleDetail(submissionBundlesDir, params.bundleLabel, readiness.success);
        if (!detail) {
          return fail("SUBMISSION_BUNDLE_NOT_FOUND", "제출 번들을 찾을 수 없어요.");
        }

        return ok(detail);
      }
    },
    {
      method: "GET",
      path: "/admin/policies",
      summary: "정책 사전",
      auth: "admin",
      handler: () => admin.policyDictionary()
    },
    {
      method: "POST",
      path: "/admin/jobs/:jobId/review",
      summary: "수동 검수 승인 또는 거절",
      auth: "admin",
      handler: (request, params, context) =>
        admin.reviewJob(
          requireUserContext(context).userId,
          params.jobId,
          String(request.body?.decision ?? "REJECT") as "APPROVE" | "REJECT",
          request.body?.note ? String(request.body.note) : undefined
        )
    },
    {
      method: "POST",
      path: "/admin/disputes/:jobId/resolve",
      summary: "분쟁 처리",
      auth: "admin",
      handler: (request, params, context) =>
        admin.resolveDispute(
          requireUserContext(context).userId,
          params.jobId,
          String(request.body?.resolution ?? "CANCELLED") as "COMPLETED" | "CANCELLED" | "FAILED_SETTLEMENT",
          request.body?.note ? String(request.body.note) : undefined
        )
    },
    {
      method: "POST",
      path: "/admin/users/:userId/status",
      summary: "사용자 상태 변경",
      auth: "admin",
      handler: (request, params, context) =>
        admin.setUserStatus(
          requireUserContext(context).userId,
          params.userId,
          String(request.body?.status ?? "RESTRICTED") as "ACTIVE" | "RESTRICTED" | "SUSPENDED" | "PERMANENTLY_BANNED" | "REINSTATED",
          String(request.body?.reason ?? "")
        )
    },
    {
      method: "POST",
      path: "/admin/appeals/:appealId/request-more-info",
      summary: "이의제기 추가 자료 요청",
      auth: "admin",
      handler: (request, params, context) =>
        enforcement.requestMoreInfo(
          requireUserContext(context).userId,
          params.appealId,
          request.body?.note ? String(request.body.note) : undefined
        )
    },
    {
      method: "POST",
      path: "/admin/appeals/:appealId/approve",
      summary: "이의제기 승인",
      auth: "admin",
      handler: (request, params, context) =>
        enforcement.approveAppeal(
          requireUserContext(context).userId,
          params.appealId,
          request.body?.note ? String(request.body.note) : undefined
        )
    },
    {
      method: "POST",
      path: "/admin/appeals/:appealId/reject",
      summary: "이의제기 기각",
      auth: "admin",
      handler: (request, params, context) =>
        enforcement.rejectAppeal(
          requireUserContext(context).userId,
          params.appealId,
          request.body?.note ? String(request.body.note) : undefined
        )
    },
    {
      method: "POST",
      path: "/admin/enforcement-actions/:actionId/reinstate",
      summary: "제재 직접 해제",
      auth: "admin",
      handler: (request, params, context) =>
        enforcement.reinstateAction(
          requireUserContext(context).userId,
          params.actionId,
          request.body?.note ? String(request.body.note) : undefined
        )
    },
    {
      method: "GET",
      path: "/admin/audit-logs",
      summary: "감사 로그 조회",
      auth: "admin",
      handler: () => admin.auditLogs()
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
    services: {
      notifications
    },
    resolveContext(headers: Headers, authMode: RouteAuth = "restricted-user") {
      return resolveRequestContext(authMode, headers, auth, runtimeConfig);
    },
    async dispatch(request: AppRequest) {
      const match = routes.find((route) => route.method === request.method && matchPath(route.path, request.path));
      if (!match) {
        return fail("NOT_FOUND", "요청한 경로를 찾을 수 없어요.");
      }

      const context = resolveRequestContext(match.auth, request.headers, auth, runtimeConfig);
      if (context.resultType === "ERROR") {
        return context;
      }

      const params = extractParams(match.path, request.path);
      return await match.handler(request, params, context.success);
    }
  };
}

export async function createRuntimeApp(options?: { tossAuthProvider?: TossAuthProvider; runtimeConfig?: ApiRuntimeConfig; env?: NodeJS.ProcessEnv }) {
  const runtimeConfig = options?.runtimeConfig ?? loadApiRuntimeConfig();
  const store = createStore();
  const persistence = runtimeConfig.databaseUrl
    ? new PostgresPersistenceAdapter(runtimeConfig.databaseUrl)
    : new NoopPersistenceAdapter();

  await persistence.hydrate(store);

  return createApp({
    tossAuthProvider: options?.tossAuthProvider,
    runtimeConfig,
    env: options?.env ?? process.env,
    store,
    persistence
  });
}

function requireUserContext(context: RequestContext) {
  if (context.kind !== "user") {
    throw new Error("User context required");
  }

  return context;
}

function resolveRequestContext(authMode: RouteAuth, headers: Headers, authService: AuthService, runtimeConfig: ApiRuntimeConfig) {
  if (authMode === "public") {
    return ok({ kind: "public" } as const);
  }

  if (authMode === "user-or-internal" && headers.get("x-internal-key") === runtimeConfig.internalSystemKey) {
    return ok({ kind: "internal", actor: "SYSTEM" as const });
  }

  const authorization = headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return fail("AUTH_REQUIRED", "로그인이 필요해요.");
  }

  const authenticated =
    authMode === "restricted-user"
      ? authService.authenticateAnyAccessToken(authorization.slice("Bearer ".length))
      : authService.authenticateAccessToken(authorization.slice("Bearer ".length));
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
