import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createApp } from "../src/app.ts";
import { createStore } from "../src/bootstrap.ts";
import { loadApiRuntimeConfig, validateApiRuntimeConfig, validateDatabaseEnv, validateTossAuthEnv } from "../src/env.ts";
import { AuthService } from "../src/modules/auth.service.ts";
import { AdminService } from "../src/modules/admin.service.ts";
import { EnforcementService } from "../src/modules/enforcement.service.ts";
import { JobsService } from "../src/modules/jobs.service.ts";
import { PaymentsService } from "../src/modules/payments.service.ts";
import { LocalSignedProofAssetStorageProvider } from "../src/modules/proof-asset-storage.ts";
import { TrackingService } from "../src/modules/tracking.service.ts";
import { NoopPersistenceAdapter } from "../src/persistence.ts";
import { buildNotificationsForOutboxEvent } from "../src/workers/notification-projector.ts";
import { createPushWebhookSignature, shouldDispatchPush } from "../src/workers/push-provider.ts";
import { persistWorkerFailureNotifications } from "../src/workers/worker-alerts.ts";
import type { FaceAuthIntent } from "../../../packages/contracts/src/index.ts";
import type { TossAuthProvider } from "../src/modules/toss-auth-provider.ts";
import type { TossPayProvider } from "../src/modules/toss-pay-provider.ts";

function makeHeaders(headers: Record<string, string>) {
  return new Headers(headers);
}

function createMockTossAuthProvider(): TossAuthProvider {
  const loginCodes = new Map<string, string>([
    ["login-code-client-1", "ci_client_1"],
    ["login-code-runner-1", "ci_runner_1"],
    ["login-code-admin-1", "ci_admin_1"]
  ]);
  const oneTouchSessions = new Map<string, { ciHash: string; intent: FaceAuthIntent }>();

  return {
    async exchangeLoginAuthorizationCode({ authorizationCode }) {
      const ciHash = loginCodes.get(authorizationCode);
      if (!ciHash) {
        throw new Error("unknown authorization code");
      }

      return {
        ciHash,
        userKey: `user-key-${authorizationCode.replace("login-code-", "")}`,
        authenticatedAt: new Date().toISOString()
      };
    },
    async startOneTouchAuth({ userCiHash, intent, userId }) {
      const providerRequestId = `provider-${userId}-${intent}`;
      const txId = `tx-${userId}-${intent}`;
      oneTouchSessions.set(providerRequestId, { ciHash: userCiHash, intent });

      return {
        providerRequestId,
        txId,
        requestUrl: `buto://toss-auth/${txId}`,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
      };
    },
    async completeOneTouchAuth({ providerRequestId, txId }) {
      const session = oneTouchSessions.get(providerRequestId);
      if (!session) {
        return { status: "FAIL" };
      }

      return {
        status: "SUCCESS",
        providerTransactionId: txId,
        ciHash: session.ciHash,
        verifiedAt: new Date().toISOString()
      };
    }
  };
}

function createMockTossPayProvider(): TossPayProvider {
  const executions = new Map<string, { status: string; transactionId: string }>();

  return {
    async createPayment({ orderId, amount }) {
      const payToken = `pay-token-${orderId}`;
      executions.set(payToken, {
        status: "DONE",
        transactionId: `tx-${orderId}`
      });
      return {
        payToken,
        orderId,
        amount
      };
    },
    async executePayment({ payToken }) {
      const state = executions.get(payToken);
      if (!state) {
        throw new Error("missing pay token");
      }

      return {
        transactionId: state.transactionId,
        status: state.status,
        payMethod: "TOSS_PAY",
        refundableAmount: 15000
      };
    },
    async getPaymentStatus({ payToken }) {
      const state = executions.get(payToken);
      if (!state) {
        throw new Error("missing pay token");
      }

      return {
        transactionId: state.transactionId,
        status: state.status,
        payMethod: "TOSS_PAY",
        refundableAmount: 15000
      };
    },
    async refundPayment({ transactionId }) {
      const state = [...executions.values()].find((entry) => entry.transactionId === transactionId);
      if (!state) {
        throw new Error("missing transaction");
      }

      state.status = "REFUNDED";
      return {
        transactionId: state.transactionId,
        status: state.status,
        payMethod: "TOSS_PAY",
        refundableAmount: 0
      };
    }
  };
}

class FailingPersistenceAdapter extends NoopPersistenceAdapter {
  constructor(private readonly failOn: "enqueueOutboxEvent" | "upsertUser") {
    super();
  }

  override async enqueueOutboxEvent(...args: Parameters<NoopPersistenceAdapter["enqueueOutboxEvent"]>) {
    if (this.failOn === "enqueueOutboxEvent") {
      throw new Error("simulated persistence failure");
    }

    return super.enqueueOutboxEvent(...args);
  }

  override async upsertUser(...args: Parameters<NoopPersistenceAdapter["upsertUser"]>) {
    if (this.failOn === "upsertUser") {
      throw new Error("simulated persistence failure");
    }

    return super.upsertUser(...args);
  }
}

function createTestApp(
  env: Record<string, string> = {},
  options?: {
    store?: ReturnType<typeof createStore>;
    tossPayProvider?: TossPayProvider;
  }
) {
  const mergedEnv = {
    ...process.env,
    ...env
  };
  return createApp({
    tossAuthProvider: createMockTossAuthProvider(),
    tossPayProvider: options?.tossPayProvider ?? createMockTossPayProvider(),
    runtimeConfig: loadApiRuntimeConfig(mergedEnv),
    env: mergedEnv,
    store: options?.store
  });
}

async function startLoginFlow(app: ReturnType<typeof createTestApp>) {
  const start = await app.dispatch({
    method: "POST",
    path: "/auth/toss/login/start",
    query: new URLSearchParams(),
    body: {},
    headers: makeHeaders({})
  });

  assert.equal(start.resultType, "SUCCESS");
  if (start.resultType === "ERROR") {
    throw new Error("login start failed");
  }

  return start.success.state;
}

async function loginAs(app: ReturnType<typeof createTestApp>, userId: "client-1" | "runner-1" | "admin-1") {
  const state = await startLoginFlow(app);
  const login = await app.dispatch({
    method: "POST",
    path: "/auth/toss/login/callback",
    query: new URLSearchParams(),
    body: { authorizationCode: `login-code-${userId}`, state },
    headers: makeHeaders({})
  });

  assert.equal(login.resultType, "SUCCESS");
  if (login.resultType === "ERROR") {
    throw new Error("login failed");
  }

  return {
    userId,
    accessToken: login.success.accessToken,
    headers(extra: Record<string, string> = {}) {
      return makeHeaders({
        authorization: `Bearer ${login.success.accessToken}`,
        ...extra
      });
    }
  };
}

function internalHeaders(extra: Record<string, string> = {}) {
  return makeHeaders({
    "x-internal-key": "dev-buto-internal-key",
    ...extra
  });
}

const SAMPLE_IMAGE_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn7ZV8AAAAASUVORK5CYII=";

async function acknowledgeSafety(app: ReturnType<typeof createTestApp>, session: Awaited<ReturnType<typeof loginAs>>) {
  const result = await app.dispatch({
    method: "POST",
    path: "/safety/acknowledgements",
    query: new URLSearchParams(),
    body: { rulesVersion: "2026-03-09.v1", acknowledged: true },
    headers: session.headers()
  });

  assert.equal(result.resultType, "SUCCESS");
}

async function completeTossAuth(
  app: ReturnType<typeof createTestApp>,
  session: Awaited<ReturnType<typeof loginAs>>,
  intent: FaceAuthIntent
) {
  const authSession = await app.dispatch({
    method: "POST",
    path: "/auth/toss-face/session",
    query: new URLSearchParams(),
    body: { intent },
    headers: session.headers()
  });

  assert.equal(authSession.resultType, "SUCCESS");
  if (authSession.resultType === "ERROR") {
    throw new Error("auth session failed");
  }

  const completed = await app.dispatch({
    method: "POST",
    path: "/auth/toss-face/complete",
    query: new URLSearchParams(),
    body: {
      faceAuthSessionId: authSession.success.faceAuthSessionId
    },
    headers: session.headers()
  });

  assert.equal(completed.resultType, "SUCCESS");
  return authSession.success.faceAuthSessionId;
}

async function createPaidOfferingJob(app: ReturnType<typeof createTestApp>, client: Awaited<ReturnType<typeof loginAs>>) {
  await acknowledgeSafety(app, client);
  const jobCreateAuthSessionId = await completeTossAuth(app, client, "JOB_CREATE");

  const job = await app.dispatch({
    method: "POST",
    path: "/jobs",
    query: new URLSearchParams(),
    body: {
      title: "생활용품 전달",
      description: "문 앞 전달 부탁드려요.",
      pickup: { address: "서울 A", lat: 37.5, lng: 127.0 },
      dropoff: { address: "서울 B", lat: 37.51, lng: 127.01 },
      transportRequirement: "walk",
      offerAmount: 15000,
      faceAuthSessionId: jobCreateAuthSessionId
    },
    headers: client.headers()
  });

  assert.equal(job.resultType, "SUCCESS");
  if (job.resultType === "ERROR") {
    throw new Error("job creation failed");
  }

  const payment = await app.dispatch({
    method: "POST",
    path: `/payments/jobs/${job.success.jobId}/init`,
    query: new URLSearchParams(),
    body: {},
    headers: client.headers()
  });

  assert.equal(payment.resultType, "SUCCESS");
  if (payment.resultType === "ERROR") {
    throw new Error("payment init failed");
  }

  const paymentAuthSessionId = await completeTossAuth(app, client, "PAYMENT_CONFIRM");
  const confirm = await app.dispatch({
    method: "POST",
    path: `/payments/jobs/${job.success.jobId}/confirm`,
    query: new URLSearchParams(),
    body: {
      paymentOrderId: payment.success.paymentOrderId,
      faceAuthSessionId: paymentAuthSessionId
    },
    headers: client.headers()
  });

  assert.equal(confirm.resultType, "SUCCESS");
  return {
    jobId: job.success.jobId,
    paymentOrderId: payment.success.paymentOrderId
  };
}

async function uploadProofThroughApi(
  app: ReturnType<typeof createTestApp>,
  session: Awaited<ReturnType<typeof loginAs>>,
  input: { jobId: string; proofType: "pickup" | "delivery"; source?: "camera" | "album" }
) {
  const started = await app.dispatch({
    method: "POST",
    path: `/jobs/${input.jobId}/proof-photo/session`,
    query: new URLSearchParams(),
    body: {
      proofType: input.proofType,
      source: input.source ?? "camera",
      mimeType: "image/png"
    },
    headers: session.headers()
  });
  assert.equal(started.resultType, "SUCCESS");
  if (started.resultType === "ERROR") {
    throw new Error("proof upload session failed");
  }

  const signedUploadUrl = new URL(started.success.uploadUrl);
  const uploaded = await app.dispatch({
    method: "POST",
    path: signedUploadUrl.pathname,
    query: signedUploadUrl.searchParams,
    body: {
      dataUri: SAMPLE_IMAGE_DATA_URI,
      imageId: "sample-proof"
    },
    headers: makeHeaders({})
  });
  assert.equal(uploaded.resultType, "SUCCESS");

  return app.dispatch({
    method: "POST",
    path: `/jobs/${input.jobId}/proof-photo/complete`,
    query: new URLSearchParams(),
    body: {
      proofType: input.proofType,
      uploadSessionId: started.success.uploadSessionId
    },
    headers: session.headers()
  });
}

test("job creation requires safety acknowledgement first", async () => {
  const app = createTestApp();
  const client = await loginAs(app, "client-1");
  const faceAuthSessionId = await completeTossAuth(app, client, "JOB_CREATE");

  const job = await app.dispatch({
    method: "POST",
    path: "/jobs",
    query: new URLSearchParams(),
    body: {
      title: "문서 전달",
      description: "안전한 생활 심부름",
      pickup: { address: "서울 A", lat: 37.5, lng: 127.0 },
      dropoff: { address: "서울 B", lat: 37.51, lng: 127.01 },
      transportRequirement: "walk",
      offerAmount: 15000,
      faceAuthSessionId
    },
    headers: client.headers()
  });

  assert.equal(job.resultType, "ERROR");
  if (job.resultType === "ERROR") {
    assert.equal(job.error.code, "SAFETY_ACK_REQUIRED");
  }
});

test("face auth sessions are single-use for sensitive actions", async () => {
  const app = createTestApp();
  const client = await loginAs(app, "client-1");

  await acknowledgeSafety(app, client);
  const faceAuthSessionId = await completeTossAuth(app, client, "JOB_CREATE");

  const firstJob = await app.dispatch({
    method: "POST",
    path: "/jobs",
    query: new URLSearchParams(),
    body: {
      title: "문서 전달",
      description: "한 번만 사용 가능한 인증 세션 테스트",
      pickup: { address: "서울 A", lat: 37.5, lng: 127.0 },
      dropoff: { address: "서울 B", lat: 37.51, lng: 127.01 },
      transportRequirement: "walk",
      offerAmount: 15000,
      faceAuthSessionId
    },
    headers: client.headers()
  });
  assert.equal(firstJob.resultType, "SUCCESS");

  const replayJob = await app.dispatch({
    method: "POST",
    path: "/jobs",
    query: new URLSearchParams(),
    body: {
      title: "문서 전달 2",
      description: "같은 인증 세션 재사용 시도",
      pickup: { address: "서울 A", lat: 37.5, lng: 127.0 },
      dropoff: { address: "서울 B", lat: 37.51, lng: 127.01 },
      transportRequirement: "walk",
      offerAmount: 15000,
      faceAuthSessionId
    },
    headers: client.headers()
  });
  assert.equal(replayJob.resultType, "ERROR");
  if (replayJob.resultType === "ERROR") {
    assert.equal(replayJob.error.code, "FACE_AUTH_ALREADY_USED");
  }
});

