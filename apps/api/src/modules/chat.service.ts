import { fail, ok } from "../../../../packages/contracts/src/index.ts";
import { moderateChatMessage } from "../../../../packages/policy/src/index.ts";

import type { InMemoryStore } from "../store.ts";
import { createId, nowIso } from "../utils.ts";

export class ChatService {
  constructor(private readonly store: InMemoryStore) {}

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

  ensureRoom(jobId: string) {
    const existing = [...this.store.chatRooms.values()].find((room) => room.jobId === jobId);
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
    }
    return room;
  }

  getRoom(jobId: string, userId: string) {
    const job = this.assertParticipant(jobId, userId);
    if (job.resultType === "ERROR") {
      return job;
    }

    const room = this.ensureRoom(jobId);
    return ok({
      roomId: room.roomId,
      status: room.status,
      safetyBanner: "개인정보를 보내지 마세요. 불법 요청 시 대화와 의뢰가 중단될 수 있어요.",
      messages: this.store.chatMessages.get(room.roomId) ?? []
    });
  }

  sendMessage(jobId: string, senderUserId: string, body: string, messageType: "text" | "image" = "text") {
    const authorizedJob = this.assertParticipant(jobId, senderUserId);
    if (authorizedJob.resultType === "ERROR") {
      return authorizedJob;
    }
    const job = authorizedJob.success;

    const room = this.ensureRoom(jobId);
    if (room.status !== "OPEN") {
      return fail("CHAT_LOCKED", "안전상의 이유로 채팅이 잠겨 있어요.");
    }

    if (!body.trim()) {
      return fail("CHAT_MESSAGE_INVALID", "빈 메시지는 전송할 수 없어요.");
    }

    const moderation = moderateChatMessage(body, job.status);
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

    if (moderation.status === "SEVERE_BLOCK") {
      room.status = "LOCKED";
      job.hasDispute = true;
      job.status =
        job.status === "PICKED_UP" || job.status === "DELIVERING" || job.status === "DELIVERY_PROOF_SUBMITTED"
          ? "DISPUTED"
          : "CHAT_BLOCKED";
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
