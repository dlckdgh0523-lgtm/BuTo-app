import { fail, ok } from "../../../../packages/contracts/src/index.ts";

import type { PersistenceAdapter } from "../persistence.ts";
import type { InMemoryStore, ProofUploadSession } from "../store.ts";
import { createId, nowIso } from "../utils.ts";
import type { ProofAssetStorageProvider } from "./proof-asset-storage.ts";

const ACTIVE_TRACKING_JOB_STATUSES = ["MATCHED", "RUNNER_EN_ROUTE", "RUNNER_ARRIVED", "PICKED_UP", "DELIVERING", "DELIVERY_PROOF_SUBMITTED", "CLIENT_CONFIRM_PENDING"] as const;
const SUPPORTED_IMAGE_MIME_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/heic", "heic"],
  ["image/heif", "heif"]
]);
const PROOF_UPLOAD_TTL_MS = 10 * 60 * 1000;
const PROOF_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

type ProofSource = "camera" | "album";

export class TrackingService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly persistence: PersistenceAdapter,
    private readonly proofAssetStorage: ProofAssetStorageProvider
  ) {}

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

  private validateProofWindow(jobStatus: string, proofType: "pickup" | "delivery") {
    if (proofType === "pickup" && !["RUNNER_ARRIVED", "PICKED_UP"].includes(jobStatus)) {
      return fail("PROOF_NOT_ALLOWED", "픽업 증빙은 도착 후에만 등록할 수 있어요.");
    }

    if (proofType === "delivery" && jobStatus !== "DELIVERING") {
      return fail("PROOF_NOT_ALLOWED", "배송 증빙은 배송 중 상태에서만 등록할 수 있어요.");
    }

    return ok({ allowed: true as const });
  }

  async logLocation(
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

    if (!ACTIVE_TRACKING_JOB_STATUSES.includes(participant.success.job.status)) {
      return fail("LOCATION_LOG_NOT_ALLOWED", "진행 중 의뢰에서만 위치를 기록할 수 있어요.");
    }

    const logEntry = {
      jobId,
      userId,
      role: participant.success.role,
      lat: payload.lat,
      lng: payload.lng,
      accuracy: payload.accuracy,
      source: payload.source,
      loggedAt: nowIso()
    };

    this.store.locationLogs.push(logEntry);
    try {
      await this.persistence.withTransaction(async (tx) => {
        await tx.appendLocationLog(logEntry);
      });
    } catch (error) {
      this.store.locationLogs.pop();
      throw error;
    }

    return ok({
      saved: true,
      count: this.store.locationLogs.filter((log) => log.jobId === jobId).length,
      loggedAt: logEntry.loggedAt
    });
  }

  async createProofUploadSession(
    jobId: string,
    userId: string,
    payload: { proofType: "pickup" | "delivery"; source: ProofSource; mimeType: string }
  ) {
    const participant = this.resolveParticipantRole(jobId, userId);
    if (participant.resultType === "ERROR") {
      return participant;
    }

    if (participant.success.role !== "RUNNER") {
      return fail("PROOF_NOT_AUTHORIZED", "이 의뢰의 부르미만 증빙 사진을 등록할 수 있어요.");
    }

    const proofWindow = this.validateProofWindow(participant.success.job.status, payload.proofType);
    if (proofWindow.resultType === "ERROR") {
      return proofWindow;
    }

    const createdAt = nowIso();
    const uploadSessionId = createId("proof-upload");
    const objectKey = this.proofAssetStorage.createObjectKey({
      jobId,
      proofType: payload.proofType,
      uploadSessionId,
      mimeType: payload.mimeType
    });
    if (!objectKey) {
      return fail("PROOF_UPLOAD_INVALID", "지원하지 않는 이미지 형식이에요.");
    }
    const session: ProofUploadSession = {
      uploadSessionId,
      jobId,
      userId,
      proofType: payload.proofType,
      source: payload.source,
      objectKey,
      status: "READY",
      createdAt,
      expiresAt: new Date(Date.now() + PROOF_UPLOAD_TTL_MS).toISOString()
    };

    this.store.proofUploadSessions.set(uploadSessionId, session);
    try {
      await this.persistence.withTransaction(async (tx) => {
        await tx.upsertProofUploadSession(session);
      });
    } catch (error) {
      this.store.proofUploadSessions.delete(uploadSessionId);
      throw error;
    }

    return ok({
      uploadSessionId,
      expiresAt: session.expiresAt,
      maxBytes: PROOF_UPLOAD_MAX_BYTES,
      acceptedMimeTypes: [...SUPPORTED_IMAGE_MIME_TYPES.keys()],
      ...this.proofAssetStorage.createSignedUploadDescriptor({
        uploadSessionId,
        expiresAt: session.expiresAt,
        objectKey: session.objectKey,
        mimeType: payload.mimeType
      })
    });
  }

  async uploadProofAssetViaSignedUrl(
    uploadSessionId: string,
    payload: {
      expiresAt: string;
      signature: string;
      dataUri: string;
      imageId?: string;
      mimeTypeHint?: string;
    }
  ) {
    const session = this.store.proofUploadSessions.get(uploadSessionId);
    if (!session) {
      return fail("PROOF_UPLOAD_SESSION_NOT_FOUND", "유효한 증빙 업로드 세션이 없어요.");
    }

    if (payload.expiresAt !== session.expiresAt) {
      return fail("PROOF_UPLOAD_SIGNATURE_INVALID", "업로드 서명이 유효하지 않아요.");
    }

    if (!this.proofAssetStorage.verifySignedUpload(uploadSessionId, payload.expiresAt, payload.signature)) {
      return fail("PROOF_UPLOAD_SIGNATURE_INVALID", "업로드 서명이 유효하지 않아요.");
    }

    if (!this.proofAssetStorage.supportsServerUploadRoute) {
      return fail("PROOF_UPLOAD_NOT_ALLOWED", "이 업로드 방식은 서버 직접 업로드를 사용하지 않아요.");
    }

    return this.persistUploadPayload(session.jobId, session.userId, {
      uploadSessionId,
      dataUri: payload.dataUri,
      imageId: payload.imageId,
      mimeTypeHint: payload.mimeTypeHint
    });
  }

  private async persistUploadPayload(
    jobId: string,
    userId: string,
    payload: { uploadSessionId: string; dataUri: string; imageId?: string; mimeTypeHint?: string }
  ) {
    const session = this.store.proofUploadSessions.get(payload.uploadSessionId);
    if (!session || session.jobId !== jobId || session.userId !== userId) {
      return fail("PROOF_UPLOAD_SESSION_NOT_FOUND", "유효한 증빙 업로드 세션이 없어요.");
    }

    if (Date.parse(session.expiresAt) <= Date.now()) {
      session.status = "EXPIRED";
      await this.persistence.withTransaction(async (tx) => {
        await tx.upsertProofUploadSession(session);
      });
      return fail("PROOF_UPLOAD_SESSION_EXPIRED", "증빙 업로드 시간이 만료되었어요. 다시 시도해 주세요.");
    }

    if (session.status !== "READY") {
      return fail("PROOF_UPLOAD_NOT_ALLOWED", "이미 처리된 증빙 업로드 세션이에요.");
    }

    const parsed = this.parseImagePayload(payload.dataUri, payload.mimeTypeHint);
    if (parsed.resultType === "ERROR") {
      return parsed;
    }

    const extension = SUPPORTED_IMAGE_MIME_TYPES.get(parsed.success.mimeType);
    if (!extension) {
      return fail("PROOF_UPLOAD_INVALID", "지원하지 않는 이미지 형식이에요.");
    }

    if (!session.objectKey.endsWith(`.${extension}`)) {
      return fail("PROOF_UPLOAD_INVALID", "업로드 세션과 이미지 형식이 일치하지 않아요.");
    }

    const storedAsset = await this.proofAssetStorage.saveUploadedAsset({
      objectKey: session.objectKey,
      buffer: parsed.success.buffer
    });

    const uploadedAt = nowIso();
    const updatedSession: ProofUploadSession = {
      ...session,
      objectKey: storedAsset.objectKey,
      status: "UPLOADED",
      localAssetPath: storedAsset.localAssetPath,
      mimeType: parsed.success.mimeType,
      imageId: payload.imageId,
      uploadedAt
    };
    this.store.proofUploadSessions.set(updatedSession.uploadSessionId, updatedSession);

    try {
      await this.persistence.withTransaction(async (tx) => {
        await tx.upsertProofUploadSession(updatedSession);
      });
    } catch (error) {
      this.store.proofUploadSessions.set(session.uploadSessionId, session);
      throw error;
    }

    return ok({
      uploadSessionId: updatedSession.uploadSessionId,
      objectKey: updatedSession.objectKey,
      uploadedAt
    });
  }

  async completeProof(jobId: string, userId: string, payload: { proofType: "pickup" | "delivery"; uploadSessionId: string }) {
    const participant = this.resolveParticipantRole(jobId, userId);
    if (participant.resultType === "ERROR") {
      return participant;
    }
    const job = participant.success.job;

    if (participant.success.role !== "RUNNER") {
      return fail("PROOF_NOT_AUTHORIZED", "이 의뢰의 부르미만 증빙 사진을 등록할 수 있어요.");
    }

    const proofWindow = this.validateProofWindow(job.status, payload.proofType);
    if (proofWindow.resultType === "ERROR") {
      return proofWindow;
    }

    const uploadSession = this.store.proofUploadSessions.get(payload.uploadSessionId);
    if (!uploadSession || uploadSession.jobId !== jobId || uploadSession.userId !== userId) {
      return fail("PROOF_UPLOAD_SESSION_NOT_FOUND", "증빙 업로드 세션을 찾을 수 없어요.");
    }

    if (uploadSession.proofType !== payload.proofType) {
      return fail("PROOF_UPLOAD_MISMATCH", "업로드한 증빙과 완료하려는 증빙 종류가 달라요.");
    }

    let finalizedUploadSession = uploadSession;
    if (finalizedUploadSession.status !== "UPLOADED") {
      const verifiedAsset = await this.proofAssetStorage.verifyUploadedAsset({
        objectKey: finalizedUploadSession.objectKey,
        maxBytes: PROOF_UPLOAD_MAX_BYTES,
        acceptedMimeTypes: [...SUPPORTED_IMAGE_MIME_TYPES.keys()]
      });
      if (!verifiedAsset) {
        return fail("PROOF_UPLOAD_INCOMPLETE", "증빙 사진 업로드가 아직 끝나지 않았어요.");
      }

      finalizedUploadSession = {
        ...finalizedUploadSession,
        status: "UPLOADED",
        localAssetPath: verifiedAsset.localAssetPath,
        uploadedAt: finalizedUploadSession.uploadedAt ?? nowIso()
      };
      this.store.proofUploadSessions.set(finalizedUploadSession.uploadSessionId, finalizedUploadSession);
    }

    const proof = {
      proofId: createId("proof"),
      jobId,
      uploadedBy: userId,
      proofType: payload.proofType,
      s3Key: finalizedUploadSession.objectKey,
      watermarkedUrl: this.proofAssetStorage.buildPublicProofUrl(finalizedUploadSession.objectKey),
      createdAt: nowIso()
    };
    const completedAt = nowIso();
    const updatedUploadSession: ProofUploadSession = {
      ...finalizedUploadSession,
      status: "COMPLETED",
      completedAt
    };
    const jobSnapshot = structuredClone(job);
    const uploadSnapshot = structuredClone(uploadSession);
    this.store.proofPhotos.push(proof);
    this.store.proofUploadSessions.set(updatedUploadSession.uploadSessionId, updatedUploadSession);
    if (payload.proofType === "delivery" && job.status === "DELIVERING") {
      job.status = "DELIVERY_PROOF_SUBMITTED";
    }

    try {
      await this.persistence.withTransaction(async (tx) => {
        if (finalizedUploadSession.status !== uploadSession.status || finalizedUploadSession.uploadedAt !== uploadSession.uploadedAt) {
          await tx.upsertProofUploadSession(finalizedUploadSession);
        }
        await tx.upsertProofUploadSession(updatedUploadSession);
        await tx.upsertProofPhoto(proof);
        await tx.upsertJob(job);
        await tx.enqueueOutboxEvent({
          eventId: createId("evt"),
          aggregateType: "JOB",
          aggregateId: jobId,
          eventType: "JOB_PROOF_SUBMITTED",
          payload: {
            jobId,
            proofId: proof.proofId,
            proofType: proof.proofType,
            jobStatus: job.status
          },
          availableAt: nowIso()
        });
      });
    } catch (error) {
      this.store.proofPhotos.pop();
      this.store.jobs.set(jobId, jobSnapshot);
      this.store.proofUploadSessions.set(uploadSnapshot.uploadSessionId, uploadSnapshot);
      throw error;
    }

    return ok({
      proofId: proof.proofId,
      watermarkedUrl: proof.watermarkedUrl,
      proofCount: this.store.proofPhotos.filter((photo) => photo.jobId === jobId).length,
      jobStatus: job.status,
      completedAt
    });
  }

  private parseImagePayload(dataUri: string, mimeTypeHint?: string) {
    const trimmed = dataUri.trim();
    if (!trimmed) {
      return fail("PROOF_UPLOAD_INVALID", "업로드할 이미지 데이터가 비어 있어요.");
    }

    let mimeType = mimeTypeHint?.trim() || "image/jpeg";
    let base64Data = trimmed;

    if (trimmed.startsWith("data:")) {
      const matched = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (!matched) {
        return fail("PROOF_UPLOAD_INVALID", "지원하지 않는 이미지 데이터 형식이에요.");
      }

      mimeType = matched[1];
      base64Data = matched[2];
    }

    if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
      return fail("PROOF_UPLOAD_INVALID", "지원하지 않는 이미지 형식이에요.");
    }

    const buffer = Buffer.from(base64Data, "base64");
    if (!buffer.length || buffer.byteLength > PROOF_UPLOAD_MAX_BYTES) {
      return fail("PROOF_UPLOAD_TOO_LARGE", "증빙 이미지는 5MB 이하만 업로드할 수 있어요.");
    }

    return ok({
      mimeType,
      buffer
    });
  }
}