test("severe chat after pickup forces dispute instead of cancellation", async () => {
  const app = createTestApp();
  const client = await loginAs(app, "client-1");
  const runner = await loginAs(app, "runner-1");
  const admin = await loginAs(app, "admin-1");
  const { jobId } = await createPaidOfferingJob(app, client);

  const match = await app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/assign`,
    query: new URLSearchParams(),
    body: { runnerUserId: "runner-1" },
    headers: runner.headers({ "x-actor-role": "RUNNER" })
  });
  assert.equal(match.resultType, "SUCCESS");

  for (const nextStatus of ["RUNNER_EN_ROUTE", "RUNNER_ARRIVED", "PICKED_UP"] as const) {
    const update = await app.dispatch({
      method: "POST",
      path: `/jobs/${jobId}/status`,
      query: new URLSearchParams(),
      body: { nextStatus },
      headers: runner.headers({ "x-actor-role": "RUNNER" })
    });
    assert.equal(update.resultType, "SUCCESS");
  }

  const message = await app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/chat/messages`,
    query: new URLSearchParams(),
    body: { body: "현금이랑 otp도 같이 보내주세요" },
    headers: runner.headers()
  });

  assert.equal(message.resultType, "SUCCESS");
  if (message.resultType === "SUCCESS") {
    assert.equal(message.success.moderationStatus, "SEVERE_BLOCK");
    assert.equal(message.success.jobStatus, "DISPUTED");
  }

  const blockedMe = await app.dispatch({
    method: "GET",
    path: "/me",
    query: new URLSearchParams(),
    headers: runner.headers()
  });
  assert.equal(blockedMe.resultType, "SUCCESS");
  if (blockedMe.resultType === "SUCCESS") {
    assert.equal(blockedMe.success.status, "RESTRICTED");
    assert.equal(blockedMe.success.restriction?.reasonCode, "AI_POLICY_BLOCK");
  }

  const blockedUsers = await app.dispatch({
    method: "GET",
    path: "/admin/users/blocked",
    query: new URLSearchParams(),
    headers: admin.headers()
  });
  assert.equal(blockedUsers.resultType, "SUCCESS");
  if (blockedUsers.resultType === "SUCCESS") {
    assert.equal(blockedUsers.success.items.some((item) => item.userId === "runner-1" && item.restriction?.reasonCode === "AI_POLICY_BLOCK"), true);
  }

  const restrictedNearby = await app.dispatch({
    method: "GET",
    path: "/jobs/nearby",
    query: new URLSearchParams(),
    headers: runner.headers()
  });
  assert.equal(restrictedNearby.resultType, "ERROR");
  if (restrictedNearby.resultType === "ERROR") {
    assert.equal(restrictedNearby.error.code, "ACCOUNT_RESTRICTED");
  }
});

