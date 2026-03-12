import { fail, ok } from "../../../../packages/contracts/src/index.ts";

import type { InMemoryStore } from "../store.ts";
import type { PersistenceAdapter } from "../persistence.ts";
import { createId, nowIso } from "../utils.ts";

export class ReportsService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly persistence: PersistenceAdapter
  ) {}

  private makeIdempotencyKey(scope: "report" | "emergency", rawKey: string) {
    return `${scope}:${rawKey}`;
  }

  async createReport(idempotencyKey: string | undefined, reporterUserId: string, payload: { jobId?: string; targetUserId: string; reportType: string; detail?: string }) {
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
    const jobSnapshot = payload.jobId ? this.store.jobs.get(payload.jobId) ? structuredClone(this.store.jobs.get(payload.jobId)!) : undefined : undefined;

    this.store.reports.set(report.reportId, report);
    this.store.idempotency.set(scopedKey, report);

    try {
      await this.persistence.withTransaction(async (tx) => {
        if (payload.jobId) {
          const job = this.store.jobs.get(payload.jobId);
          if (job) {
            job.hasReport = true;
            await tx.upsertJob(job);
          }
        }

        await tx.upsertReport(report);
        await tx.upsertIdempotency(scopedKey, report);
        await tx.enqueueOutboxEvent({
          eventId: createId("evt"),
          aggregateType: "REPORT",
          aggregateId: report.reportId,
          eventType: "REPORT_CREATED",
          payload: {
            reportId: report.reportId,
            targetUserId: report.targetUserId,
            jobId: report.jobId ?? null
          },
          availableAt: nowIso()
        });
      });

      return ok(report);
    } catch (error) {
      this.store.reports.delete(report.reportId);
      this.store.idempotency.delete(scopedKey);
      if (payload.jobId && jobSnapshot) {
        this.store.jobs.set(payload.jobId, jobSnapshot);
      }
      throw error;
    }
  }

  async createEmergency(idempotencyKey: string | undefined, reporterUserId: string, payload: { jobId: string; eventType: string; lat: number; lng: number }) {
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

    const jobSnapshot = structuredClone(job);

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

    try {
      await this.persistence.withTransaction(async (tx) => {
        job.hasDispute = true;
        job.status = "DISPUTED";
        await tx.upsertJob(job);
        await tx.upsertEmergency(emergency);
        await tx.upsertIdempotency(scopedKey, emergency);
        await tx.enqueueOutboxEvent({
          eventId: createId("evt"),
          aggregateType: "EMERGENCY",
          aggregateId: emergency.emergencyEventId,
          eventType: "EMERGENCY_CREATED",
          payload: {
            emergencyEventId: emergency.emergencyEventId,
            jobId: emergency.jobId
          },
          availableAt: nowIso()
        });
      });

      return ok({
        emergencyEventId: emergency.emergencyEventId,
        jobStatus: job.status,
        accountLockPending: true
      });
    } catch (error) {
      this.store.jobs.set(job.jobId, jobSnapshot);
      this.store.emergencies.delete(emergency.emergencyEventId);
      this.store.idempotency.delete(scopedKey);
      throw error;
    }
  }
}
