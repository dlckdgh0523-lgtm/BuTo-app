import { fail, ok } from "../../../../packages/contracts/src/index.ts";
import { moderateChatMessage } from "../../../../packages/policy/src/index.ts";

import type { PersistenceAdapter } from "../persistence.ts";
import type { InMemoryStore } from "../store.ts";
import { createId, nowIso } from "../utils.ts";
import type { CancellationService } from "./cancellation.service.ts";
import type { EnforcementService } from "./enforcement.service.ts";

export class ChatService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly enforcementService: EnforcementService,
    private readonly persistence: PersistenceAdapter,
    private readonly cancellationService: CancellationService
  ) {}

  private findRoom(jobId: string) {
    return [...this.store.chatRooms.values()].find((room) => room.jobId === jobId);
  }

  private assertParticipant(jobId: string, userId: string) {
    const job = this.store.jobs.get(jobId);
    if (!job) {
      return fail("JOB_NOT_FOUND", "의뢰를 찾을 수 없어요.");
    }

    const isParticipant = userId === job.clientUserId || userId === job.matchedRunnerUserId;
    if (!isParticipant) {
      return fail("CHAT_NOT_AUTHORIZED", "대화 참여자만 채팅을 사용할 수 있어요.");
    }

    if (!job.matchedRunnerUserId) {
      return fail("CHAT_NOT_READY", "매칭 후에만 채팅을 사용할 수 있어요.");
    }

    return ok(job);
  }

  async ensureRoom(jobId: string, persistence: PersistenceAdapter = this.persistence) {
    const existing = this.findRoom(jobId);
    if (existing) {
      return existing;
    }

    const room = {
      roomId: createId("room"),
      jobId,
      status: "OPEN" as const,
      createdAt: nowIso()
    };

    this.store.chatRooms.set(room.roomId, room);
    this.store.chatMessages.set(room.roomId, []);
    const job = this.store.jobs.get(jobId);
    if (job) {
      job.chatRoomId = room.roomId;
      await persistence.upsertJob(job);
    }
    await persistence.upsertChatRoom(room);
    return room;
  }

  async getRoom(jobId: string, userId: string) {
    const idleResult = await this.cancellationService.evaluateIdleTimeoutForJob(jobId);
    if (idleResult.resultType === "ERROR") {
      return idleResult;
    }

    const job = this.assertParticipant(jobId, userId);
    if (job.resultType === "ERROR") {
      return job;
    }

    const room = await this.ensureRoom(jobId);
    return ok({
      roomId: room.roomId,
      status: room.status,
      safetyBanner: "개인정보를 보내지 마세요. 불법 요청 시 대화와 의뢰가 중단될 수 있어요.",
      messages: this.store.chatMessages.get(room.roomId) ?? []
    });
  }

  async sendMessage(jobId: string, senderUserId: string, body: string, messageType: "text" | "image" = "text") {
    const idleResult = await this.cancellationService.evaluateIdleTimeoutForJob(jobId);
    if (idleResult.resultType === "ERROR") {
      return idleResult;
    }

    const authorizedJob = this.assertParticipant(jobId, senderUserId);
    if (authorizedJob.resultType === "ERROR") {
      return authorizedJob;
    }
    const job = authorizedJob.success;

    const existingRoom = this.findRoom(jobId);
    let room = existingRoom ?? {
      roomId: createId("room"),
      jobId,
      status: "OPEN" as const,
      createdAt: nowIso()
    };
    if (room.status !== "OPEN") {
      return fail("CHAT_LOCKED", "안전상의 이유로 채팅이 잠겨 있어요.");
    }

    if (!body.trim()) {
      return fail("CHAT_MESSAGE_INVALID", "빈 메시지는 전송할 수 없어요.");
    }

    const moderation = moderateChatMessage(body, job.status);
    const hadRoom = Boolean(existingRoom);
    const roomSnapshot = structuredClone(room);
    const jobSnapshot = structuredClone(job);
    const existingMessages = hadRoom ? [...(this.store.chatMessages.get(room.roomId) ?? [])] : [];
    const hadMessagesArray = hadRoom && this.store.chatMessages.has(room.roomId);
    const originalJobChatRoomId = job.chatRoomId;

    if (!hadRoom) {
      this.store.chatRooms.set(room.roomId, room);
      this.store.chatMessages.set(room.roomId, []);
      job.chatRoomId = room.roomId;
    }

    const message = {
      messageId: createId("msg"),
      roomId: room.roomId,
      senderUserId,
      messageType,
      body,
      moderationStatus: moderation.status,
      actionTaken: moderation.actionTaken,
      createdAt: nowIso()
    };

    const messages = this.store.chatMessages.get(room.roomId) ?? [];
    messages.push(message);
    this.store.chatMessages.set(room.roomId, messages);

    try {
      await this.persistence.withTransaction(async (tx) => {
        if (!hadRoom) {
          await tx.upsertJob(job);
          await tx.upsertChatRoom(room);
        }

        await tx.appendChatMessage(message);
        await tx.enqueueOutboxEvent({
          eventId: createId("evt"),
          aggregateType: "CHAT_ROOM",
          aggregateId: room.roomId,
          eventType: "CHAT_MESSAGE_STORED",
          payload: {
            roomId: room.roomId,
            jobId,
            messageId: message.messageId,
            senderUserId,
            moderationStatus: message.moderationStatus
          },
          availableAt: nowIso()
        });

        if (moderation.status === "SEVERE_BLOCK") {
          room.status = "LOCKED";
          job.hasDispute = true;
          job.status =
            job.status === "PICKED_UP" || job.status === "DELIVERING" || job.status === "DELIVERY_PROOF_SUBMITTED"
              ? "DISPUTED"
              : "CHAT_BLOCKED";
          await tx.upsertChatRoom(room);
          await tx.upsertJob(job);
          const enforcement = await this.enforcementService.applyAutomatedRestriction(
            senderUserId,
            {
              reasonCode: "AI_POLICY_BLOCK",
              reasonMessage: "부적절한 텍스트 또는 부정행위 패턴이 감지되어 운영정책에 따라 계정이 즉시 잠금 처리되었어요.",
              scope: "ACCOUNT_FULL",
              evidenceType: "CHAT_MESSAGE",
              evidenceSummary: body,
              evidenceMetadata: {
                roomId: room.roomId,
                jobId
              }
            },
            tx
          );
          if (enforcement.resultType === "ERROR") {
            throw enforcement;
          }
        }
      });
    } catch (error) {
      this.store.jobs.set(jobId, jobSnapshot);
      if (hadRoom) {
        this.store.chatRooms.set(room.roomId, roomSnapshot);
      } else {
        this.store.chatRooms.delete(room.roomId);
        job.chatRoomId = originalJobChatRoomId;
      }
      if (hadMessagesArray) {
        this.store.chatMessages.set(room.roomId, existingMessages);
      } else {
        this.store.chatMessages.delete(room.roomId);
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
      messageId: message.messageId,
      moderationStatus: message.moderationStatus,
      delivered: moderation.status === "DELIVERED" || moderation.status === "WARN",
      actionTaken: moderation.actionTaken,
      jobStatus: job.status
    });
  }
}