test("client mutual cancellation request requires runner acceptance and refunds failed trade to client payment method", async () => {
  const store = createStore();
  const app = createTestApp({}, { store });
  const client = await loginAs(app, "client-1");
  const runner = await loginAs(app, "runner-1");
  const { jobId } = await createPaidOfferingJob(app, client);

  const match = await app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/assign`,
    query: new URLSearchParams(),
    body: { runnerUserId: "runner-1" },
    headers: runner.headers({ "x-actor-role": "RUNNER" })
  });
  assert.equal(match.resultType, "SUCCESS");

  const requested = await app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/cancellations/request`,
    query: new URLSearchParams(),
    body: { reason: "일정 불발 $$$ ^^" },
    headers: client.headers()
  });
  assert.equal(requested.resultType, "SUCCESS");

  const responded = await app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/cancellations/respond`,
    query: new URLSearchParams(),
    body: { decision: "ACCEPT", note: "합의 취소" },
    headers: runner.headers()
  });
  assert.equal(responded.resultType, "SUCCESS");
  if (responded.resultType === "SUCCESS") {
    assert.equal(responded.success.status, "ACCEPTED");
    assert.equal(responded.success.jobStatus, "CANCELLED");
    assert.equal(responded.success.refundReasonNormalized, "일정 불발");
  }

  const storedPayment = [...store.payments.values()].find((entry) => entry.jobId === jobId);
  assert.equal(storedPayment?.status, "REFUNDED");
  assert.equal(store.jobs.get(jobId)?.status, "CANCELLED");
});

test("idle private chat auto-cancels only pre-pickup jobs after about 20 minutes", async () => {
  const store = createStore();
  const app = createTestApp({}, { store });
  const client = await loginAs(app, "client-1");
  const runner = await loginAs(app, "runner-1");
  const { jobId } = await createPaidOfferingJob(app, client);

  const match = await app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/assign`,
    query: new URLSearchParams(),
    body: { runnerUserId: "runner-1" },
    headers: runner.headers({ "x-actor-role": "RUNNER" })
  });
  assert.equal(match.resultType, "SUCCESS");

  const firstMessage = await app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/chat/messages`,
    query: new URLSearchParams(),
    body: { body: "어디서 만날까요?" },
    headers: client.headers()
  });
  assert.equal(firstMessage.resultType, "SUCCESS");

  const roomId = store.jobs.get(jobId)?.chatRoomId;
  assert.ok(roomId);
  const messages = store.chatMessages.get(roomId!) ?? [];
  messages[0] = {
    ...messages[0],
    createdAt: new Date(Date.now() - 21 * 60_000).toISOString()
  };
  store.chatMessages.set(roomId!, messages);

  const active = await app.dispatch({
    method: "GET",
    path: "/me/jobs/active",
    query: new URLSearchParams(),
    headers: client.headers()
  });
  assert.equal(active.resultType, "SUCCESS");
  if (active.resultType === "SUCCESS") {
    assert.equal(active.success.items.some((item) => item.jobId === jobId), false);
  }

  assert.equal(store.jobs.get(jobId)?.status, "CANCELLED");
  assert.equal([...store.payments.values()].find((entry) => entry.jobId === jobId)?.status, "REFUNDED");
});

test("idle private chat does not auto-cancel after pickup", async () => {
  const store = createStore();
  const app = createTestApp({}, { store });
  const client = await loginAs(app, "client-1");
  const runner = await loginAs(app, "runner-1");
  const { jobId } = await createPaidOfferingJob(app, client);

  const match = await app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/assign`,
    query: new URLSearchParams(),
    body: { runnerUserId: "runner-1" },
    headers: runner.headers({ "x-actor-role": "RUNNER" })
  });
  assert.equal(match.resultType, "SUCCESS");

  for (const nextStatus of ["RUNNER_EN_ROUTE", "RUNNER_ARRIVED", "PICKED_UP"] as const) {
    const update = await app.dispatch({
      method: "POST",
      path: `/jobs/${jobId}/status`,
      query: new URLSearchParams(),
      body: { nextStatus },
      headers: runner.headers({ "x-actor-role": "RUNNER" })
    });
    assert.equal(update.resultType, "SUCCESS");
  }

  const firstMessage = await app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/chat/messages`,
    query: new URLSearchParams(),
    body: { body: "곧 출발할게요." },
    headers: runner.headers()
  });
  assert.equal(firstMessage.resultType, "SUCCESS");

  const roomId = store.jobs.get(jobId)?.chatRoomId;
  assert.ok(roomId);
  const messages = store.chatMessages.get(roomId!) ?? [];
  messages[0] = {
    ...messages[0],
    createdAt: new Date(Date.now() - 21 * 60_000).toISOString()
  };
  store.chatMessages.set(roomId!, messages);

  const active = await app.dispatch({
    method: "GET",
    path: "/me/jobs/active",
    query: new URLSearchParams(),
    headers: client.headers()
  });
  assert.equal(active.resultType, "SUCCESS");
  if (active.resultType === "SUCCESS") {
    assert.equal(active.success.items.some((item) => item.jobId === jobId), true);
  }

  assert.equal(store.jobs.get(jobId)?.status, "PICKED_UP");
});

test("idle private chat does not auto-cancel after runner arrival alert", async () => {
  const store = createStore();
  const app = createTestApp({}, { store });
  const client = await loginAs(app, "client-1");
  const runner = await loginAs(app, "runner-1");
  const { jobId } = await createPaidOfferingJob(app, client);

  const match = await app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/assign`,
    query: new URLSearchParams(),
    body: { runnerUserId: "runner-1" },
    headers: runner.headers({ "x-actor-role": "RUNNER" })
  });
  assert.equal(match.resultType, "SUCCESS");

  for (const nextStatus of ["RUNNER_EN_ROUTE", "RUNNER_ARRIVED"] as const) {
    const update = await app.dispatch({
      method: "POST",
      path: `/jobs/${jobId}/status`,
      query: new URLSearchParams(),
      body: { nextStatus },
      headers: runner.headers({ "x-actor-role": "RUNNER" })
    });
    assert.equal(update.resultType, "SUCCESS");
  }

  const firstMessage = await app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/chat/messages`,
    query: new URLSearchParams(),
    body: { body: "도착했어요. 문 앞에서 기다릴게요." },
    headers: runner.headers()
  });
  assert.equal(firstMessage.resultType, "SUCCESS");

  const roomId = store.jobs.get(jobId)?.chatRoomId;
  assert.ok(roomId);
  const messages = store.chatMessages.get(roomId!) ?? [];
  messages[0] = {
    ...messages[0],
    createdAt: new Date(Date.now() - 21 * 60_000).toISOString()
  };
  store.chatMessages.set(roomId!, messages);

  const active = await app.dispatch({
    method: "GET",
    path: "/me/jobs/active",
    query: new URLSearchParams(),
    headers: client.headers()
  });
  assert.equal(active.resultType, "SUCCESS");
  if (active.resultType === "SUCCESS") {
    assert.equal(active.success.items.some((item) => item.jobId === jobId), true);
  }

  assert.equal(store.jobs.get(jobId)?.status, "RUNNER_ARRIVED");
});

test("reports are idempotent and community posts are masked", async () => {
  const app = createTestApp();
  const client = await loginAs(app, "client-1");

  const first = await app.dispatch({
    method: "POST",
    path: "/reports",
    query: new URLSearchParams(),
    body: { targetUserId: "runner-1", reportType: "FRAUD", detail: "같은 신고" },
    headers: client.headers({ "idempotency-key": "report-key-1" })
  });
  const second = await app.dispatch({
    method: "POST",
    path: "/reports",
    query: new URLSearchParams(),
    body: { targetUserId: "runner-1", reportType: "FRAUD", detail: "같은 신고" },
    headers: client.headers({ "idempotency-key": "report-key-1" })
  });

  assert.equal(first.resultType, "SUCCESS");
  assert.equal(second.resultType, "SUCCESS");
  if (first.resultType === "SUCCESS" && second.resultType === "SUCCESS") {
    assert.equal(first.success.reportId, second.success.reportId);
    assert.equal(first.success.reporterUserId, "client-1");
  }

  const post = await app.dispatch({
    method: "POST",
    path: "/community/posts",
    query: new URLSearchParams(),
    body: {
      title: "010-1234-5678 연락 주세요",
      body: "공동현관 비밀번호와 123-4567-890123 계좌를 남겨요."
    },
    headers: client.headers()
  });

  assert.equal(post.resultType, "SUCCESS");
  if (post.resultType === "SUCCESS") {
    assert.match(post.success.title, /\[masked-phone\]/);
    assert.match(post.success.body, /\[masked-location-detail\]/);
    assert.match(post.success.body, /\[masked-account\]/);
  }
});

test("payment confirmation rejects toss auth sessions from the wrong intent", async () => {
  const app = createTestApp();
  const client = await loginAs(app, "client-1");

  await acknowledgeSafety(app, client);
  const jobCreateAuthSessionId = await completeTossAuth(app, client, "JOB_CREATE");

  const job = await app.dispatch({
    method: "POST",
    path: "/jobs",
    query: new URLSearchParams(),
    body: {
      title: "생필품 전달",
      description: "마트 생필품을 전달해주세요.",
      pickup: { address: "서울 A", lat: 37.5, lng: 127.0 },
      dropoff: { address: "서울 B", lat: 37.51, lng: 127.01 },
      transportRequirement: "walk",
      offerAmount: 15000,
      faceAuthSessionId: jobCreateAuthSessionId
    },
    headers: client.headers()
  });
  assert.equal(job.resultType, "SUCCESS");
  if (job.resultType === "ERROR") {
    return;
  }

  const payment = await app.dispatch({
    method: "POST",
    path: `/payments/jobs/${job.success.jobId}/init`,
    query: new URLSearchParams(),
    body: {},
    headers: client.headers()
  });
  assert.equal(payment.resultType, "SUCCESS");
  if (payment.resultType === "ERROR") {
    return;
  }

  const confirm = await app.dispatch({
    method: "POST",
    path: `/payments/jobs/${job.success.jobId}/confirm`,
    query: new URLSearchParams(),
    body: {
      paymentOrderId: payment.success.paymentOrderId,
      faceAuthSessionId: jobCreateAuthSessionId
    },
    headers: client.headers()
  });

  assert.equal(confirm.resultType, "ERROR");
  if (confirm.resultType === "ERROR") {
    assert.equal(confirm.error.code, "FACE_AUTH_INTENT_MISMATCH");
  }
});

test("payment init is idempotent and blocked outside payment-pending status", async () => {
  const app = createTestApp();
  const client = await loginAs(app, "client-1");

  await acknowledgeSafety(app, client);
  const jobCreateAuthSessionId = await completeTossAuth(app, client, "JOB_CREATE");

  const job = await app.dispatch({
    method: "POST",
    path: "/jobs",
    query: new URLSearchParams(),
    body: {
      title: "문 앞 전달",
      description: "생활용품 문 앞 전달",
      pickup: { address: "서울 A", lat: 37.5, lng: 127.0 },
      dropoff: { address: "서울 B", lat: 37.51, lng: 127.01 },
      transportRequirement: "walk",
      offerAmount: 15000,
      faceAuthSessionId: jobCreateAuthSessionId
    },
    headers: client.headers()
  });
  assert.equal(job.resultType, "SUCCESS");
  if (job.resultType === "ERROR") {
    return;
  }

  const first = await app.dispatch({
    method: "POST",
    path: `/payments/jobs/${job.success.jobId}/init`,
    query: new URLSearchParams(),
    body: {},
    headers: client.headers()
  });
  const second = await app.dispatch({
    method: "POST",
    path: `/payments/jobs/${job.success.jobId}/init`,
    query: new URLSearchParams(),
    body: {},
    headers: client.headers()
  });

  assert.equal(first.resultType, "SUCCESS");
  assert.equal(second.resultType, "SUCCESS");
  if (first.resultType === "SUCCESS" && second.resultType === "SUCCESS") {
    assert.equal(first.success.paymentOrderId, second.success.paymentOrderId);
    assert.equal(typeof first.success.payToken, "string");
    assert.equal(first.success.feeAmount, 2700);
    assert.equal(first.success.heldAmount, 15000);
  }

  const paymentAuthSessionId = await completeTossAuth(app, client, "PAYMENT_CONFIRM");
  await app.dispatch({
    method: "POST",
    path: `/payments/jobs/${job.success.jobId}/confirm`,
    query: new URLSearchParams(),
    body: {
      paymentOrderId: first.resultType === "SUCCESS" ? first.success.paymentOrderId : "",
      faceAuthSessionId: paymentAuthSessionId
    },
    headers: client.headers()
  });

  const afterConfirm = await app.dispatch({
    method: "POST",
    path: `/payments/jobs/${job.success.jobId}/init`,
    query: new URLSearchParams(),
    body: {},
    headers: client.headers()
  });

  assert.equal(afterConfirm.resultType, "ERROR");
  if (afterConfirm.resultType === "ERROR") {
    assert.equal(afterConfirm.error.code, "PAYMENT_INIT_NOT_ALLOWED");
  }
});

test("payment confirmation rolls back in-memory state when persistence fails", async () => {
  const store = createStore();
  const persistence = new FailingPersistenceAdapter("enqueueOutboxEvent");
  const enforcement = new EnforcementService(store, persistence);
  const auth = new AuthService(store, createMockTossAuthProvider(), loadApiRuntimeConfig(), enforcement, persistence);
  const payments = new PaymentsService(
    store,
    auth,
    persistence,
    {
      async createPayment() {
        return {
          payToken: "pay-token-order-tx-1",
          orderId: "order-tx-1",
          amount: 18000
        };
      },
      async executePayment() {
        return {
          transactionId: "tx-order-tx-1",
          status: "DONE",
          payMethod: "TOSS_PAY",
          refundableAmount: 15000
        };
      },
      async getPaymentStatus() {
        return {
          transactionId: "tx-order-tx-1",
          status: "DONE",
          payMethod: "TOSS_PAY",
          refundableAmount: 15000
        };
      }
    },
    loadApiRuntimeConfig()
  );

  store.jobs.set("job-tx-1", {
    jobId: "job-tx-1",
    clientUserId: "client-1",
    title: "테스트 의뢰",
    description: "트랜잭션 롤백 테스트",
    pickup: { address: "서울 A", lat: 37.5, lng: 127.0 },
    dropoff: { address: "서울 B", lat: 37.51, lng: 127.01 },
    transportRequirement: "walk",
    offerAmount: 15000,
    status: "PAYMENT_PENDING",
    riskLevel: "LOW",
    requiresManualReview: false,
    paymentInitRequired: true,
    hasReport: false,
    hasDispute: false,
    clientConfirmed: false,
    autoConfirmExpired: false
  });
  store.payments.set("pay-tx-1", {
    paymentId: "pay-tx-1",
    jobId: "job-tx-1",
    userId: "client-1",
    orderId: "order-tx-1",
    status: "INITIATED",
    amountTotal: 18000,
    heldAmount: 15000,
    feeAmount: 3000,
    payToken: "pay-token-order-tx-1"
  });
  store.faceAuthSessions.set("face-tx-1", {
    faceAuthSessionId: "face-tx-1",
    userId: "client-1",
    intent: "PAYMENT_CONFIRM",
    provider: "TOSS_ONE_TOUCH_AUTH",
    verifiedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
  });

  await assert.rejects(
    payments.confirmPayment("job-tx-1", "client-1", "order-tx-1", "face-tx-1"),
    /simulated persistence failure/
  );

  assert.equal(store.payments.get("pay-tx-1")?.status, "INITIATED");
  assert.equal(store.jobs.get("job-tx-1")?.status, "PAYMENT_PENDING");
  assert.equal(store.faceAuthSessions.get("face-tx-1")?.consumedAt, undefined);
});

test("job creation restores face auth when persistence fails", async () => {
  const store = createStore();
  const persistence = new FailingPersistenceAdapter("enqueueOutboxEvent");
  const enforcement = new EnforcementService(store, persistence);
  const auth = new AuthService(store, createMockTossAuthProvider(), loadApiRuntimeConfig(), enforcement, persistence);
  const jobs = new JobsService(store, auth, persistence);

  store.users.get("client-1")!.safetyAcknowledgedAt = new Date().toISOString();
  store.faceAuthSessions.set("face-job-tx-1", {
    faceAuthSessionId: "face-job-tx-1",
    userId: "client-1",
    intent: "JOB_CREATE",
    provider: "TOSS_ONE_TOUCH_AUTH",
    verifiedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
  });

  await assert.rejects(
    jobs.createJob(
      "client-1",
      {
        title: "실패 롤백 테스트",
        description: "의뢰 생성 트랜잭션 테스트",
        pickup: { address: "서울 A", lat: 37.5, lng: 127.0 },
        dropoff: { address: "서울 B", lat: 37.51, lng: 127.01 },
        transportRequirement: "walk",
        offerAmount: 15000
      },
      "face-job-tx-1"
    ),
    /simulated persistence failure/
  );

  assert.equal(store.jobs.size, 0);
  assert.equal(store.faceAuthSessions.get("face-job-tx-1")?.consumedAt, undefined);
});

test("automated restriction restores in-memory state when persistence fails", async () => {
  const store = createStore();
  const persistence = new FailingPersistenceAdapter("enqueueOutboxEvent");
  const enforcement = new EnforcementService(store, persistence);

  store.refreshSessions.set("refresh-tx-1", {
    userId: "runner-1",
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString()
  });
  store.faceAuthSessions.set("face-tx-2", {
    faceAuthSessionId: "face-tx-2",
    userId: "runner-1",
    intent: "JOB_CREATE",
    provider: "TOSS_ONE_TOUCH_AUTH",
    verifiedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
  });

  await assert.rejects(
    enforcement.applyAutomatedRestriction("runner-1", {
      reasonCode: "AI_POLICY_BLOCK",
      reasonMessage: "운영정책 위반",
      scope: "ACCOUNT_FULL",
      evidenceType: "CHAT_MESSAGE",
      evidenceSummary: "심각한 정책 위반 메시지"
    }),
    /simulated persistence failure/
  );

  assert.equal(store.users.get("runner-1")?.status, "ACTIVE");
  assert.equal(store.userEnforcementActions.size, 0);
  assert.equal(store.enforcementEvidenceBundles.size, 0);
  assert.equal(store.refreshSessions.has("refresh-tx-1"), true);
  assert.equal(store.faceAuthSessions.has("face-tx-2"), true);
  assert.equal(store.auditLogs.length, 0);
});

test("proof submission restores in-memory state when persistence fails", async () => {
  const store = createStore();
  const persistence = new FailingPersistenceAdapter("enqueueOutboxEvent");
  const runtimeConfig = loadApiRuntimeConfig();
  const tracking = new TrackingService(store, persistence, new LocalSignedProofAssetStorageProvider(runtimeConfig));

  store.jobs.set("job-proof-tx-1", {
    jobId: "job-proof-tx-1",
    clientUserId: "client-1",
    matchedRunnerUserId: "runner-1",
    title: "증빙 테스트",
    description: "배송 증빙 롤백 테스트",
    pickup: { address: "서울 A", lat: 37.5, lng: 127.0 },
    dropoff: { address: "서울 B", lat: 37.51, lng: 127.01 },
    transportRequirement: "walk",
    offerAmount: 15000,
    status: "DELIVERING",
    riskLevel: "LOW",
    requiresManualReview: false,
    paymentInitRequired: true,
    hasReport: false,
    hasDispute: false,
    clientConfirmed: false,
    autoConfirmExpired: false
  });
  store.proofUploadSessions.set("proof-upload-tx-1", {
    uploadSessionId: "proof-upload-tx-1",
    jobId: "job-proof-tx-1",
    userId: "runner-1",
    proofType: "delivery",
    source: "camera",
    objectKey: "job-proof-tx-1/delivery/proof-upload-tx-1.png",
    status: "UPLOADED",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    uploadedAt: new Date().toISOString()
  });

  await assert.rejects(
    tracking.completeProof("job-proof-tx-1", "runner-1", {
      proofType: "delivery",
      uploadSessionId: "proof-upload-tx-1"
    }),
    /simulated persistence failure/
  );

  assert.equal(store.proofPhotos.length, 0);
  assert.equal(store.jobs.get("job-proof-tx-1")?.status, "DELIVERING");
  assert.equal(store.proofUploadSessions.get("proof-upload-tx-1")?.status, "UPLOADED");
});

test("signed proof upload rejects invalid signatures", async () => {
  const app = createTestApp();
  const client = await loginAs(app, "client-1");
  const runner = await loginAs(app, "runner-1");
  const { jobId } = await createPaidOfferingJob(app, client);

  const match = await app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/assign`,
    query: new URLSearchParams(),
    body: { runnerUserId: "runner-1" },
    headers: runner.headers({ "x-actor-role": "RUNNER" })
  });
  assert.equal(match.resultType, "SUCCESS");

  for (const nextStatus of ["RUNNER_EN_ROUTE", "RUNNER_ARRIVED"] as const) {
    const update = await app.dispatch({
      method: "POST",
      path: `/jobs/${jobId}/status`,
      query: new URLSearchParams(),
      body: { nextStatus },
      headers: runner.headers({ "x-actor-role": "RUNNER" })
    });
    assert.equal(update.resultType, "SUCCESS");
  }

  const started = await app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/proof-photo/session`,
    query: new URLSearchParams(),
    body: {
      proofType: "pickup",
      source: "camera",
      mimeType: "image/png"
    },
    headers: runner.headers()
  });

  assert.equal(started.resultType, "SUCCESS");
  if (started.resultType === "ERROR") {
    throw new Error("proof upload session failed");
  }

  const signedUploadUrl = new URL(started.success.uploadUrl);
  signedUploadUrl.searchParams.set("signature", "tampered-signature");

  const uploaded = await app.dispatch({
    method: "POST",
    path: signedUploadUrl.pathname,
    query: signedUploadUrl.searchParams,
    body: {
      dataUri: SAMPLE_IMAGE_DATA_URI,
      imageId: "tampered-proof"
    },
    headers: makeHeaders({})
  });

  assert.equal(uploaded.resultType, "ERROR");
  if (uploaded.resultType === "ERROR") {
    assert.equal(uploaded.error.code, "PROOF_UPLOAD_SIGNATURE_INVALID");
  }
});

test("admin review restores job and audit state when persistence fails", async () => {
  const store = createStore();
  const persistence = new FailingPersistenceAdapter("enqueueOutboxEvent");
  const enforcement = new EnforcementService(store, persistence);
  const admin = new AdminService(store, enforcement, persistence);

  store.jobs.set("job-review-tx-1", {
    jobId: "job-review-tx-1",
    clientUserId: "client-1",
    title: "검수 테스트",
    description: "관리자 검수 롤백 테스트",
    pickup: { address: "서울 A", lat: 37.5, lng: 127.0 },
    dropoff: { address: "서울 B", lat: 37.51, lng: 127.01 },
    transportRequirement: "walk",
    offerAmount: 15000,
    status: "OPEN",
    riskLevel: "HIGH",
    requiresManualReview: true,
    paymentInitRequired: true,
    hasReport: false,
    hasDispute: false,
    clientConfirmed: false,
    autoConfirmExpired: false
  });

  await assert.rejects(
    admin.reviewJob("admin-1", "job-review-tx-1", "APPROVE", "검수 승인"),
    /simulated persistence failure/
  );

  assert.equal(store.jobs.get("job-review-tx-1")?.status, "OPEN");
  assert.equal(store.jobs.get("job-review-tx-1")?.requiresManualReview, true);
  assert.equal(store.auditLogs.length, 0);
});

test("notification routes list and mark the user's notifications", async () => {
  const store = createStore();
  store.notifications.set("notif-1", {
    notificationId: "notif-1",
    userId: "client-1",
    channel: "IN_APP",
    category: "TRANSACTION",
    title: "부르미가 배정되었어요",
    body: "의뢰를 수행할 부르미가 확정되었어요.",
    triggeredByEventId: "evt-1",
    createdAt: new Date().toISOString()
  });

  const app = createApp({
    tossAuthProvider: createMockTossAuthProvider(),
    runtimeConfig: loadApiRuntimeConfig(),
    store,
    persistence: new NoopPersistenceAdapter()
  });
  const client = await loginAs(app, "client-1");

  const listed = await app.dispatch({
    method: "GET",
    path: "/me/notifications",
    query: new URLSearchParams(),
    headers: client.headers()
  });
  assert.equal(listed.resultType, "SUCCESS");
  if (listed.resultType === "SUCCESS") {
    assert.equal(listed.success.items.length, 1);
    assert.equal(listed.success.items[0]?.notificationId, "notif-1");
  }

  const marked = await app.dispatch({
    method: "POST",
    path: "/me/notifications/notif-1/read",
    query: new URLSearchParams(),
    body: {},
    headers: client.headers()
  });
  assert.equal(marked.resultType, "SUCCESS");
  if (marked.resultType === "SUCCESS") {
    assert.ok(marked.success.readAt);
  }
});

test("outbox events project chat notifications to the counterpart only", () => {
  const store = createStore();
  store.jobs.set("job-notif-1", {
    jobId: "job-notif-1",
    clientUserId: "client-1",
    matchedRunnerUserId: "runner-1",
    title: "알림 테스트",
    description: "채팅 알림 테스트",
    pickup: { address: "서울 A", lat: 37.5, lng: 127.0 },
    dropoff: { address: "서울 B", lat: 37.51, lng: 127.01 },
    transportRequirement: "walk",
    offerAmount: 15000,
    status: "MATCHED",
    riskLevel: "LOW",
    requiresManualReview: false,
    paymentInitRequired: true,
    hasReport: false,
    hasDispute: false,
    clientConfirmed: false,
    autoConfirmExpired: false,
    chatRoomId: "room-notif-1"
  });

  const notifications = buildNotificationsForOutboxEvent(store, {
    eventId: "evt-chat-1",
    aggregateType: "CHAT_ROOM",
    aggregateId: "room-notif-1",
    eventType: "CHAT_MESSAGE_STORED",
    payload: {
      jobId: "job-notif-1",
      roomId: "room-notif-1",
      senderUserId: "runner-1",
      moderationStatus: "DELIVERED"
    },
    availableAt: new Date().toISOString()
  });

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.userId, "client-1");
  assert.equal(notifications[0]?.relatedEntityId, "room-notif-1");
});

test("cancellation rejection events notify both client and runner", () => {
  const store = createStore();
  store.jobs.set("job-cancel-notif-1", {
    jobId: "job-cancel-notif-1",
    clientUserId: "client-1",
    matchedRunnerUserId: "runner-1",
    title: "취소 알림 테스트",
    description: "합의 취소 거절 알림",
    pickup: { address: "서울 A", lat: 37.5, lng: 127.0 },
    dropoff: { address: "서울 B", lat: 37.51, lng: 127.01 },
    transportRequirement: "walk",
    offerAmount: 15000,
    status: "MATCHED",
    riskLevel: "LOW",
    requiresManualReview: false,
    paymentInitRequired: true,
    hasReport: false,
    hasDispute: false,
    clientConfirmed: false,
    autoConfirmExpired: false
  });

  const notifications = buildNotificationsForOutboxEvent(store, {
    eventId: "evt-cancel-reject-1",
    aggregateType: "JOB",
    aggregateId: "job-cancel-notif-1",
    eventType: "JOB_CANCELLATION_REJECTED",
    payload: {
      jobId: "job-cancel-notif-1",
      clientUserId: "client-1",
      runnerUserId: "runner-1"
    },
    availableAt: new Date().toISOString()
  });

  assert.equal(notifications.length, 2);
  assert.equal(notifications.some((notification) => notification.userId === "client-1"), true);
  assert.equal(notifications.some((notification) => notification.userId === "runner-1"), true);
});

test("push subscription routes register list and disable subscriptions", async () => {
  const app = createTestApp();
  const client = await loginAs(app, "client-1");

  const created = await app.dispatch({
    method: "POST",
    path: "/me/push-subscriptions",
    query: new URLSearchParams(),
    body: {
      provider: "WEBHOOK",
      endpoint: "https://push.example.test/client-1",
      deviceLabel: "test-device"
    },
    headers: client.headers()
  });
  assert.equal(created.resultType, "SUCCESS");
  if (created.resultType === "ERROR") {
    return;
  }

  const listed = await app.dispatch({
    method: "GET",
    path: "/me/push-subscriptions",
    query: new URLSearchParams(),
    headers: client.headers()
  });
  assert.equal(listed.resultType, "SUCCESS");
  if (listed.resultType === "SUCCESS") {
    assert.equal(listed.success.items.length, 1);
    assert.equal(listed.success.items[0]?.subscriptionId, created.success.subscriptionId);
  }

  const disabled = await app.dispatch({
    method: "POST",
    path: `/me/push-subscriptions/${created.success.subscriptionId}/disable`,
    query: new URLSearchParams(),
    body: {},
    headers: client.headers()
  });
  assert.equal(disabled.resultType, "SUCCESS");
  if (disabled.resultType === "SUCCESS") {
    assert.ok(disabled.success.disabledAt);
  }
});

test("push dispatch excludes chat-only notifications by default", () => {
  assert.equal(
    shouldDispatchPush({
      notificationId: "notif-chat-1",
      userId: "client-1",
      channel: "IN_APP",
      category: "CHAT",
      title: "새 채팅",
      body: "메시지가 도착했어요",
      triggeredByEventId: "evt-chat-1",
      createdAt: new Date().toISOString()
    }),
    false
  );

  assert.equal(
    shouldDispatchPush({
      notificationId: "notif-account-1",
      userId: "client-1",
      channel: "IN_APP",
      category: "ACCOUNT",
      title: "제재 결과",
      body: "계정 상태가 변경되었어요",
      triggeredByEventId: "evt-account-1",
      createdAt: new Date().toISOString()
    }),
    true
  );
});

test("push webhook signatures are deterministic", () => {
  const payload = JSON.stringify({ notificationId: "notif-1", userId: "client-1" });
  const timestamp = "2026-03-09T12:00:00.000Z";
  const signature = createPushWebhookSignature(payload, timestamp, "secret-key");

  assert.equal(signature, createPushWebhookSignature(payload, timestamp, "secret-key"));
  assert.notEqual(signature, createPushWebhookSignature(payload, timestamp, "other-secret"));
});

test("admin push monitoring routes expose subscription and delivery summaries", async () => {
  const store = createStore();
  store.pushSubscriptions.set("push-sub-1", {
    subscriptionId: "push-sub-1",
    userId: "client-1",
    provider: "WEBHOOK",
    endpoint: "https://push.example.test/client-1",
    deviceLabel: "client-device",
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    failureCount: 2
  });
  store.pushSubscriptions.set("push-sub-2", {
    subscriptionId: "push-sub-2",
    userId: "runner-1",
    provider: "WEBHOOK",
    endpoint: "https://push.example.test/runner-1",
    deviceLabel: "runner-device",
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    disabledAt: new Date().toISOString(),
    failureCount: 3
  });
  store.pushDeliveryAttempts.set("push-attempt-1", {
    deliveryAttemptId: "push-attempt-1",
    notificationId: "notif-1",
    subscriptionId: "push-sub-1",
    provider: "WEBHOOK",
    status: "SUCCESS",
    attemptedAt: new Date().toISOString()
  });
  store.pushDeliveryAttempts.set("push-attempt-2", {
    deliveryAttemptId: "push-attempt-2",
    notificationId: "notif-2",
    subscriptionId: "push-sub-2",
    provider: "WEBHOOK",
    status: "FAILED",
    attemptedAt: new Date().toISOString(),
    errorMessage: "webhook failed"
  });

  const app = createApp({
    tossAuthProvider: createMockTossAuthProvider(),
    runtimeConfig: loadApiRuntimeConfig(),
    store,
    persistence: new NoopPersistenceAdapter()
  });
  const admin = await loginAs(app, "admin-1");

  const subscriptions = await app.dispatch({
    method: "GET",
    path: "/admin/push-subscriptions",
    query: new URLSearchParams(),
    headers: admin.headers()
  });
  assert.equal(subscriptions.resultType, "SUCCESS");
  if (subscriptions.resultType === "SUCCESS") {
    assert.equal(subscriptions.success.summary.total, 2);
    assert.equal(subscriptions.success.summary.active, 1);
    assert.equal(subscriptions.success.summary.disabled, 1);
    assert.equal(subscriptions.success.summary.failing, 1);
  }

  const deliveries = await app.dispatch({
    method: "GET",
    path: "/admin/push-deliveries",
    query: new URLSearchParams(),
    headers: admin.headers()
  });
  assert.equal(deliveries.resultType, "SUCCESS");
  if (deliveries.resultType === "SUCCESS") {
    assert.equal(deliveries.success.summary.total, 2);
    assert.equal(deliveries.success.summary.success, 1);
    assert.equal(deliveries.success.summary.failed, 1);
    assert.equal(deliveries.success.summary.skipped, 0);
  }
});

test("admin runtime workers route exposes heartbeat records", async () => {
  const store = createStore();
  store.workerHeartbeats.set("idle-timeout-worker", {
    workerKey: "idle-timeout-worker",
    lastStartedAt: new Date(Date.now() - 60_000).toISOString(),
    lastCompletedAt: new Date().toISOString(),
    lastStatus: "SUCCESS",
    lastSummary: {
      scanned: 4,
      cancelled: 1
    }
  });

  const app = createApp({
    tossAuthProvider: createMockTossAuthProvider(),
    runtimeConfig: loadApiRuntimeConfig(),
    store,
    persistence: new NoopPersistenceAdapter()
  });
  const admin = await loginAs(app, "admin-1");

  const result = await app.dispatch({
    method: "GET",
    path: "/admin/runtime-workers",
    query: new URLSearchParams(),
    headers: admin.headers()
  });

  assert.equal(result.resultType, "SUCCESS");
  if (result.resultType === "SUCCESS") {
    assert.equal(result.success.items[0]?.workerKey, "idle-timeout-worker");
    assert.equal(result.success.items[0]?.lastStatus, "SUCCESS");
  }
});

test("admin runtime readiness route reports placeholder launch blockers", async () => {
  const app = createTestApp();
  const admin = await loginAs(app, "admin-1");

  const result = await app.dispatch({
    method: "GET",
    path: "/admin/runtime-readiness",
    query: new URLSearchParams(),
    headers: admin.headers()
  });

  assert.equal(result.resultType, "SUCCESS");
  if (result.resultType === "SUCCESS") {
    assert.equal(result.success.overallStatus, "ACTION_REQUIRED");
    assert.deepEqual(
      result.success.owners.map((owner) => owner.owner),
      ["INFRA", "SECURITY", "PARTNERSHIP", "BACKEND"]
    );
    assert.equal(result.success.owners.find((owner) => owner.owner === "INFRA")?.blockers, 3);
    assert.equal(result.success.owners.find((owner) => owner.owner === "SECURITY")?.blockers, 2);
    assert.equal(result.success.owners.find((owner) => owner.owner === "PARTNERSHIP")?.blockers, 2);
    assert.equal(result.success.owners.find((owner) => owner.owner === "BACKEND")?.warnings, 1);
    assert.deepEqual(
      result.success.checks.find((check) => check.key === "runtime-secrets")?.envKeys,
      ["BUTO_AUTH_TOKEN_SECRET", "BUTO_INTERNAL_SYSTEM_KEY"]
    );
    assert.deepEqual(
      result.success.checks.find((check) => check.key === "cors-origins")?.envKeys,
      ["BUTO_ALLOWED_ORIGINS"]
    );
    assert.ok(result.success.checks.some((check) => check.key === "proof-storage-provider" && check.status === "BLOCK"));
    assert.ok(result.success.checks.some((check) => check.key === "cors-origins" && check.status === "BLOCK"));
  }
});

test("runtime readiness can confirm configured cert files and non-placeholder origins", async () => {
  const certDir = await mkdtemp(path.join(tmpdir(), "buto-runtime-readiness-"));
  const certPath = path.join(certDir, "partner.crt");
  const keyPath = path.join(certDir, "partner.key");
  await writeFile(certPath, "dummy cert");
  await writeFile(keyPath, "dummy key");

  const app = createTestApp({
    BUTO_DATABASE_URL: "postgres://buto:secret@db.internal/buto",
    BUTO_AUTH_TOKEN_SECRET: "prod-auth-secret",
    BUTO_INTERNAL_SYSTEM_KEY: "prod-internal-key",
    BUTO_PROOF_STORAGE_PROVIDER: "s3",
    BUTO_ALLOWED_ORIGINS: "https://apps-in-toss-sandbox.toss.im,https://apps-in-toss-live.toss.im",
    BUTO_UPLOAD_PUBLIC_BASE_URL: "https://upload.buto.example",
    BUTO_PROOF_PUBLIC_BASE_URL: "https://cdn.buto.example/proofs",
    BUTO_PROOF_S3_BUCKET: "buto-proof-bucket",
    BUTO_PROOF_S3_REGION: "ap-northeast-2",
    BUTO_PROOF_S3_ENDPOINT: "https://s3.ap-northeast-2.amazonaws.com",
    BUTO_PROOF_S3_ACCESS_KEY_ID: "proof-access-key",
    BUTO_PROOF_S3_SECRET_ACCESS_KEY: "proof-secret-key",
    TOSS_UNLINK_BASIC_USER: "unlink-user",
    TOSS_UNLINK_BASIC_PASSWORD: "unlink-password",
    TOSS_LOGIN_TOKEN_URL: "https://login.toss.example/token",
    TOSS_LOGIN_ME_URL: "https://login.toss.example/me",
    TOSS_PARTNER_CLIENT_ID: "partner-client-id",
    TOSS_PARTNER_CLIENT_SECRET: "partner-client-secret",
    TOSS_PARTNER_CERT_PATH: certPath,
    TOSS_PARTNER_KEY_PATH: keyPath,
    TOSS_PARTNER_CA_PATH: certPath,
    TOSS_CERT_TOKEN_URL: "https://cert.toss.example/token",
    TOSS_CERT_REQUEST_URL: "https://cert.toss.example/request",
    TOSS_CERT_STATUS_URL: "https://cert.toss.example/status",
    TOSS_CERT_RESULT_URL: "https://cert.toss.example/result",
    TOSS_CERT_CLIENT_ID: "cert-client-id",
    TOSS_CERT_CLIENT_SECRET: "cert-client-secret",
    TOSS_CERT_REQUEST_URL_SCHEME: "buto://toss-cert",
    TOSS_PAY_BASE_URL: "https://pay-apps-in-toss-api.toss.im",
    TOSS_PAY_CLIENT_ID: "pay-client-id",
    TOSS_PAY_CLIENT_SECRET: "pay-client-secret",
    TOSS_PAY_MERCHANT_ID: "merchant-id",
    TOSS_PAY_TEST_MODE: "false",
    BUTO_STRICT_RUNTIME_ENV: "true",
    BUTO_STRICT_DATABASE_ENV: "true"
  });
  const admin = await loginAs(app, "admin-1");

  const result = await app.dispatch({
    method: "GET",
    path: "/admin/runtime-readiness",
    query: new URLSearchParams(),
    headers: admin.headers()
  });

  assert.equal(result.resultType, "SUCCESS");
  if (result.resultType === "SUCCESS") {
    const mtlsCheck = result.success.checks.find((check) => check.key === "mtls-certificates");
    const corsCheck = result.success.checks.find((check) => check.key === "cors-origins");
    const unlinkCheck = result.success.checks.find((check) => check.key === "unlink-basic-auth");
    const storageCheck = result.success.checks.find((check) => check.key === "proof-storage-provider");
    const authCheck = result.success.checks.find((check) => check.key === "toss-auth-env");
    const infraOwner = result.success.owners.find((owner) => owner.owner === "INFRA");
    const securityOwner = result.success.owners.find((owner) => owner.owner === "SECURITY");
    const partnershipOwner = result.success.owners.find((owner) => owner.owner === "PARTNERSHIP");
    const backendOwner = result.success.owners.find((owner) => owner.owner === "BACKEND");

    assert.equal(result.success.overallStatus, "READY");
    assert.equal(mtlsCheck?.status, "PASS");
    assert.equal(corsCheck?.status, "PASS");
    assert.equal(unlinkCheck?.status, "PASS");
    assert.equal(storageCheck?.status, "PASS");
    assert.equal(authCheck?.status, "PASS");
    assert.equal(infraOwner?.blockers, 0);
    assert.equal(infraOwner?.warnings, 0);
    assert.equal(securityOwner?.blockers, 0);
    assert.equal(partnershipOwner?.blockers, 0);
    assert.equal(backendOwner?.warnings, 0);
  }
});

test("admin runtime readiness markdown routes expose copy-ready report, action plans, env handoff, and release snapshot", async () => {
  const app = createTestApp();
  const admin = await loginAs(app, "admin-1");

  const [reportResult, actionPlanResult, envHandoffResult, infraEnvHandoffResult, releaseStatusResult] = await Promise.all([
    app.dispatch({
      method: "GET",
      path: "/admin/runtime-readiness/report",
      query: new URLSearchParams(),
      headers: admin.headers()
    }),
    app.dispatch({
      method: "GET",
      path: "/admin/runtime-readiness/action-plan",
      query: new URLSearchParams(),
      headers: admin.headers()
    }),
    app.dispatch({
      method: "GET",
      path: "/admin/runtime-readiness/env-handoff",
      query: new URLSearchParams(),
      headers: admin.headers()
    }),
    app.dispatch({
      method: "GET",
      path: "/admin/runtime-readiness/env-handoff/INFRA",
      query: new URLSearchParams(),
      headers: admin.headers()
    }),
    app.dispatch({
      method: "GET",
      path: "/admin/release-status/report",
      query: new URLSearchParams(),
      headers: admin.headers()
    })
  ]);

  assert.equal(reportResult.resultType, "SUCCESS");
  assert.equal(actionPlanResult.resultType, "SUCCESS");
  assert.equal(envHandoffResult.resultType, "SUCCESS");
  assert.equal(infraEnvHandoffResult.resultType, "SUCCESS");
  assert.equal(releaseStatusResult.resultType, "SUCCESS");

  if (reportResult.resultType === "SUCCESS") {
    assert.equal(reportResult.success.fileName, "runtime-readiness-report.md");
    assert.match(reportResult.success.markdown, /# BUTO Runtime Readiness Report/);
    assert.match(reportResult.success.markdown, /## Owner Summary/);
  }

  if (actionPlanResult.resultType === "SUCCESS") {
    assert.equal(actionPlanResult.success.fileName, "owner-action-plan.md");
    assert.match(actionPlanResult.success.markdown, /# BUTO Owner Action Plan/);
    assert.match(actionPlanResult.success.markdown, /## Infrastructure/);
  }

  if (envHandoffResult.resultType === "SUCCESS") {
    assert.equal(envHandoffResult.success.fileName, "owner-env-handoff.md");
    assert.match(envHandoffResult.success.markdown, /# BUTO Owner Env Handoff/);
    assert.match(envHandoffResult.success.markdown, /BUTO_AUTH_TOKEN_SECRET=/);
  }

  if (infraEnvHandoffResult.resultType === "SUCCESS") {
    assert.equal(infraEnvHandoffResult.success.fileName, "infra-env-handoff.md");
    assert.match(infraEnvHandoffResult.success.markdown, /## Infrastructure/);
    assert.doesNotMatch(infraEnvHandoffResult.success.markdown, /## Security/);
  }

  if (releaseStatusResult.resultType === "SUCCESS") {
    assert.equal(releaseStatusResult.success.fileName, "release-status-snapshot.md");
    assert.match(releaseStatusResult.success.markdown, /# BUTO Release Status Snapshot/);
    assert.match(releaseStatusResult.success.markdown, /## Checklist Summary/);
    assert.match(releaseStatusResult.success.markdown, /## Recent Bundles/);
  }
});

test("admin submission bundles route exposes recent bundle readiness summaries", async () => {
  const app = createTestApp();
  const admin = await loginAs(app, "admin-1");

  const result = await app.dispatch({
    method: "GET",
    path: "/admin/submission-bundles",
    query: new URLSearchParams([["limit", "3"]]),
    headers: admin.headers()
  });

  assert.equal(result.resultType, "SUCCESS");

  if (result.resultType === "SUCCESS") {
    assert.ok(Array.isArray(result.success.items));
    assert.ok(result.success.items.length >= 1);
    assert.equal(typeof result.success.items[0]?.bundleLabel, "string");
    assert.equal(typeof result.success.items[0]?.generatedAt, "string");
    assert.equal(typeof result.success.items[0]?.documentCount, "number");
    assert.equal(typeof result.success.items[0]?.envFileCount, "number");
    assert.ok(["COMPLETE", "INCOMPLETE"].includes(String(result.success.items[0]?.integrityStatus)));
    assert.ok(Array.isArray(result.success.items[0]?.missingFiles));
  }
});

test("admin submission bundle detail route exposes readme and manifest-derived files", async () => {
  const app = createTestApp();
  const admin = await loginAs(app, "admin-1");

  const listResult = await app.dispatch({
    method: "GET",
    path: "/admin/submission-bundles",
    query: new URLSearchParams([["limit", "1"]]),
    headers: admin.headers()
  });

  assert.equal(listResult.resultType, "SUCCESS");
  if (listResult.resultType !== "SUCCESS") {
    return;
  }

  const bundleLabel = listResult.success.items[0]?.bundleLabel;
  assert.ok(bundleLabel);

  const detailResult = await app.dispatch({
    method: "GET",
    path: `/admin/submission-bundles/${bundleLabel}`,
    query: new URLSearchParams(),
    headers: admin.headers()
  });

  assert.equal(detailResult.resultType, "SUCCESS");

  if (detailResult.resultType === "SUCCESS") {
    assert.equal(detailResult.success.bundleLabel, bundleLabel);
    assert.match(detailResult.success.readmeMarkdown, /# BUTO Submission Bundle/);
    assert.ok(Array.isArray(detailResult.success.documents));
    assert.ok(Array.isArray(detailResult.success.envFiles));
    assert.ok(["COMPLETE", "INCOMPLETE"].includes(detailResult.success.integrityStatus));
    assert.ok(Array.isArray(detailResult.success.missingFiles));
  }
});

test("admin submission bundle recommendation route returns conservative candidate guidance", async () => {
  const app = createTestApp();
  const admin = await loginAs(app, "admin-1");

  const result = await app.dispatch({
    method: "GET",
    path: "/admin/submission-bundles/recommendation",
    query: new URLSearchParams(),
    headers: admin.headers()
  });

  assert.equal(result.resultType, "SUCCESS");
  if (result.resultType === "SUCCESS") {
    assert.ok(["READY_TO_SUBMIT", "ACTION_REQUIRED"].includes(result.success.status));
    assert.ok(Array.isArray(result.success.reasons));
  }
});

test("admin release submission decision route returns final launch gate decision", async () => {
  const app = createTestApp();
  const admin = await loginAs(app, "admin-1");

  const result = await app.dispatch({
    method: "GET",
    path: "/admin/release-status/decision",
    query: new URLSearchParams(),
    headers: admin.headers()
  });

  assert.equal(result.resultType, "SUCCESS");
  if (result.resultType === "SUCCESS") {
    assert.ok(["BLOCKED", "CONDITIONAL", "READY"].includes(result.success.decision));
    assert.equal(typeof result.success.summary, "string");
    assert.ok(Array.isArray(result.success.reasons));
  }
});

test("admin dispute detail route returns evidence bundle for open disputes", async () => {
  const store = createStore();
  store.jobs.set("job-dispute-1", {
    jobId: "job-dispute-1",
    clientUserId: "client-1",
    matchedRunnerUserId: "runner-1",
    title: "문 앞 전달 분쟁",
    description: "픽업 후 전달 여부 분쟁",
    pickup: { address: "서울 서초구 A", lat: 37.5, lng: 127.0 },
    dropoff: { address: "서울 강남구 B", lat: 37.51, lng: 127.01 },
    transportRequirement: "walk",
    offerAmount: 22000,
    status: "DISPUTED",
    riskLevel: "HIGH",
    requiresManualReview: false,
    paymentInitRequired: false,
    hasReport: true,
    hasDispute: true,
    clientConfirmed: false,
    autoConfirmExpired: false,
    chatRoomId: "room-dispute-1"
  });
  store.payments.set("payment-dispute-1", {
    paymentId: "payment-dispute-1",
    jobId: "job-dispute-1",
    userId: "client-1",
    orderId: "order-dispute-1",
    status: "HELD",
    amountTotal: 25000,
    heldAmount: 22000,
    feeAmount: 3000,
    providerPaymentMethod: "TOSS_PAY",
    providerStatus: "DONE",
    transactionId: "tx-dispute-1",
    approvedAt: new Date().toISOString()
  });
  store.chatMessages.set("room-dispute-1", [
    {
      messageId: "msg-dispute-1",
      roomId: "room-dispute-1",
      senderUserId: "runner-1",
      messageType: "text",
      body: "도착했는데 응답이 없어요.",
      moderationStatus: "CLEAR",
      actionTaken: "ALLOW",
      createdAt: new Date().toISOString()
    }
  ]);
  store.locationLogs.push({
    jobId: "job-dispute-1",
    userId: "runner-1",
    role: "RUNNER",
    lat: 37.50012,
    lng: 127.00045,
    accuracy: 14,
    source: "app",
    loggedAt: new Date().toISOString()
  });
  store.proofPhotos.push({
    proofId: "proof-dispute-1",
    jobId: "job-dispute-1",
    uploadedBy: "runner-1",
    proofType: "pickup",
    s3Key: "proofs/job-dispute-1/pickup.jpg",
    watermarkedUrl: "https://cdn.example.test/proofs/job-dispute-1/pickup.jpg",
    createdAt: new Date().toISOString()
  });
  store.reports.set("report-dispute-1", {
    reportId: "report-dispute-1",
    jobId: "job-dispute-1",
    reporterUserId: "client-1",
    targetUserId: "runner-1",
    reportType: "NO_SHOW",
    detail: "도착 연락 이후 응답이 없었어요.",
    createdAt: new Date().toISOString()
  });
  store.emergencies.set("emergency-dispute-1", {
    emergencyEventId: "emergency-dispute-1",
    jobId: "job-dispute-1",
    eventType: "SOS",
    lat: 37.50012,
    lng: 127.00045,
    createdAt: new Date().toISOString()
  });

  const app = createApp({
    tossAuthProvider: createMockTossAuthProvider(),
    runtimeConfig: loadApiRuntimeConfig(),
    store,
    persistence: new NoopPersistenceAdapter()
  });
  const admin = await loginAs(app, "admin-1");

  const result = await app.dispatch({
    method: "GET",
    path: "/admin/disputes/job-dispute-1",
    query: new URLSearchParams(),
    headers: admin.headers()
  });

  assert.equal(result.resultType, "SUCCESS");
  if (result.resultType === "SUCCESS") {
    assert.equal(result.success.job.jobId, "job-dispute-1");
    assert.equal(result.success.payment?.status, "HELD");
    assert.equal(result.success.chatMessages.length, 1);
    assert.equal(result.success.locationLogs.length, 1);
    assert.equal(result.success.proofPhotos.length, 1);
    assert.equal(result.success.reports.length, 1);
    assert.equal(result.success.emergencies.length, 1);
  }
});

test("admin disputes route supports filters and pagination", async () => {
  const store = createStore();
  store.jobs.set("job-dispute-a", {
    jobId: "job-dispute-a",
    clientUserId: "client-1",
    matchedRunnerUserId: "runner-1",
    title: "첫 번째 분쟁",
    description: "고위험 분쟁",
    pickup: { address: "서울 A", lat: 37.5, lng: 127.0 },
    dropoff: { address: "서울 B", lat: 37.51, lng: 127.01 },
    transportRequirement: "walk",
    offerAmount: 10000,
    status: "DISPUTED",
    riskLevel: "HIGH",
    requiresManualReview: false,
    paymentInitRequired: false,
    hasReport: true,
    hasDispute: true,
    clientConfirmed: false,
    autoConfirmExpired: false
  });
  store.jobs.set("job-dispute-b", {
    jobId: "job-dispute-b",
    clientUserId: "client-1",
    matchedRunnerUserId: "runner-1",
    title: "두 번째 분쟁",
    description: "중간 위험 분쟁",
    pickup: { address: "서울 A", lat: 37.5, lng: 127.0 },
    dropoff: { address: "서울 B", lat: 37.51, lng: 127.01 },
    transportRequirement: "walk",
    offerAmount: 11000,
    status: "DISPUTED",
    riskLevel: "MEDIUM",
    requiresManualReview: false,
    paymentInitRequired: false,
    hasReport: false,
    hasDispute: true,
    clientConfirmed: false,
    autoConfirmExpired: false
  });
  store.jobs.set("job-dispute-c", {
    jobId: "job-dispute-c",
    clientUserId: "client-1",
    matchedRunnerUserId: "runner-1",
    title: "세 번째 분쟁",
    description: "전달 증빙 대기",
    pickup: { address: "서울 A", lat: 37.5, lng: 127.0 },
    dropoff: { address: "서울 B", lat: 37.51, lng: 127.01 },
    transportRequirement: "walk",
    offerAmount: 12000,
    status: "DELIVERY_PROOF_SUBMITTED",
    riskLevel: "HIGH",
    requiresManualReview: false,
    paymentInitRequired: false,
    hasReport: false,
    hasDispute: true,
    clientConfirmed: false,
    autoConfirmExpired: false
  });

  const app = createApp({
    tossAuthProvider: createMockTossAuthProvider(),
    runtimeConfig: loadApiRuntimeConfig(),
    store,
    persistence: new NoopPersistenceAdapter()
  });
  const admin = await loginAs(app, "admin-1");

  const result = await app.dispatch({
    method: "GET",
    path: "/admin/disputes",
    query: new URLSearchParams([
      ["riskLevel", "HIGH"],
      ["status", "DISPUTED"],
      ["page", "1"],
      ["pageSize", "1"]
    ]),
    headers: admin.headers()
  });

  assert.equal(result.resultType, "SUCCESS");
  if (result.resultType === "SUCCESS") {
    assert.equal(result.success.total, 1);
    assert.equal(result.success.page, 1);
    assert.equal(result.success.pageSize, 1);
    assert.equal(result.success.hasNextPage, false);
    assert.equal(result.success.items[0]?.jobId, "job-dispute-a");
  }
});

test("worker failure notifications are persisted for admin accounts", async () => {
  const store = createStore();
  const persistence = new NoopPersistenceAdapter();

  await persistWorkerFailureNotifications({
    store,
    persistence,
    workerKey: "push-dispatch-worker",
    startedAt: new Date().toISOString(),
    errorMessage: "webhook provider unavailable"
  });

  const notifications = [...store.notifications.values()].filter((notification) => notification.userId === "admin-1");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.category, "ACCOUNT");
  assert.match(notifications[0]?.title ?? "", /worker 실패/);
});

test("support fallback routes list and acknowledge user fallback records", async () => {
  const store = createStore();
  store.supportFallbacks.set("support-1", {
    fallbackId: "support-1",
    userId: "client-1",
    sourceNotificationId: "notif-1",
    channel: "KAKAO_CHANNEL",
    status: "OPEN",
    reasonCode: "NO_ACTIVE_PUSH_SUBSCRIPTION",
    reasonMessage: "푸시 수신 채널이 없어 카카오톡 상담 채널 안내로 대체했어요.",
    createdAt: new Date().toISOString()
  });

  const app = createApp({
    tossAuthProvider: createMockTossAuthProvider(),
    runtimeConfig: loadApiRuntimeConfig(),
    store,
    persistence: new NoopPersistenceAdapter()
  });
  const client = await loginAs(app, "client-1");

  const listed = await app.dispatch({
    method: "GET",
    path: "/me/support-fallbacks",
    query: new URLSearchParams(),
    headers: client.headers()
  });
  assert.equal(listed.resultType, "SUCCESS");
  if (listed.resultType === "SUCCESS") {
    assert.equal(listed.success.items.length, 1);
    assert.equal(listed.success.items[0]?.fallbackId, "support-1");
  }

  const acknowledged = await app.dispatch({
    method: "POST",
    path: "/me/support-fallbacks/support-1/acknowledge",
    query: new URLSearchParams(),
    body: {},
    headers: client.headers()
  });
  assert.equal(acknowledged.resultType, "SUCCESS");
  if (acknowledged.resultType === "SUCCESS") {
    assert.equal(acknowledged.success.status, "ACKNOWLEDGED");
    assert.ok(acknowledged.success.acknowledgedAt);
  }
});

test("admin support fallback monitoring summarizes open and acknowledged cases", async () => {
  const store = createStore();
  store.supportFallbacks.set("support-open-1", {
    fallbackId: "support-open-1",
    userId: "client-1",
    sourceNotificationId: "notif-1",
    channel: "KAKAO_CHANNEL",
    status: "OPEN",
    reasonCode: "NO_ACTIVE_PUSH_SUBSCRIPTION",
    reasonMessage: "푸시 수신 채널이 없어 카카오톡 상담 채널 안내로 대체했어요.",
    createdAt: new Date().toISOString()
  });
  store.supportFallbacks.set("support-ack-1", {
    fallbackId: "support-ack-1",
    userId: "runner-1",
    sourceNotificationId: "notif-2",
    channel: "KAKAO_CHANNEL",
    status: "ACKNOWLEDGED",
    reasonCode: "PUSH_DELIVERY_DISABLED",
    reasonMessage: "푸시 전달이 반복 실패해 카카오톡 상담 채널 안내로 전환했어요.",
    createdAt: new Date().toISOString(),
    acknowledgedAt: new Date().toISOString()
  });

  const app = createApp({
    tossAuthProvider: createMockTossAuthProvider(),
    runtimeConfig: loadApiRuntimeConfig(),
    store,
    persistence: new NoopPersistenceAdapter()
  });
  const admin = await loginAs(app, "admin-1");

  const listed = await app.dispatch({
    method: "GET",
    path: "/admin/support-fallbacks",
    query: new URLSearchParams(),
    headers: admin.headers()
  });
  assert.equal(listed.resultType, "SUCCESS");
  if (listed.resultType === "SUCCESS") {
    assert.equal(listed.success.summary.total, 2);
    assert.equal(listed.success.summary.open, 1);
    assert.equal(listed.success.summary.acknowledged, 1);
  }
});

test("admin ops dashboard aggregates queue, push, and support fallback metrics", async () => {
  const store = createStore();
  store.jobs.set("job-dashboard-review", {
    jobId: "job-dashboard-review",
    clientUserId: "client-1",
    title: "검수 대시보드",
    description: "검수 큐 테스트",
    pickup: { address: "서울 A", lat: 37.5, lng: 127 },
    dropoff: { address: "서울 B", lat: 37.6, lng: 127.1 },
    transportRequirement: "walk",
    offerAmount: 15000,
    status: "OPEN",
    riskLevel: "HIGH",
    requiresManualReview: true,
    paymentInitRequired: true,
    hasReport: false,
    hasDispute: false,
    clientConfirmed: false,
    autoConfirmExpired: false
  });
  store.jobs.set("job-dashboard-dispute", {
    jobId: "job-dashboard-dispute",
    clientUserId: "client-1",
    matchedRunnerUserId: "runner-1",
    title: "분쟁 대시보드",
    description: "분쟁 큐 테스트",
    pickup: { address: "서울 A", lat: 37.5, lng: 127 },
    dropoff: { address: "서울 B", lat: 37.6, lng: 127.1 },
    transportRequirement: "walk",
    offerAmount: 15000,
    status: "DISPUTED",
    riskLevel: "LOW",
    requiresManualReview: false,
    paymentInitRequired: true,
    hasReport: false,
    hasDispute: true,
    clientConfirmed: false,
    autoConfirmExpired: false
  });
  store.emergencies.set("emergency-dashboard-1", {
    emergencyEventId: "emergency-dashboard-1",
    jobId: "job-dashboard-dispute",
    eventType: "SOS",
    lat: 37.5,
    lng: 127,
    createdAt: new Date().toISOString()
  });
  store.users.get("runner-1")!.status = "RESTRICTED";
  store.pushSubscriptions.set("push-sub-dashboard", {
    subscriptionId: "push-sub-dashboard",
    userId: "client-1",
    provider: "WEBHOOK",
    endpoint: "https://push.example.test/client-1",
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    failureCount: 1
  });
  store.pushDeliveryAttempts.set("push-attempt-dashboard", {
    deliveryAttemptId: "push-attempt-dashboard",
    notificationId: "notif-dashboard",
    subscriptionId: "push-sub-dashboard",
    provider: "WEBHOOK",
    status: "FAILED",
    attemptedAt: new Date().toISOString(),
    errorMessage: "webhook failed"
  });
  store.supportFallbacks.set("support-dashboard", {
    fallbackId: "support-dashboard",
    userId: "client-1",
    sourceNotificationId: "notif-dashboard",
    channel: "KAKAO_CHANNEL",
    status: "OPEN",
    reasonCode: "PUSH_DELIVERY_REPEATED_FAILURE",
    reasonMessage: "푸시 전달 실패가 발생해 카카오톡 상담 채널 안내를 준비했어요.",
    createdAt: new Date().toISOString()
  });
  store.workerHeartbeats.set("push-dispatch-worker", {
    workerKey: "push-dispatch-worker",
    lastStartedAt: new Date(Date.now() - 30_000).toISOString(),
    lastCompletedAt: new Date().toISOString(),
    lastStatus: "FAILED",
    lastSummary: {
      processed: 2,
      failed: 1
    }
  });

  const app = createApp({
    tossAuthProvider: createMockTossAuthProvider(),
    runtimeConfig: loadApiRuntimeConfig(),
    store,
    persistence: new NoopPersistenceAdapter()
  });
  const admin = await loginAs(app, "admin-1");

  const result = await app.dispatch({
    method: "GET",
    path: "/admin/ops-dashboard",
    query: new URLSearchParams(),
    headers: admin.headers()
  });
  assert.equal(result.resultType, "SUCCESS");
  if (result.resultType === "SUCCESS") {
    assert.equal(result.success.queueCounts.reviewQueue, 1);
    assert.equal(result.success.queueCounts.disputes, 1);
    assert.equal(result.success.queueCounts.emergencies, 1);
    assert.equal(result.success.queueCounts.blockedUsers, 1);
    assert.equal(result.success.push.subscriptions.failing, 1);
    assert.equal(result.success.push.deliveries.failed, 1);
    assert.equal(result.success.supportFallbacks.open, 1);
    assert.equal(result.success.recentAlerts.some((alert) => alert.kind === "WORKER_FAILURE"), true);
    assert.equal(result.success.recentAlerts.length > 0, true);
  }
});

test("only the matched runner can upload proof photos", async () => {
  const app = createTestApp();
  const client = await loginAs(app, "client-1");
  const runner = await loginAs(app, "runner-1");
  const { jobId } = await createPaidOfferingJob(app, client);

  await app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/assign`,
    query: new URLSearchParams(),
    body: { runnerUserId: "runner-1" },
    headers: runner.headers({ "x-actor-role": "RUNNER" })
  });

  const unauthorized = await app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/proof-photo/complete`,
    query: new URLSearchParams(),
    body: { proofType: "pickup", uploadSessionId: "proof-upload-missing" },
    headers: client.headers()
  });

  assert.equal(unauthorized.resultType, "ERROR");
  if (unauthorized.resultType === "ERROR") {
    assert.equal(unauthorized.error.code, "PROOF_NOT_AUTHORIZED");
  }
});

test("signed proof upload url accepts upload and completes proof", async () => {
  const app = createTestApp();
  const client = await loginAs(app, "client-1");
  const runner = await loginAs(app, "runner-1");
  const { jobId } = await createPaidOfferingJob(app, client);

  await app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/assign`,
    query: new URLSearchParams(),
    body: { runnerUserId: "runner-1" },
    headers: runner.headers({ "x-actor-role": "RUNNER" })
  });
  await app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/status`,
    query: new URLSearchParams(),
    body: { nextStatus: "RUNNER_EN_ROUTE" },
    headers: runner.headers({ "x-actor-role": "RUNNER" })
  });
  await app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/status`,
    query: new URLSearchParams(),
    body: { nextStatus: "RUNNER_ARRIVED" },
    headers: runner.headers({ "x-actor-role": "RUNNER" })
  });

  const session = await app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/proof-photo/session`,
    query: new URLSearchParams(),
    body: {
      proofType: "pickup",
      source: "camera",
      mimeType: "image/png"
    },
    headers: runner.headers()
  });
  assert.equal(session.resultType, "SUCCESS");
  if (session.resultType === "ERROR") {
    return;
  }

  const uploadUrl = new URL(session.success.uploadUrl);
  const uploaded = await app.dispatch({
    method: "POST",
    path: uploadUrl.pathname,
    query: uploadUrl.searchParams,
    body: {
      dataUri: SAMPLE_IMAGE_DATA_URI,
      imageId: "image-1",
      mimeTypeHint: "image/png"
    },
    headers: new Headers()
  });
  assert.equal(uploaded.resultType, "SUCCESS");

  const completed = await app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/proof-photo/complete`,
    query: new URLSearchParams(),
    body: {
      proofType: "pickup",
      uploadSessionId: session.success.uploadSessionId
    },
    headers: runner.headers()
  });
  assert.equal(completed.resultType, "SUCCESS");
  if (completed.resultType === "SUCCESS") {
    assert.match(completed.success.watermarkedUrl, /cdn-placeholder\.invalid/);
  }
});

