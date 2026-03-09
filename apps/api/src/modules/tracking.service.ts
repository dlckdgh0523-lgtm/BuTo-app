import { fail, ok } from "../../../../packages/contracts/src/index.ts";

import type { InMemoryStore } from "../store.ts";
import { createId, nowIso } from "../utils.ts";

export class TrackingService {
  constructor(private readonly store: InMemoryStore) {}

  private resolveParticipantRole(jobId: string, userId: string) {
    const job = this.store.jobs.get(jobId);
    if (!job) {
      return fail("JOB_NOT_FOUND", "의뢰를 찾을 수 없어요.");
    }

    if (userId === job.clientUserId) {
      return ok({ job, role: "CLIENT" as const });
    }

    if (userId === job.matchedRunnerUserId) {
      return ok({ job, role: "RUNNER" as const });
    }

    return fail("TRACKING_NOT_AUTHORIZED", "거래 참여자만 위치 또는 증빙을 남길 수 있어요.");
  }

  logLocation(
    jobId: string,
    userId: string,
    payload: { lat: number; lng: number; accuracy: number; source: "app" | "background" | "manual" }
  ) {
    const participant = this.resolveParticipantRole(jobId, userId);
    if (participant.resultType === "ERROR") {
      return participant;
    }

    if (!Number.isFinite(payload.lat) || !Number.isFinite(payload.lng) || !Number.isFinite(payload.accuracy) || payload.accuracy <= 0) {
      return fail("LOCATION_LOG_INVALID", "유효한 위치 정확도와 좌표가 필요해요.");
    }

    if (!["MATCHED", "RUNNER_EN_ROUTE", "RUNNER_ARRIVED", "PICKED_UP", "DELIVERING", "DELIVERY_PROOF_SUBMITTED", "CLIENT_CONFIRM_PENDING"].includes(participant.success.job.status)) {
      return fail("LOCATION_LOG_NOT_ALLOWED", "진행 중 의뢰에서만 위치를 기록할 수 있어요.");
    }

    this.store.locationLogs.push({
      jobId,
      userId,
      role: participant.success.role,
      lat: payload.lat,
      lng: payload.lng,
      accuracy: payload.accuracy,
      source: payload.source,
      loggedAt: nowIso()
    });

    return ok({
      saved: true,
      count: this.store.locationLogs.filter((log) => log.jobId === jobId).length
    });
  }

  completeProof(jobId: string, userId: string, payload: { proofType: "pickup" | "delivery"; s3Key: string }) {
    const participant = this.resolveParticipantRole(jobId, userId);
    if (participant.resultType === "ERROR") {
      return participant;
    }
    const job = participant.success.job;

    if (participant.success.role !== "RUNNER") {
      return fail("PROOF_NOT_AUTHORIZED", "이 의뢰의 부르미만 증빙 사진을 등록할 수 있어요.");
    }

    if (!payload.s3Key.trim()) {
      return fail("PROOF_INVALID", "증빙 사진 키가 필요해요.");
    }

    if (payload.proofType === "pickup" && !["RUNNER_ARRIVED", "PICKED_UP"].includes(job.status)) {
      return fail("PROOF_NOT_ALLOWED", "픽업 증빙은 도착 후에만 등록할 수 있어요.");
    }

    if (payload.proofType === "delivery" && job.status !== "DELIVERING") {
      return fail("PROOF_NOT_ALLOWED", "배송 증빙은 배송 중 상태에서만 등록할 수 있어요.");
    }

    const proof = {
      proofId: createId("proof"),
      jobId,
      uploadedBy: userId,
      proofType: payload.proofType,
      s3Key: payload.s3Key,
      watermarkedUrl: `https://cdn.buto.local/${payload.s3Key}?wm=1`,
      createdAt: nowIso()
    };

    this.store.proofPhotos.push(proof);
    if (payload.proofType === "delivery" && job.status === "DELIVERING") {
      job.status = "DELIVERY_PROOF_SUBMITTED";
    }

    return ok({
      proofId: proof.proofId,
      watermarkedUrl: proof.watermarkedUrl,
      proofCount: this.store.proofPhotos.filter((photo) => photo.jobId === jobId).length,
      jobStatus: job.status
    });
  }
}
