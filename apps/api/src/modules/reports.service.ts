import { fail, ok } from "../../../../packages/contracts/src/index.ts";

import type { InMemoryStore } from "../store.ts";
import { createId, nowIso } from "../utils.ts";

export class ReportsService {
  constructor(private readonly store: InMemoryStore) {}

  createReport(idempotencyKey: string | undefined, payload: { jobId?: string; targetUserId: string; reportType: string; detail?: string }) {
    if (!idempotencyKey) {
      return fail("IDEMPOTENCY_REQUIRED", "멱등성 키가 필요해요.");
    }

    const cached = this.store.idempotency.get(idempotencyKey);
    if (cached) {
      return ok(cached);
    }

    const report = {
      reportId: createId("report"),
      jobId: payload.jobId,
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
    this.store.idempotency.set(idempotencyKey, report);
    return ok(report);
  }

  createEmergency(idempotencyKey: string | undefined, payload: { jobId: string; eventType: string; lat: number; lng: number }) {
    if (!idempotencyKey) {
      return fail("IDEMPOTENCY_REQUIRED", "멱등성 키가 필요해요.");
    }

    const cached = this.store.idempotency.get(idempotencyKey);
    if (cached) {
      return ok(cached);
    }

    const job = this.store.jobs.get(payload.jobId);
    if (job) {
      job.hasDispute = true;
      job.status = "DISPUTED";
    }

    const emergency = {
      emergencyEventId: createId("emergency"),
      jobId: payload.jobId,
      eventType: payload.eventType as never,
      lat: payload.lat,
      lng: payload.lng,
      createdAt: nowIso()
    };

    this.store.emergencies.set(emergency.emergencyEventId, emergency);
    this.store.idempotency.set(idempotencyKey, emergency);
    return ok({
      emergencyEventId: emergency.emergencyEventId,
      jobStatus: job?.status ?? "DISPUTED",
      accountLockApplied: true
    });
  }
}