test("active jobs endpoint returns participant-only in-flight jobs", async () => {
  const app = createTestApp();
  const client = await loginAs(app, "client-1");
  const runner = await loginAs(app, "runner-1");
  const { jobId } = await createPaidOfferingJob(app, client);

  await app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/assign`,
    query: new URLSearchParams(),
    body: { runnerUserId: "runner-1" },
    headers: runner.headers({ "x-actor-role": "RUNNER" })
  });

  const activeForRunner = await app.dispatch({
    method: "GET",
    path: "/me/jobs/active",
    query: new URLSearchParams(),
    headers: runner.headers()
  });
  assert.equal(activeForRunner.resultType, "SUCCESS");
  if (activeForRunner.resultType === "SUCCESS") {
    assert.equal(activeForRunner.success.items.length, 1);
    assert.equal(activeForRunner.success.items[0]?.jobId, jobId);
    assert.equal(activeForRunner.success.items[0]?.isRunnerView, true);
  }
});

test("client can escalate client-confirm-pending jobs to disputed", async () => {
  const app = createTestApp();
  const client = await loginAs(app, "client-1");
  const runner = await loginAs(app, "runner-1");
  const { jobId } = await createPaidOfferingJob(app, client);

  const match = await app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/assign`,
    query: new URLSearchParams(),
    body: { runnerUserId: "runner-1" },
    headers: runner.headers({ "x-actor-role": "RUNNER" })
  });
  assert.equal(match.resultType, "SUCCESS");

  for (const nextStatus of ["RUNNER_EN_ROUTE", "RUNNER_ARRIVED", "PICKED_UP", "DELIVERING", "DELIVERY_PROOF_SUBMITTED"] as const) {
    const update = await app.dispatch({
      method: "POST",
      path: `/jobs/${jobId}/status`,
      query: new URLSearchParams(),
      body: { nextStatus },
      headers: runner.headers({ "x-actor-role": "RUNNER" })
    });
    assert.equal(update.resultType, "SUCCESS");
  }

  const toConfirmPending = await app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/status`,
    query: new URLSearchParams(),
    body: { nextStatus: "CLIENT_CONFIRM_PENDING" },
    headers: internalHeaders()
  });
  assert.equal(toConfirmPending.resultType, "SUCCESS");

  const disputed = await app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/status`,
    query: new URLSearchParams(),
    body: { nextStatus: "DISPUTED" },
    headers: client.headers()
  });
  assert.equal(disputed.resultType, "SUCCESS");
  if (disputed.resultType === "SUCCESS") {
    assert.equal(disputed.success.status, "DISPUTED");
  }
});

