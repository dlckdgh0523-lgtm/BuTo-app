import { fail, ok } from "../../../../packages/contracts/src/index.ts";

import type { InMemoryStore } from "../store.ts";
import { createId, nowIso } from "../utils.ts";

export class TrackingService {
  constructor(private readonly store: InMemoryStore) {}

  logLocation(
    jobId: string,
    userId: string,
    payload: { role: "CLIENT" | "RUNNER"; lat: number; lng: number; accuracy: number; source: "app" | "background" | "manual"; loggedAt?: string }
  ) {
    const job = this.store.jobs.get(jobId);
    if (!job) {
      return fail("JOB_NOT_FOUND", "의뢰를 찾을 수 없어요.");
    }

    this.store.locationLogs.push({
      jobId,
      userId,
      role: payload.role,
      lat: payload.lat,
      lng: payload.lng,
      accuracy: payload.accuracy,
      source: payload.source,
      loggedAt: payload.loggedAt ?? nowIso()
    });

    return ok({
      saved: true,
      count: this.store.locationLogs.filter((log) => log.jobId === jobId).length
    });
  }

  completeProof(jobId: string, userId: string, payload: { proofType: "pickup" | "delivery"; s3Key: string }) {
    const job = this.store.jobs.get(jobId);
    if (!job) {
      return fail("JOB_NOT_FOUND", "의뢰를 찾을 수 없어요.");
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

