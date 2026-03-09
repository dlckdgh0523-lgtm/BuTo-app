import test from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../src/app.ts";

function makeHeaders(headers: Record<string, string>) {
  return new Headers(headers);
}

test("job creation requires safety acknowledgement first", () => {
  const app = createApp();
  const session = app.dispatch({
    method: "POST",
    path: "/auth/toss-face/session",
    query: new URLSearchParams(),
    body: { intent: "JOB_CREATE" },
    headers: makeHeaders({ "x-user-id": "client-1" })
  });

  assert.equal(session.resultType, "SUCCESS");
  if (session.resultType === "SUCCESS") {
    app.dispatch({
      method: "POST",
      path: "/auth/toss-face/complete",
      query: new URLSearchParams(),
      body: {
        faceAuthSessionId: session.success.faceAuthSessionId,
        providerTransactionId: "tx-precheck",
        result: "SUCCESS"
      },
      headers: makeHeaders({ "x-user-id": "client-1" })
    });
  }

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
      faceAuthSessionId: session.resultType === "SUCCESS" ? session.success.faceAuthSessionId : ""
    },
    headers: makeHeaders({ "x-user-id": "client-1" })
  });

  assert.equal(job.resultType, "ERROR");
  if (job.resultType === "ERROR") {
    assert.equal(job.error.code, "SAFETY_ACK_REQUIRED");
  }
});

test("severe chat after pickup forces dispute instead of cancellation", () => {
  const app = createApp();

  app.dispatch({
    method: "POST",
    path: "/safety/acknowledgements",
    query: new URLSearchParams(),
    body: { rulesVersion: "2026-03-09.v1", acknowledged: true },
    headers: makeHeaders({ "x-user-id": "client-1" })
  });

  const session = app.dispatch({
    method: "POST",
    path: "/auth/toss-face/session",
    query: new URLSearchParams(),
    body: { intent: "JOB_CREATE" },
    headers: makeHeaders({ "x-user-id": "client-1" })
  });

  assert.equal(session.resultType, "SUCCESS");
  if (session.resultType === "SUCCESS") {
    app.dispatch({
      method: "POST",
      path: "/auth/toss-face/complete",
      query: new URLSearchParams(),
      body: {
        faceAuthSessionId: session.success.faceAuthSessionId,
        providerTransactionId: "tx-live",
        result: "SUCCESS"
      },
      headers: makeHeaders({ "x-user-id": "client-1" })
    });
  }

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
      faceAuthSessionId: session.resultType === "SUCCESS" ? session.success.faceAuthSessionId : ""
    },
    headers: makeHeaders({ "x-user-id": "client-1" })
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
    headers: makeHeaders({ "x-user-id": "client-1" })
  });
  assert.equal(payment.resultType, "SUCCESS");
  if (payment.resultType === "ERROR") {
    return;
  }

  app.dispatch({
    method: "POST",
    path: `/payments/jobs/${job.success.jobId}/confirm`,
    query: new URLSearchParams(),
    body: {
      paymentOrderId: payment.success.paymentOrderId,
      faceAuthSessionId: session.success.faceAuthSessionId
    },
    headers: makeHeaders({ "x-user-id": "client-1" })
  });

  app.dispatch({
    method: "POST",
    path: `/jobs/${job.success.jobId}/assign`,
    query: new URLSearchParams(),
    body: { runnerUserId: "runner-1" },
    headers: makeHeaders({ "x-user-id": "client-1" })
  });

  app.dispatch({
    method: "POST",
    path: `/jobs/${job.success.jobId}/status`,
    query: new URLSearchParams(),
    body: { nextStatus: "RUNNER_EN_ROUTE" },
    headers: makeHeaders({ "x-actor-role": "RUNNER" })
  });
  app.dispatch({
    method: "POST",
    path: `/jobs/${job.success.jobId}/status`,
    query: new URLSearchParams(),
    body: { nextStatus: "RUNNER_ARRIVED" },
    headers: makeHeaders({ "x-actor-role": "RUNNER" })
  });
  app.dispatch({
    method: "POST",
    path: `/jobs/${job.success.jobId}/status`,
    query: new URLSearchParams(),
    body: { nextStatus: "PICKED_UP" },
    headers: makeHeaders({ "x-actor-role": "RUNNER" })
  });

  const message = app.dispatch({
    method: "POST",
    path: `/jobs/${job.success.jobId}/chat/messages`,
    query: new URLSearchParams(),
    body: { body: "현금이랑 otp도 같이 보내주세요" },
    headers: makeHeaders({ "x-user-id": "runner-1" })
  });

  assert.equal(message.resultType, "SUCCESS");
  if (message.resultType === "SUCCESS") {
    assert.equal(message.success.moderationStatus, "SEVERE_BLOCK");
    assert.equal(message.success.jobStatus, "DISPUTED");
  }
});

test("reports are idempotent and community posts are masked", () => {
  const app = createApp();

  const first = app.dispatch({
    method: "POST",
    path: "/reports",
    query: new URLSearchParams(),
    body: { targetUserId: "runner-1", reportType: "FRAUD", detail: "같은 신고" },
    headers: makeHeaders({ "idempotency-key": "report-key-1" })
  });
  const second = app.dispatch({
    method: "POST",
    path: "/reports",
    query: new URLSearchParams(),
    body: { targetUserId: "runner-1", reportType: "FRAUD", detail: "같은 신고" },
    headers: makeHeaders({ "idempotency-key": "report-key-1" })
  });

  assert.equal(first.resultType, "SUCCESS");
  assert.equal(second.resultType, "SUCCESS");
  if (first.resultType === "SUCCESS" && second.resultType === "SUCCESS") {
    assert.equal(first.success.reportId, second.success.reportId);
  }

  const post = app.dispatch({
    method: "POST",
    path: "/community/posts",
    query: new URLSearchParams(),
    body: {
      title: "010-1234-5678 연락 주세요",
      body: "공동현관 비밀번호와 123-45-67890 계좌를 남겨요."
    },
    headers: makeHeaders({ "x-user-id": "client-1" })
  });

  assert.equal(post.resultType, "SUCCESS");
  if (post.resultType === "SUCCESS") {
    assert.match(post.success.title, /\[masked-phone\]/);
    assert.match(post.success.body, /\[masked-location-detail\]/);
    assert.match(post.success.body, /\[masked-account\]/);
  }
});