test("only participants can review and only the counterparty can be targeted", async () => {
  const app = createTestApp();
  const client = await loginAs(app, "client-1");
  const runner = await loginAs(app, "runner-1");
  const admin = await loginAs(app, "admin-1");
  const { jobId } = await createPaidOfferingJob(app, client);

  await app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/assign`,
    query: new URLSearchParams(),
    body: { runnerUserId: "runner-1" },
    headers: runner.headers({ "x-actor-role": "RUNNER" })
  });

  for (const nextStatus of ["RUNNER_EN_ROUTE", "RUNNER_ARRIVED", "PICKED_UP", "DELIVERING"] as const) {
    await app.dispatch({
      method: "POST",
      path: `/jobs/${jobId}/status`,
      query: new URLSearchParams(),
      body: { nextStatus },
      headers: runner.headers({ "x-actor-role": "RUNNER" })
    });
  }

  const deliveryProof = await uploadProofThroughApi(app, runner, {
    jobId,
    proofType: "delivery"
  });
  assert.equal(deliveryProof.resultType, "SUCCESS");

  await app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/status`,
    query: new URLSearchParams(),
    body: { nextStatus: "CLIENT_CONFIRM_PENDING" },
    headers: internalHeaders()
  });

  await app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/status`,
    query: new URLSearchParams(),
    body: { nextStatus: "COMPLETED" },
    headers: client.headers({ "x-actor-role": "CLIENT" })
  });

  const outsider = await app.dispatch({
    method: "POST",
    path: "/reviews",
    query: new URLSearchParams(),
    body: {
      jobId,
      targetUserId: "runner-1",
      ratingValue: 5,
      body: "외부인 리뷰"
    },
    headers: admin.headers()
  });
  assert.equal(outsider.resultType, "ERROR");
  if (outsider.resultType === "ERROR") {
    assert.equal(outsider.error.code, "REVIEW_NOT_AUTHORIZED");
  }

  const wrongTarget = await app.dispatch({
    method: "POST",
    path: "/reviews",
    query: new URLSearchParams(),
    body: {
      jobId,
      targetUserId: "admin-1",
      ratingValue: 5,
      body: "잘못된 대상"
    },
    headers: client.headers()
  });
  assert.equal(wrongTarget.resultType, "ERROR");
  if (wrongTarget.resultType === "ERROR") {
    assert.equal(wrongTarget.error.code, "REVIEW_TARGET_INVALID");
  }
});

test("nearby jobs do not expose pickup or dropoff addresses, and manual-review jobs stay hidden", async () => {
  const app = createTestApp();
  const client = await loginAs(app, "client-1");

  const walkJob = await createPaidOfferingJob(app, client);
  const nearby = await app.dispatch({
    method: "GET",
    path: "/jobs/nearby",
    query: new URLSearchParams(),
    headers: client.headers()
  });

  assert.equal(nearby.resultType, "SUCCESS");
  if (nearby.resultType === "SUCCESS") {
    const item = nearby.success.items.find((entry) => entry.jobId === walkJob.jobId);
    assert.ok(item);
    assert.equal("pickup" in item, false);
    assert.equal("dropoff" in item, false);
    assert.equal("clientUserId" in item, false);
  }

  await acknowledgeSafety(app, client);
  const reviewJobAuthSessionId = await completeTossAuth(app, client, "JOB_CREATE");
  const reviewJob = await app.dispatch({
    method: "POST",
    path: "/jobs",
    query: new URLSearchParams(),
    body: {
      title: "고액 관공서 전달",
      description: "관공서 근처로 급하게 전달 부탁",
      pickup: { address: "서울 A", lat: 37.5, lng: 127.0 },
      dropoff: { address: "서울 B", lat: 37.51, lng: 127.01 },
      transportRequirement: "vehicle",
      offerAmount: 180000,
      faceAuthSessionId: reviewJobAuthSessionId
    },
    headers: client.headers()
  });
  assert.equal(reviewJob.resultType, "SUCCESS");
  if (reviewJob.resultType === "ERROR") {
    return;
  }

  const payment = await app.dispatch({
    method: "POST",
    path: `/payments/jobs/${reviewJob.success.jobId}/init`,
    query: new URLSearchParams(),
    body: {},
    headers: client.headers()
  });
  assert.equal(payment.resultType, "SUCCESS");
  if (payment.resultType === "ERROR") {
    return;
  }

  const reviewPaymentAuthSessionId = await completeTossAuth(app, client, "PAYMENT_CONFIRM");
  await app.dispatch({
    method: "POST",
    path: `/payments/jobs/${reviewJob.success.jobId}/confirm`,
    query: new URLSearchParams(),
    body: {
      paymentOrderId: payment.success.paymentOrderId,
      faceAuthSessionId: reviewPaymentAuthSessionId
    },
    headers: client.headers()
  });

  const hidden = await app.dispatch({
    method: "GET",
    path: "/jobs/nearby",
    query: new URLSearchParams(),
    headers: client.headers()
  });

  assert.equal(hidden.resultType, "SUCCESS");
  if (hidden.resultType === "SUCCESS") {
    assert.equal(hidden.success.items.some((item) => item.jobId === reviewJob.success.jobId), false);
  }
});

test("login callback resets safety acknowledgement so the rules are shown every login", async () => {
  const store = createStore();
  const persistence = new NoopPersistenceAdapter();
  const enforcement = new EnforcementService(store, persistence);
  const auth = new AuthService(store, createMockTossAuthProvider(), loadApiRuntimeConfig(), enforcement, persistence);
  const started = await auth.startLogin();
  assert.equal(started.resultType, "SUCCESS");
  if (started.resultType === "ERROR") {
    throw new Error("login start failed");
  }

  const login = await auth.loginCallback({
    authorizationCode: "login-code-client-1",
    state: started.success.state
  });
  assert.equal(login.resultType, "SUCCESS");
  if (login.resultType === "SUCCESS") {
    assert.equal(login.success.needsSafetyAcknowledgement, true);
  }
});

test("toss unlink callback clears user link and refresh sessions", async () => {
  const app = createTestApp();
  const client = await loginAs(app, "client-1");

  const result = await app.dispatch({
    method: "POST",
    path: "/auth/toss/unlink",
    query: new URLSearchParams(),
    body: {
      userKey: "user-key-client-1",
      reason: "사용자 연결 끊기"
    },
    headers: new Headers({
      authorization: `Basic ${Buffer.from("unlink-placeholder-user:unlink-placeholder-password").toString("base64")}`
    })
  });

  assert.equal(result.resultType, "SUCCESS");
  if (result.resultType === "SUCCESS") {
    assert.equal(result.success.foundUser, true);
  }

  const me = await app.dispatch({
    method: "GET",
    path: "/me",
    query: new URLSearchParams(),
    headers: client.headers()
  });
  assert.equal(me.resultType, "ERROR");
  if (me.resultType === "ERROR") {
    assert.equal(me.error.code, "AUTH_REQUIRED");
  }
});

test("login callback rejects invalid state values", async () => {
  const app = createTestApp();

  const login = await app.dispatch({
    method: "POST",
    path: "/auth/toss/login/callback",
    query: new URLSearchParams(),
    body: { authorizationCode: "login-code-client-1", state: "WRONG_STATE" },
    headers: makeHeaders({})
  });

  assert.equal(login.resultType, "ERROR");
  if (login.resultType === "ERROR") {
    assert.equal(login.error.code, "TOSS_LOGIN_STATE_INVALID");
  }
});

test("login state is single-use and cannot be replayed", async () => {
  const app = createTestApp();
  const state = await startLoginFlow(app);

  const firstLogin = await app.dispatch({
    method: "POST",
    path: "/auth/toss/login/callback",
    query: new URLSearchParams(),
    body: { authorizationCode: "login-code-client-1", state },
    headers: makeHeaders({})
  });
  assert.equal(firstLogin.resultType, "SUCCESS");

  const replay = await app.dispatch({
    method: "POST",
    path: "/auth/toss/login/callback",
    query: new URLSearchParams(),
    body: { authorizationCode: "login-code-client-1", state },
    headers: makeHeaders({})
  });
  assert.equal(replay.resultType, "ERROR");
  if (replay.resultType === "ERROR") {
    assert.equal(replay.error.code, "TOSS_LOGIN_STATE_INVALID");
  }
});

test("admin routes require an admin token", async () => {
  const app = createTestApp();
  const client = await loginAs(app, "client-1");
  const admin = await loginAs(app, "admin-1");

  const forbidden = await app.dispatch({
    method: "GET",
    path: "/admin/review-queue",
    query: new URLSearchParams(),
    headers: client.headers()
  });
  assert.equal(forbidden.resultType, "ERROR");
  if (forbidden.resultType === "ERROR") {
    assert.equal(forbidden.error.code, "FORBIDDEN");
  }

  const allowed = await app.dispatch({
    method: "GET",
    path: "/admin/review-queue",
    query: new URLSearchParams(),
    headers: admin.headers()
  });
  assert.equal(allowed.resultType, "SUCCESS");
});

test("tampered access tokens are rejected", async () => {
  const app = createTestApp();
  const client = await loginAs(app, "client-1");
  const tamperedToken = `${client.accessToken}tampered`;

  const me = await app.dispatch({
    method: "GET",
    path: "/me",
    query: new URLSearchParams(),
    headers: makeHeaders({ authorization: `Bearer ${tamperedToken}` })
  });

  assert.equal(me.resultType, "ERROR");
  if (me.resultType === "ERROR") {
    assert.equal(me.error.code, "AUTH_REQUIRED");
  }
});

test("refresh token rotates and logout revokes the new refresh token", async () => {
  const app = createTestApp();
  const client = await loginAs(app, "client-1");

  const refreshed = await app.dispatch({
    method: "POST",
    path: "/auth/refresh",
    query: new URLSearchParams(),
    body: { refreshToken: "invalid-refresh-token" },
    headers: makeHeaders({})
  });
  assert.equal(refreshed.resultType, "ERROR");

  const login = await app.dispatch({
    method: "POST",
    path: "/auth/toss/login/callback",
    query: new URLSearchParams(),
    body: {
      authorizationCode: "login-code-client-1",
      state: await startLoginFlow(app)
    },
    headers: makeHeaders({})
  });
  assert.equal(login.resultType, "SUCCESS");
  if (login.resultType === "ERROR") {
    return;
  }

  const rotated = await app.dispatch({
    method: "POST",
    path: "/auth/refresh",
    query: new URLSearchParams(),
    body: { refreshToken: login.success.refreshToken },
    headers: makeHeaders({})
  });
  assert.equal(rotated.resultType, "SUCCESS");
  if (rotated.resultType === "ERROR") {
    return;
  }

  assert.notEqual(rotated.success.refreshToken, login.success.refreshToken);

  const logout = await app.dispatch({
    method: "POST",
    path: "/auth/logout",
    query: new URLSearchParams(),
    body: { refreshToken: rotated.success.refreshToken },
    headers: client.headers()
  });
  assert.equal(logout.resultType, "SUCCESS");

  const reuse = await app.dispatch({
    method: "POST",
    path: "/auth/refresh",
    query: new URLSearchParams(),
    body: { refreshToken: rotated.success.refreshToken },
    headers: makeHeaders({})
  });
  assert.equal(reuse.resultType, "ERROR");
  if (reuse.resultType === "ERROR") {
    assert.equal(reuse.error.code, "REFRESH_TOKEN_INVALID");
  }
});

test("non-participants cannot read job details or trigger emergencies", async () => {
  const app = createTestApp();
  const client = await loginAs(app, "client-1");
  const admin = await loginAs(app, "admin-1");
  const { jobId } = await createPaidOfferingJob(app, client);

  const jobDetail = await app.dispatch({
    method: "GET",
    path: `/jobs/${jobId}`,
    query: new URLSearchParams(),
    headers: admin.headers()
  });
  assert.equal(jobDetail.resultType, "SUCCESS");

  const emergency = await app.dispatch({
    method: "POST",
    path: "/emergency-events",
    query: new URLSearchParams(),
    body: { jobId, eventType: "SOS", lat: 37.5, lng: 127.0 },
    headers: admin.headers({ "idempotency-key": "admin-emergency" })
  });
  assert.equal(emergency.resultType, "ERROR");
  if (emergency.resultType === "ERROR") {
    assert.equal(emergency.error.code, "EMERGENCY_NOT_AUTHORIZED");
  }
});

test("report and emergency idempotency keys do not collide", async () => {
  const app = createTestApp();
  const client = await loginAs(app, "client-1");
  const runner = await loginAs(app, "runner-1");
  const { jobId } = await createPaidOfferingJob(app, client);

  await app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/assign`,
    query: new URLSearchParams(),
    body: { runnerUserId: "runner-1" },
    headers: runner.headers({ "x-actor-role": "RUNNER" })
  });

  const report = await app.dispatch({
    method: "POST",
    path: "/reports",
    query: new URLSearchParams(),
    body: { targetUserId: "runner-1", reportType: "FRAUD" },
    headers: client.headers({ "idempotency-key": "shared-key" })
  });
  const emergency = await app.dispatch({
    method: "POST",
    path: "/emergency-events",
    query: new URLSearchParams(),
    body: { jobId, eventType: "SOS", lat: 37.5, lng: 127.0 },
    headers: client.headers({ "idempotency-key": "shared-key" })
  });

  assert.equal(report.resultType, "SUCCESS");
  assert.equal(emergency.resultType, "SUCCESS");
  if (report.resultType === "SUCCESS" && emergency.resultType === "SUCCESS") {
    assert.ok("reportId" in report.success);
    assert.ok("emergencyEventId" in emergency.success);
  }
});

