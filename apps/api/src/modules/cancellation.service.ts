import { fail, ok } from "../../../../packages/contracts/src/index.ts";

import type { PersistenceAdapter } from "../persistence.ts";
import type { ChatRoom, InMemoryStore, JobCancellationRequest, StoredJob } from "../store.ts";
import { createId, nowIso } from "../utils.ts";
import type { PaymentsService } from "./payments.service.ts";

const MUTUAL_CANCELLABLE_STATUSES = ["MATCHED", "RUNNER_EN_ROUTE", "RUNNER_ARRIVED"] as const;
const AUTO_IDLE_CANCELLABLE_STATUSES = ["MATCHED", "RUNNER_EN_ROUTE"] as const;
const AUTO_CANCEL_IDLE_MS = 20 * 60 * 1000;

export class CancellationService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly persistence: PersistenceAdapter,
    private readonly paymentsService: PaymentsService
  ) {}

  getLatestRequest(jobId: string) {
    return [...this.store.jobCancellationRequests.values()]
      .filter((request) => request.jobId === jobId)
      .sort((left, right) => Date.parse(right.requestedAt) - Date.parse(left.requestedAt))[0];
  }

  async requestClientCancellation(jobId: string, clientUserId: string, reason: string) {
    const job = this.store.jobs.get(jobId);
    if (!job || job.clientUserId !== clientUserId || !job.matchedRunnerUserId) {
      return fail("JOB_CANCELLATION_NOT_ALLOWED", "합의 취소를 요청할 수 없는 의뢰예요.");
    }

    if (!MUTUAL_CANCELLABLE_STATUSES.includes(job.status as (typeof MUTUAL_CANCELLABLE_STATUSES)[number])) {
      return fail("JOB_CANCELLATION_NOT_ALLOWED", "픽업 이후에는 자동 취소 대신 운영 검토가 필요해요.");
    }

    const existing = this.getLatestRequest(jobId);
    if (existing?.status === "PENDING_RUNNER_CONFIRMATION") {
      return fail("JOB_CANCELLATION_PENDING", "이미 부르미 응답을 기다리는 취소 요청이 있어요.");
    }

    const request: JobCancellationRequest = {
      cancellationRequestId: createId("cancel"),
      jobId,
      requestedByUserId: clientUserId,
      requesterRole: "CLIENT",
      reason: reason.trim() || "일정 조율 실패로 거래를 이어가기 어려워요.",
      status: "PENDING_RUNNER_CONFIRMATION",
      requestedAt: nowIso()
    };
    this.store.jobCancellationRequests.set(request.cancellationRequestId, request);

    const room = this.findRoomByJob(jobId);
    const systemMessage = room
      ? this.makeSystemMessage(room.roomId, `의뢰자가 합의 취소를 요청했어요. 부르미가 수락하면 거래 불발로 종료되고 결제는 클라이언트 결제수단으로 환불돼요.`)
      : undefined;

    try {
      await this.persistence.withTransaction(async (tx) => {
        await tx.upsertJobCancellationRequest(request);
        if (systemMessage) {
          this.appendRoomMessage(room!, systemMessage);
          await tx.appendChatMessage(systemMessage);
        }
        await tx.appendAuditLog({
          auditId: createId("audit"),
          actorUserId: clientUserId,
          action: "JOB_CANCELLATION_REQUESTED",
          entityType: "JOB",
          entityId: jobId,
          note: request.reason,
          before: { status: job.status },
          after: { status: job.status, cancellationRequestId: request.cancellationRequestId },
          createdAt: nowIso()
        });
        await tx.enqueueOutboxEvent({
          eventId: createId("evt"),
          aggregateType: "JOB",
          aggregateId: jobId,
          eventType: "JOB_CANCELLATION_REQUESTED",
          payload: {
            jobId,
            requestedByUserId: clientUserId,
            runnerUserId: job.matchedRunnerUserId,
            reason: request.reason
          },
          availableAt: nowIso()
        });
      });
    } catch (error) {
      this.store.jobCancellationRequests.delete(request.cancellationRequestId);
      if (systemMessage) {
        this.rollbackRoomMessage(room!.roomId, systemMessage.messageId);
      }
      throw error;
    }

    return ok({
      jobId,
      status: request.status,
      requestedAt: request.requestedAt
    });
  }

  async respondRunnerCancellation(jobId: string, runnerUserId: string, decision: "ACCEPT" | "REJECT", note?: string) {
    const job = this.store.jobs.get(jobId);
    if (!job || job.matchedRunnerUserId !== runnerUserId) {
      return fail("JOB_CANCELLATION_NOT_ALLOWED", "부르미만 취소 요청에 응답할 수 있어요.");
    }

    const request = this.getLatestRequest(jobId);
    if (!request || request.status !== "PENDING_RUNNER_CONFIRMATION") {
      return fail("JOB_CANCELLATION_NOT_FOUND", "응답할 취소 요청이 없어요.");
    }

    if (decision === "REJECT") {
      const requestSnapshot = structuredClone(request);
      request.status = "REJECTED";
      request.respondedAt = nowIso();
      request.responseByUserId = runnerUserId;
      request.responseNote = note?.trim() || undefined;

      const room = this.findRoomByJob(jobId);
      const systemMessage = room ? this.makeSystemMessage(room.roomId, "부르미가 취소 요청을 거절했어요. 픽업 이후 이슈는 운영 검토로 이어질 수 있어요.") : undefined;

      try {
        await this.persistence.withTransaction(async (tx) => {
          await tx.upsertJobCancellationRequest(request);
          if (systemMessage) {
            this.appendRoomMessage(room!, systemMessage);
            await tx.appendChatMessage(systemMessage);
          }
          await tx.appendAuditLog({
            auditId: createId("audit"),
            actorUserId: runnerUserId,
            action: "JOB_CANCELLATION_REJECTED",
            entityType: "JOB",
            entityId: jobId,
            note: request.responseNote,
            before: { status: job.status, cancellationRequestId: request.cancellationRequestId },
            after: { status: job.status, cancellationStatus: request.status },
            createdAt: nowIso()
          });
          await tx.enqueueOutboxEvent({
            eventId: createId("evt"),
            aggregateType: "JOB",
            aggregateId: jobId,
            eventType: "JOB_CANCELLATION_REJECTED",
            payload: {
              jobId,
              clientUserId: job.clientUserId,
              runnerUserId,
              reason: request.reason,
              responseNote: request.responseNote
            },
            availableAt: nowIso()
          });
        });
      } catch (error) {
        Object.assign(request, requestSnapshot);
        if (systemMessage) {
          this.rollbackRoomMessage(room!.roomId, systemMessage.messageId);
        }
        throw error;
      }

      return ok({
        jobId,
        status: request.status,
        respondedAt: request.respondedAt
      });
    }

    return this.finalizeFailedTradeCancellation(job, request, {
      responderUserId: runnerUserId,
      finalStatus: "ACCEPTED",
      responseNote: note?.trim() || undefined,
      outboxEventType: "JOB_CANCELLED_BY_AGREEMENT",
      systemBody: "부르미가 취소 요청에 동의했어요. 거래를 불발로 종료하고 결제를 클라이언트 결제수단으로 환불해요."
    });
  }

  async evaluateIdleTimeoutForJob(jobId: string) {
    const job = this.store.jobs.get(jobId);
    if (!job || !job.matchedRunnerUserId) {
      return ok({ cancelled: false, reason: "JOB_NOT_READY" as const });
    }

    if (!AUTO_IDLE_CANCELLABLE_STATUSES.includes(job.status as (typeof AUTO_IDLE_CANCELLABLE_STATUSES)[number])) {
      return ok({ cancelled: false, reason: "IDLE_TIMEOUT_DEFERRED_TO_MANUAL_REVIEW" as const });
    }

    const room = this.findRoomByJob(jobId);
    if (!room) {
      return ok({ cancelled: false, reason: "ROOM_NOT_CREATED" as const });
    }

    const latestUserMessage = [...(this.store.chatMessages.get(room.roomId) ?? [])]
      .filter((message) => message.messageType !== "system")
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];

    if (!latestUserMessage) {
      return ok({ cancelled: false, reason: "NO_CHAT_ACTIVITY" as const });
    }

    const idleDeadlineAt = new Date(Date.parse(latestUserMessage.createdAt) + AUTO_CANCEL_IDLE_MS).toISOString();
    if (Date.parse(idleDeadlineAt) > Date.now()) {
      return ok({ cancelled: false, reason: "IDLE_WINDOW_OPEN" as const, idleDeadlineAt });
    }

    const existing = this.getLatestRequest(jobId);
    if (existing?.status === "AUTO_CANCELLED" || existing?.status === "ACCEPTED") {
      return ok({ cancelled: false, reason: "ALREADY_CANCELLED" as const, idleDeadlineAt });
    }

    const request: JobCancellationRequest = {
      cancellationRequestId: createId("cancel"),
      jobId,
      requestedByUserId: job.clientUserId,
      requesterRole: "SYSTEM",
      reason: "개인 대화에서 20분 이상 상호 응답이 없어 거래 불발로 종료해요.",
      status: "AUTO_CANCELLED",
      requestedAt: nowIso()
    };

    return this.finalizeFailedTradeCancellation(job, request, {
      responderUserId: "SYSTEM",
      finalStatus: "AUTO_CANCELLED",
      responseNote: "20분 무응답 자동 파기",
      outboxEventType: "JOB_AUTO_CANCELLED_IDLE",
      systemBody: "개인 대화에서 20분 이상 상호 응답이 없어 거래를 자동 종료했어요. 픽업 전 거래만 자동 파기되며 결제는 클라이언트 결제수단으로 환불돼요."
    });
  }

  async sweepIdleTimeoutsForUser(userId: string, roleFlags: string[]) {
    const isAdmin = roleFlags.includes("ADMIN");
    const candidates = [...this.store.jobs.values()].filter((job) =>
      AUTO_IDLE_CANCELLABLE_STATUSES.includes(job.status as (typeof AUTO_IDLE_CANCELLABLE_STATUSES)[number]) &&
      (isAdmin || userId === job.clientUserId || userId === job.matchedRunnerUserId)
    );

    for (const job of candidates) {
      const result = await this.evaluateIdleTimeoutForJob(job.jobId);
      if (result.resultType === "ERROR") {
        return result;
      }
    }

    return ok({ scanned: candidates.length });
  }

  async sweepIdleTimeouts() {
    const candidates = [...this.store.jobs.values()].filter((job) =>
      AUTO_IDLE_CANCELLABLE_STATUSES.includes(job.status as (typeof AUTO_IDLE_CANCELLABLE_STATUSES)[number])
    );

    let cancelled = 0;
    for (const job of candidates) {
      const result = await this.evaluateIdleTimeoutForJob(job.jobId);
      if (result.resultType === "ERROR") {
        return result;
      }
      if (result.success.cancelled) {
        cancelled += 1;
      }
    }

    return ok({
      scanned: candidates.length,
      cancelled
    });
  }

  private async finalizeFailedTradeCancellation(
    job: StoredJob,
    request: JobCancellationRequest,
    input: {
      responderUserId: string;
      finalStatus: "ACCEPTED" | "AUTO_CANCELLED";
      responseNote?: string;
      outboxEventType: "JOB_CANCELLED_BY_AGREEMENT" | "JOB_AUTO_CANCELLED_IDLE";
      systemBody: string;
    }
  ) {
    if (!MUTUAL_CANCELLABLE_STATUSES.includes(job.status as (typeof MUTUAL_CANCELLABLE_STATUSES)[number])) {
      return fail("JOB_CANCELLATION_NOT_ALLOWED", "이 상태에서는 자동 취소가 불가능해요.");
    }

    const requestIdExists = this.store.jobCancellationRequests.has(request.cancellationRequestId);
    const requestSnapshot = requestIdExists ? structuredClone(request) : undefined;
    const jobSnapshot = structuredClone(job);
    const room = this.findRoomByJob(job.jobId);
    const roomSnapshot = room ? structuredClone(room) : undefined;
    const systemMessage = room ? this.makeSystemMessage(room.roomId, input.systemBody) : undefined;

    request.status = input.finalStatus;
    request.respondedAt = nowIso();
    request.responseByUserId = input.responderUserId === "SYSTEM" ? undefined : input.responderUserId;
    request.responseNote = input.responseNote;
    request.refundReasonNormalized = normalizeCancellationRefundReason(request.reason);
    this.store.jobCancellationRequests.set(request.cancellationRequestId, request);

    job.status = "CANCELLED";
    if (room) {
      room.status = "CLOSED";
    }
    if (systemMessage) {
      this.appendRoomMessage(room!.roomId, systemMessage);
    }

    try {
      await this.persistence.withTransaction(async (tx) => {
        await tx.upsertJobCancellationRequest(request);
        await tx.upsertJob(job);
        if (room) {
          await tx.upsertChatRoom(room);
        }
        if (systemMessage) {
          await tx.appendChatMessage(systemMessage);
        }
        const refunded = await this.paymentsService.refundFailedJob(job.jobId, job.clientUserId, request.reason, tx);
        if (refunded.resultType === "ERROR") {
          throw refunded;
        }
        await tx.appendAuditLog({
          auditId: createId("audit"),
          actorUserId: input.responderUserId,
          action: input.outboxEventType,
          entityType: "JOB",
          entityId: job.jobId,
          note: request.responseNote,
          before: { status: jobSnapshot.status },
          after: {
            status: job.status,
            cancellationStatus: request.status,
            refundReasonNormalized: refunded.success.refundReasonNormalized
          },
          createdAt: nowIso()
        });
        await tx.enqueueOutboxEvent({
          eventId: createId("evt"),
          aggregateType: "JOB",
          aggregateId: job.jobId,
          eventType: input.outboxEventType,
          payload: {
            jobId: job.jobId,
            clientUserId: job.clientUserId,
            runnerUserId: job.matchedRunnerUserId,
            refundReasonNormalized: refunded.success.refundReasonNormalized
          },
          availableAt: nowIso()
        });
      });
    } catch (error) {
      Object.assign(job, jobSnapshot);
      if (requestSnapshot) {
        Object.assign(request, requestSnapshot);
      } else {
        this.store.jobCancellationRequests.delete(request.cancellationRequestId);
      }
      if (room && roomSnapshot) {
        Object.assign(room, roomSnapshot);
      }
      if (systemMessage) {
        this.rollbackRoomMessage(room!.roomId, systemMessage.messageId);
      }
      if (
        error &&
        typeof error === "object" &&
        "resultType" in error &&
        (error as { resultType?: string }).resultType === "ERROR"
      ) {
        return error;
      }
      throw error;
    }

    return ok({
      jobId: job.jobId,
      status: request.status,
      jobStatus: job.status,
      refundReasonNormalized: request.refundReasonNormalized
    });
  }

  private findRoomByJob(jobId: string) {
    return [...this.store.chatRooms.values()].find((room) => room.jobId === jobId);
  }

  private makeSystemMessage(roomId: string, body: string) {
    return {
      messageId: createId("msg"),
      roomId,
      senderUserId: "system",
      messageType: "system" as const,
      body,
      moderationStatus: "DELIVERED" as const,
      actionTaken: "SYSTEM_NOTICE",
      createdAt: nowIso()
    };
  }

  private appendRoomMessage(roomId: string, message: ReturnType<CancellationService["makeSystemMessage"]>) {
    const messages = this.store.chatMessages.get(roomId) ?? [];
    messages.push(message);
    this.store.chatMessages.set(roomId, messages);
  }

  private rollbackRoomMessage(roomId: string, messageId: string) {
    const messages = this.store.chatMessages.get(roomId) ?? [];
    this.store.chatMessages.set(
      roomId,
      messages.filter((message) => message.messageId !== messageId)
    );
  }
}

function normalizeCancellationRefundReason(reason: string) {
  const normalized = reason
    .replace(/[^\p{Script=Hangul}\p{Letter}\p{Number}\s.,!?:()/_-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || "거래 불발로 환불";
}
