import { fail, ok } from "../../../../packages/contracts/src/index.ts";

import type { InMemoryStore } from "../store.ts";
import { createId, nowIso } from "../utils.ts";

export class ReportsService {
  constructor(private readonly store: InMemoryStore) {}

  private makeIdempotencyKey(scope: "report" | "emergency", rawKey: string) {
    return `${scope}:${rawKey}`;
  }

  createReport(idempotencyKey: string | undefined, reporterUserId: string, payload: { jobId?: string; targetUserId: string; reportType: string; detail?: string }) {
    if (!idempotencyKey) {
      return fail("IDEMPOTENCY_REQUIRED", "멱등성 키가 필요해요.");
    }

    const scopedKey = this.makeIdempotencyKey("report", idempotencyKey);
    const cached = this.store.idempotency.get(scopedKey);
    if (cached) {
      return ok(cached);
    }

    const report = {
      reportId: createId("report"),
      jobId: payload.jobId,
      reporterUserId,
      targetUserId: payload.targetUserId,
      reportType: payload.reportType as never,
      detail: payload.detail,
      createdAt: nowIso()
    };

    if (payload.jobId) {
      const job = this.store.jobs.get(payload.jobId);
      if (job) {
        job.hasReport = true;
      }
    }

    this.store.reports.set(report.reportId, report);
    this.store.idempotency.set(scopedKey, report);
    return ok(report);
  }

  createEmergency(idempotencyKey: string | undefined, reporterUserId: string, payload: { jobId: string; eventType: string; lat: number; lng: number }) {
    if (!idempotencyKey) {
      return fail("IDEMPOTENCY_REQUIRED", "멱등성 키가 필요해요.");
    }

    const scopedKey = this.makeIdempotencyKey("emergency", idempotencyKey);
    const cached = this.store.idempotency.get(scopedKey);
    if (cached) {
      return ok(cached);
    }

    const job = this.store.jobs.get(payload.jobId);
    if (!job) {
      return fail("JOB_NOT_FOUND", "의뢰를 찾을 수 없어요.");
    }

    const isParticipant = reporterUserId === job.clientUserId || reporterUserId === job.matchedRunnerUserId;
    if (!isParticipant) {
      return fail("EMERGENCY_NOT_AUTHORIZED", "거래 참여자만 긴급 이벤트를 생성할 수 있어요.");
    }

    job.hasDispute = true;
    job.status = "DISPUTED";

    const emergency = {
      emergencyEventId: createId("emergency"),
      jobId: payload.jobId,
      eventType: payload.eventType as never,
      lat: payload.lat,
      lng: payload.lng,
      createdAt: nowIso()
    };

    this.store.emergencies.set(emergency.emergencyEventId, emergency);
    this.store.idempotency.set(scopedKey, emergency);
    return ok({
      emergencyEventId: emergency.emergencyEventId,
      jobStatus: job.status,
      accountLockPending: true
    });
  }
}