test("admin review and user status updates create audit logs", async () => {
  const app = createTestApp();
  const client = await loginAs(app, "client-1");
  const admin = await loginAs(app, "admin-1");

  await acknowledgeSafety(app, client);
  const reviewJobAuthSessionId = await completeTossAuth(app, client, "JOB_CREATE");
  const reviewJob = await app.dispatch({
    method: "POST",
    path: "/jobs",
    query: new URLSearchParams(),
    body: {
      title: "고액 관공서 전달",
      description: "관공서 근처로 급하게 전달 부탁",
      pickup: { address: "서울 A", lat: 37.5, lng: 127.0 },
      dropoff: { address: "서울 B", lat: 37.51, lng: 127.01 },
      transportRequirement: "vehicle",
      offerAmount: 180000,
      faceAuthSessionId: reviewJobAuthSessionId
    },
    headers: client.headers()
  });
  assert.equal(reviewJob.resultType, "SUCCESS");
  if (reviewJob.resultType === "ERROR") {
    return;
  }

  const payment = await app.dispatch({
    method: "POST",
    path: `/payments/jobs/${reviewJob.success.jobId}/init`,
    query: new URLSearchParams(),
    body: {},
    headers: client.headers()
  });
  assert.equal(payment.resultType, "SUCCESS");
  if (payment.resultType === "ERROR") {
    return;
  }

  const paymentAuthSessionId = await completeTossAuth(app, client, "PAYMENT_CONFIRM");
  await app.dispatch({
    method: "POST",
    path: `/payments/jobs/${reviewJob.success.jobId}/confirm`,
    query: new URLSearchParams(),
    body: {
      paymentOrderId: payment.success.paymentOrderId,
      faceAuthSessionId: paymentAuthSessionId
    },
    headers: client.headers()
  });

  const approve = await app.dispatch({
    method: "POST",
    path: `/admin/jobs/${reviewJob.success.jobId}/review`,
    query: new URLSearchParams(),
    body: { decision: "APPROVE", note: "수동 검수 승인" },
    headers: admin.headers()
  });
  assert.equal(approve.resultType, "SUCCESS");
  if (approve.resultType === "ERROR") {
    return;
  }

  const lock = await app.dispatch({
    method: "POST",
    path: "/admin/users/client-1/status",
    query: new URLSearchParams(),
    body: { status: "RESTRICTED", reason: "테스트 계정 제한" },
    headers: admin.headers()
  });
  assert.equal(lock.resultType, "SUCCESS");

  const audit = await app.dispatch({
    method: "GET",
    path: "/admin/audit-logs",
    query: new URLSearchParams(),
    headers: admin.headers()
  });
  assert.equal(audit.resultType, "SUCCESS");
  if (audit.resultType === "SUCCESS") {
    assert.equal(audit.success.items.some((item) => item.action === "JOB_REVIEW_APPROVED"), true);
    assert.equal(audit.success.items.some((item) => item.action === "USER_ENFORCEMENT_APPLIED"), true);
  }

  const lockedRequest = await app.dispatch({
    method: "GET",
    path: "/me",
    query: new URLSearchParams(),
    headers: client.headers()
  });
  assert.equal(lockedRequest.resultType, "SUCCESS");
  if (lockedRequest.resultType === "SUCCESS") {
    assert.equal(lockedRequest.success.status, "RESTRICTED");
    assert.equal(lockedRequest.success.restriction?.reasonCode, "ADMIN_RESTRICTED");
  }

  const blockedUsers = await app.dispatch({
    method: "GET",
    path: "/admin/users/blocked",
    query: new URLSearchParams(),
    headers: admin.headers()
  });
  assert.equal(blockedUsers.resultType, "SUCCESS");
  if (blockedUsers.resultType === "SUCCESS") {
    assert.equal(blockedUsers.success.items.some((item) => item.userId === "client-1" && item.restriction?.reasonCode === "ADMIN_RESTRICTED"), true);
  }
});

