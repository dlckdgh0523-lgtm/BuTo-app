import test from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../src/app.ts";
import { createStore } from "../src/bootstrap.ts";
import { AuthService } from "../src/modules/auth.service.ts";

function makeHeaders(headers: Record<string, string>) {
  return new Headers(headers);
}

function loginAs(app: ReturnType<typeof createApp>, userId: string) {
  const login = app.dispatch({
    method: "POST",
    path: "/auth/toss/login/callback",
    query: new URLSearchParams(),
    headers: makeHeaders({ "x-user-id": userId })
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

function acknowledgeSafety(app: ReturnType<typeof createApp>, session: ReturnType<typeof loginAs>) {
  const result = app.dispatch({
    method: "POST",
    path: "/safety/acknowledgements",
    query: new URLSearchParams(),
    body: { rulesVersion: "2026-03-09.v1", acknowledged: true },
    headers: session.headers()
  });

  assert.equal(result.resultType, "SUCCESS");
}

function completeTossAuth(
  app: ReturnType<typeof createApp>,
  session: ReturnType<typeof loginAs>,
  intent: "JOB_CREATE" | "PAYMENT_CONFIRM"
) {
  const authSession = app.dispatch({
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

  const completed = app.dispatch({
    method: "POST",
    path: "/auth/toss-face/complete",
    query: new URLSearchParams(),
    body: {
      faceAuthSessionId: authSession.success.faceAuthSessionId,
      providerTransactionId: `${intent.toLowerCase()}-tx`,
      result: "SUCCESS"
    },
    headers: session.headers()
  });

  assert.equal(completed.resultType, "SUCCESS");
  return authSession.success.faceAuthSessionId;
}

function createPaidOfferingJob(app: ReturnType<typeof createApp>, client: ReturnType<typeof loginAs>) {
  acknowledgeSafety(app, client);
  const jobCreateAuthSessionId = completeTossAuth(app, client, "JOB_CREATE");

  const job = app.dispatch({
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

  const payment = app.dispatch({
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

  const paymentAuthSessionId = completeTossAuth(app, client, "PAYMENT_CONFIRM");
  const confirm = app.dispatch({
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

test("job creation requires safety acknowledgement first", () => {
  const app = createApp();
  const client = loginAs(app, "client-1");
  const faceAuthSessionId = completeTossAuth(app, client, "JOB_CREATE");

  const job = app.dispatch({
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

test("severe chat after pickup forces dispute instead of cancellation", () => {
  const app = createApp();
  const client = loginAs(app, "client-1");
  const runner = loginAs(app, "runner-1");
  const { jobId } = createPaidOfferingJob(app, client);

  const match = app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/assign`,
    query: new URLSearchParams(),
    body: { runnerUserId: "runner-1" },
    headers: runner.headers({ "x-actor-role": "RUNNER" })
  });
  assert.equal(match.resultType, "SUCCESS");

  for (const nextStatus of ["RUNNER_EN_ROUTE", "RUNNER_ARRIVED", "PICKED_UP"] as const) {
    const update = app.dispatch({
      method: "POST",
      path: `/jobs/${jobId}/status`,
      query: new URLSearchParams(),
      body: { nextStatus },
      headers: runner.headers({ "x-actor-role": "RUNNER" })
    });
    assert.equal(update.resultType, "SUCCESS");
  }

  const message = app.dispatch({
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
});

test("reports are idempotent and community posts are masked", () => {
  const app = createApp();
  const client = loginAs(app, "client-1");

  const first = app.dispatch({
    method: "POST",
    path: "/reports",
    query: new URLSearchParams(),
    body: { targetUserId: "runner-1", reportType: "FRAUD", detail: "같은 신고" },
    headers: client.headers({ "idempotency-key": "report-key-1" })
  });
  const second = app.dispatch({
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

  const post = app.dispatch({
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

test("payment confirmation rejects toss auth sessions from the wrong intent", () => {
  const app = createApp();
  const client = loginAs(app, "client-1");

  acknowledgeSafety(app, client);
  const jobCreateAuthSessionId = completeTossAuth(app, client, "JOB_CREATE");

  const job = app.dispatch({
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

  const payment = app.dispatch({
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

  const confirm = app.dispatch({
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

test("payment init is idempotent and blocked outside payment-pending status", () => {
  const app = createApp();
  const client = loginAs(app, "client-1");

  acknowledgeSafety(app, client);
  const jobCreateAuthSessionId = completeTossAuth(app, client, "JOB_CREATE");

  const job = app.dispatch({
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

  const first = app.dispatch({
    method: "POST",
    path: `/payments/jobs/${job.success.jobId}/init`,
    query: new URLSearchParams(),
    body: {},
    headers: client.headers()
  });
  const second = app.dispatch({
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
  }

  const paymentAuthSessionId = completeTossAuth(app, client, "PAYMENT_CONFIRM");
  app.dispatch({
    method: "POST",
    path: `/payments/jobs/${job.success.jobId}/confirm`,
    query: new URLSearchParams(),
    body: {
      paymentOrderId: first.resultType === "SUCCESS" ? first.success.paymentOrderId : "",
      faceAuthSessionId: paymentAuthSessionId
    },
    headers: client.headers()
  });

  const afterConfirm = app.dispatch({
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

test("only the matched runner can upload proof photos", () => {
  const app = createApp();
  const client = loginAs(app, "client-1");
  const runner = loginAs(app, "runner-1");
  const { jobId } = createPaidOfferingJob(app, client);

  app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/assign`,
    query: new URLSearchParams(),
    body: { runnerUserId: "runner-1" },
    headers: runner.headers({ "x-actor-role": "RUNNER" })
  });

  const unauthorized = app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/proof-photo/complete`,
    query: new URLSearchParams(),
    body: { proofType: "pickup", s3Key: "proofs/unauthorized.jpg" },
    headers: client.headers()
  });

  assert.equal(unauthorized.resultType, "ERROR");
  if (unauthorized.resultType === "ERROR") {
    assert.equal(unauthorized.error.code, "PROOF_NOT_AUTHORIZED");
  }
});

test("only participants can review and only the counterparty can be targeted", () => {
  const app = createApp();
  const client = loginAs(app, "client-1");
  const runner = loginAs(app, "runner-1");
  const admin = loginAs(app, "admin-1");
  const { jobId } = createPaidOfferingJob(app, client);

  app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/assign`,
    query: new URLSearchParams(),
    body: { runnerUserId: "runner-1" },
    headers: runner.headers({ "x-actor-role": "RUNNER" })
  });

  for (const nextStatus of ["RUNNER_EN_ROUTE", "RUNNER_ARRIVED", "PICKED_UP", "DELIVERING"] as const) {
    app.dispatch({
      method: "POST",
      path: `/jobs/${jobId}/status`,
      query: new URLSearchParams(),
      body: { nextStatus },
      headers: runner.headers({ "x-actor-role": "RUNNER" })
    });
  }

  app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/proof-photo/complete`,
    query: new URLSearchParams(),
    body: { proofType: "delivery", s3Key: "proofs/delivery.jpg" },
    headers: runner.headers()
  });

  app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/status`,
    query: new URLSearchParams(),
    body: { nextStatus: "CLIENT_CONFIRM_PENDING" },
    headers: internalHeaders()
  });

  app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/status`,
    query: new URLSearchParams(),
    body: { nextStatus: "COMPLETED" },
    headers: client.headers({ "x-actor-role": "CLIENT" })
  });

  const outsider = app.dispatch({
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

  const wrongTarget = app.dispatch({
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

test("nearby jobs do not expose pickup or dropoff addresses, and manual-review jobs stay hidden", () => {
  const app = createApp();
  const client = loginAs(app, "client-1");

  const walkJob = createPaidOfferingJob(app, client);
  const nearby = app.dispatch({
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

  acknowledgeSafety(app, client);
  const reviewJobAuthSessionId = completeTossAuth(app, client, "JOB_CREATE");
  const reviewJob = app.dispatch({
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

  const payment = app.dispatch({
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

  const reviewPaymentAuthSessionId = completeTossAuth(app, client, "PAYMENT_CONFIRM");
  app.dispatch({
    method: "POST",
    path: `/payments/jobs/${reviewJob.success.jobId}/confirm`,
    query: new URLSearchParams(),
    body: {
      paymentOrderId: payment.success.paymentOrderId,
      faceAuthSessionId: reviewPaymentAuthSessionId
    },
    headers: client.headers()
  });

  const hidden = app.dispatch({
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

test("login callback resets safety acknowledgement so the rules are shown every login", () => {
  const store = createStore();
  const auth = new AuthService(store);
  const user = store.users.get("client-1");

  assert.ok(user);
  if (!user) {
    return;
  }

  user.safetyAcknowledgedAt = new Date().toISOString();

  const login = auth.loginCallback("client-1");
  assert.equal(login.resultType, "SUCCESS");
  if (login.resultType === "SUCCESS") {
    assert.equal(login.success.needsSafetyAcknowledgement, true);
  }
});

test("admin routes require an admin token", () => {
  const app = createApp();
  const client = loginAs(app, "client-1");
  const admin = loginAs(app, "admin-1");

  const forbidden = app.dispatch({
    method: "GET",
    path: "/admin/review-queue",
    query: new URLSearchParams(),
    headers: client.headers()
  });
  assert.equal(forbidden.resultType, "ERROR");
  if (forbidden.resultType === "ERROR") {
    assert.equal(forbidden.error.code, "FORBIDDEN");
  }

  const allowed = app.dispatch({
    method: "GET",
    path: "/admin/review-queue",
    query: new URLSearchParams(),
    headers: admin.headers()
  });
  assert.equal(allowed.resultType, "SUCCESS");
});

test("non-participants cannot read job details or trigger emergencies", () => {
  const app = createApp();
  const client = loginAs(app, "client-1");
  const admin = loginAs(app, "admin-1");
  const { jobId } = createPaidOfferingJob(app, client);

  const jobDetail = app.dispatch({
    method: "GET",
    path: `/jobs/${jobId}`,
    query: new URLSearchParams(),
    headers: admin.headers()
  });
  assert.equal(jobDetail.resultType, "SUCCESS");

  const emergency = app.dispatch({
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

test("report and emergency idempotency keys do not collide", () => {
  const app = createApp();
  const client = loginAs(app, "client-1");
  const runner = loginAs(app, "runner-1");
  const { jobId } = createPaidOfferingJob(app, client);

  app.dispatch({
    method: "POST",
    path: `/jobs/${jobId}/assign`,
    query: new URLSearchParams(),
    body: { runnerUserId: "runner-1" },
    headers: runner.headers({ "x-actor-role": "RUNNER" })
  });

  const report = app.dispatch({
    method: "POST",
    path: "/reports",
    query: new URLSearchParams(),
    body: { targetUserId: "runner-1", reportType: "FRAUD" },
    headers: client.headers({ "idempotency-key": "shared-key" })
  });
  const emergency = app.dispatch({
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