test("restricted users can submit an appeal and admins can approve reinstatement", async () => {
  const app = createTestApp();
  const client = await loginAs(app, "client-1");
  const admin = await loginAs(app, "admin-1");

  const restrict = await app.dispatch({
    method: "POST",
    path: "/admin/users/client-1/status",
    query: new URLSearchParams(),
    body: { status: "RESTRICTED", reason: "운영정책 검토 필요" },
    headers: admin.headers()
  });
  assert.equal(restrict.resultType, "SUCCESS");

  const enforcementStatus = await app.dispatch({
    method: "GET",
    path: "/me/enforcement-status",
    query: new URLSearchParams(),
    headers: client.headers()
  });
  assert.equal(enforcementStatus.resultType, "SUCCESS");
  if (enforcementStatus.resultType === "ERROR" || !enforcementStatus.success.latestAction) {
    return;
  }

  const appeal = await app.dispatch({
    method: "POST",
    path: "/appeals",
    query: new URLSearchParams(),
    body: {
      actionId: enforcementStatus.success.latestAction.actionId,
      appealText: "오탐지라서 이의제기를 제출합니다."
    },
    headers: client.headers()
  });
  assert.equal(appeal.resultType, "SUCCESS");
  if (appeal.resultType === "ERROR") {
    return;
  }

  const enforcementActions = await app.dispatch({
    method: "GET",
    path: "/me/enforcement-actions",
    query: new URLSearchParams(),
    headers: client.headers()
  });
  assert.equal(enforcementActions.resultType, "SUCCESS");
  if (enforcementActions.resultType === "SUCCESS") {
    assert.equal(enforcementActions.success.items.some((item) => item.actionId === appeal.success.actionId), true);
  }

  const requestMoreInfo = await app.dispatch({
    method: "POST",
    path: `/admin/appeals/${appeal.success.appealId}/request-more-info`,
    query: new URLSearchParams(),
    body: { note: "추가 설명을 남겨주세요." },
    headers: admin.headers()
  });
  assert.equal(requestMoreInfo.resultType, "SUCCESS");

  const approve = await app.dispatch({
    method: "POST",
    path: `/admin/appeals/${appeal.success.appealId}/approve`,
    query: new URLSearchParams(),
    body: { note: "오탐으로 확인되어 복구합니다." },
    headers: admin.headers()
  });
  assert.equal(approve.resultType, "SUCCESS");

  const appealDetail = await app.dispatch({
    method: "GET",
    path: `/appeals/${appeal.success.appealId}`,
    query: new URLSearchParams(),
    headers: client.headers()
  });
  assert.equal(appealDetail.resultType, "SUCCESS");
  if (appealDetail.resultType === "SUCCESS") {
    assert.equal(appealDetail.success.reviewActions.length, 2);
    assert.equal(appealDetail.success.reviewActions[0]?.decision, "REQUEST_MORE_INFO");
    assert.equal(appealDetail.success.reviewActions[1]?.decision, "APPROVE");
  }

  const me = await app.dispatch({
    method: "GET",
    path: "/me",
    query: new URLSearchParams(),
    headers: client.headers()
  });
  assert.equal(me.resultType, "SUCCESS");
  if (me.resultType === "SUCCESS") {
    assert.equal(me.success.status, "REINSTATED");
    assert.equal(me.success.restriction, undefined);
  }
});

test("admins can reinstate directly from an enforcement action without moving the user record", async () => {
  const app = createTestApp();
  const client = await loginAs(app, "client-1");
  const admin = await loginAs(app, "admin-1");

  const suspended = await app.dispatch({
    method: "POST",
    path: "/admin/users/client-1/status",
    query: new URLSearchParams(),
    body: { status: "SUSPENDED", reason: "운영 수동 정지" },
    headers: admin.headers()
  });
  assert.equal(suspended.resultType, "SUCCESS");
  if (suspended.resultType === "ERROR") {
    return;
  }

  const reinstated = await app.dispatch({
    method: "POST",
    path: `/admin/enforcement-actions/${suspended.success.actionId}/reinstate`,
    query: new URLSearchParams(),
    body: { note: "검토 완료" },
    headers: admin.headers()
  });
  assert.equal(reinstated.resultType, "SUCCESS");

  const me = await app.dispatch({
    method: "GET",
    path: "/me",
    query: new URLSearchParams(),
    headers: client.headers()
  });
  assert.equal(me.resultType, "SUCCESS");
  if (me.resultType === "SUCCESS") {
    assert.equal(me.success.status, "REINSTATED");
    assert.equal(me.success.restriction, undefined);
  }
});

test("withdrawal is blocked while active jobs remain", async () => {
  const app = createTestApp();
  const client = await loginAs(app, "client-1");
  await createPaidOfferingJob(app, client);

  const withdrawal = await app.dispatch({
    method: "POST",
    path: "/me/withdraw",
    query: new URLSearchParams(),
    body: { confirmed: true, reason: "서비스 중단" },
    headers: client.headers()
  });

  assert.equal(withdrawal.resultType, "ERROR");
  if (withdrawal.resultType === "ERROR") {
    assert.equal(withdrawal.error.code, "WITHDRAWAL_NOT_ALLOWED");
  }
});

test("withdrawn users are archived separately and cannot log in again", async () => {
  const app = createTestApp();
  const client = await loginAs(app, "client-1");
  const admin = await loginAs(app, "admin-1");

  const withdrawal = await app.dispatch({
    method: "POST",
    path: "/me/withdraw",
    query: new URLSearchParams(),
    body: { confirmed: true, reason: "사용자 탈퇴 요청" },
    headers: client.headers()
  });
  assert.equal(withdrawal.resultType, "SUCCESS");

  const withdrawnUsers = await app.dispatch({
    method: "GET",
    path: "/admin/users/withdrawn",
    query: new URLSearchParams(),
    headers: admin.headers()
  });
  assert.equal(withdrawnUsers.resultType, "SUCCESS");
  if (withdrawnUsers.resultType === "SUCCESS") {
    assert.equal(withdrawnUsers.success.items.some((item) => item.userId === "client-1"), true);
  }

  const state = await startLoginFlow(app);
  const relogin = await app.dispatch({
    method: "POST",
    path: "/auth/toss/login/callback",
    query: new URLSearchParams(),
    body: {
      authorizationCode: "login-code-client-1",
      state
    },
    headers: makeHeaders({})
  });
  assert.equal(relogin.resultType, "ERROR");
  if (relogin.resultType === "ERROR") {
    assert.equal(relogin.error.code, "ACCOUNT_WITHDRAWN");
  }
});

test("strict Toss env mode detects missing configuration", () => {
  const runtime = loadApiRuntimeConfig({
    BUTO_STRICT_TOSS_AUTH_ENV: "true"
  });
  assert.equal(runtime.strictTossAuthEnv, true);

  const envValidation = validateTossAuthEnv({});
  assert.equal(envValidation.ok, false);
  assert.equal(envValidation.missing.length > 0, true);
});

test("strict runtime env mode detects default secrets", () => {
  const runtime = loadApiRuntimeConfig({
    BUTO_STRICT_RUNTIME_ENV: "true"
  });
  assert.equal(runtime.strictRuntimeEnv, true);

  const validation = validateApiRuntimeConfig(runtime);
  assert.equal(validation.ok, false);
  assert.equal(validation.issues.includes("BUTO_AUTH_TOKEN_SECRET"), true);
  assert.equal(validation.issues.includes("BUTO_INTERNAL_SYSTEM_KEY"), true);
});

test("strict database env mode requires a database url", () => {
  const runtime = loadApiRuntimeConfig({
    BUTO_STRICT_DATABASE_ENV: "true"
  });
  assert.equal(runtime.strictDatabaseEnv, true);

  const validation = validateDatabaseEnv(runtime);
  assert.equal(validation.ok, false);
  assert.equal(validation.issues.includes("BUTO_DATABASE_URL"), true);
});
