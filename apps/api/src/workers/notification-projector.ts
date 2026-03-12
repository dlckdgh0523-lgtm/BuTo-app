import type { NotificationRecord } from "../../../../packages/contracts/src/index.ts";

import type { OutboxEventRecord } from "../persistence.ts";
import type { InMemoryStore } from "../store.ts";

function makeNotification(
  event: OutboxEventRecord,
  input: Omit<NotificationRecord, "notificationId" | "channel" | "triggeredByEventId" | "createdAt">
): NotificationRecord {
  return {
    notificationId: `${event.eventId}:${input.userId}`,
    userId: input.userId,
    channel: "IN_APP",
    category: input.category,
    title: input.title,
    body: input.body,
    deepLink: input.deepLink,
    relatedEntityType: input.relatedEntityType,
    relatedEntityId: input.relatedEntityId,
    triggeredByEventId: event.eventId,
    createdAt: new Date().toISOString(),
    readAt: input.readAt
  };
}

export function buildNotificationsForOutboxEvent(store: InMemoryStore, event: OutboxEventRecord) {
  switch (event.eventType) {
    case "PAYMENT_HELD": {
      const jobId = typeof event.payload.jobId === "string" ? event.payload.jobId : undefined;
      if (!jobId) return [];
      const job = store.jobs.get(jobId);
      if (!job) return [];
      return [
        makeNotification(event, {
          userId: job.clientUserId,
          category: "TRANSACTION",
          title: "결제가 보관 처리되었어요",
          body: "의뢰 결제가 안전 보관 상태로 전환되었어요. 매칭이 시작되면 진행 상황을 계속 알려드릴게요.",
          deepLink: `/jobs/${jobId}`,
          relatedEntityType: "JOB",
          relatedEntityId: jobId
        })
      ];
    }
    case "JOB_MATCHED": {
      const jobId = typeof event.payload.jobId === "string" ? event.payload.jobId : undefined;
      const runnerUserId = typeof event.payload.runnerUserId === "string" ? event.payload.runnerUserId : undefined;
      if (!jobId || !runnerUserId) return [];
      const job = store.jobs.get(jobId);
      if (!job) return [];
      return [
        makeNotification(event, {
          userId: job.clientUserId,
          category: "TRANSACTION",
          title: "부르미가 배정되었어요",
          body: "의뢰를 수행할 부르미가 확정되었어요. 채팅과 위치 공유를 통해 진행 상황을 확인해 주세요.",
          deepLink: `/jobs/${jobId}`,
          relatedEntityType: "JOB",
          relatedEntityId: jobId
        }),
        makeNotification(event, {
          userId: runnerUserId,
          category: "TRANSACTION",
          title: "의뢰 수락이 완료되었어요",
          body: "수락한 의뢰가 확정되었어요. 이동 전 채팅과 안전수칙을 다시 확인해 주세요.",
          deepLink: `/jobs/${jobId}`,
          relatedEntityType: "JOB",
          relatedEntityId: jobId
        })
      ];
    }
    case "JOB_CANCELLATION_REQUESTED": {
      const jobId = typeof event.payload.jobId === "string" ? event.payload.jobId : undefined;
      const runnerUserId = typeof event.payload.runnerUserId === "string" ? event.payload.runnerUserId : undefined;
      if (!jobId || !runnerUserId) return [];
      return [
        makeNotification(event, {
          userId: runnerUserId,
          category: "TRANSACTION",
          title: "합의 취소 요청이 도착했어요",
          body: "의뢰자가 거래 불발로 취소를 요청했어요. 수락하면 결제는 클라이언트 결제수단으로 환불돼요.",
          deepLink: `/jobs/${jobId}`,
          relatedEntityType: "JOB",
          relatedEntityId: jobId
        })
      ];
    }
    case "JOB_CANCELLATION_REJECTED": {
      const jobId = typeof event.payload.jobId === "string" ? event.payload.jobId : undefined;
      const clientUserId = typeof event.payload.clientUserId === "string" ? event.payload.clientUserId : undefined;
      const runnerUserId = typeof event.payload.runnerUserId === "string" ? event.payload.runnerUserId : undefined;
      if (!jobId || !clientUserId || !runnerUserId) return [];
      return [
        makeNotification(event, {
          userId: clientUserId,
          category: "TRANSACTION",
          title: "합의 취소 요청이 거절되었어요",
          body: "부르미가 취소 요청을 거절했어요. 픽업 이후 이슈는 운영 검토로 이어질 수 있어요.",
          deepLink: `/jobs/${jobId}`,
          relatedEntityType: "JOB",
          relatedEntityId: jobId
        }),
        makeNotification(event, {
          userId: runnerUserId,
          category: "TRANSACTION",
          title: "취소 거절이 반영되었어요",
          body: "거래는 계속 진행 상태예요. 추가 이슈가 있으면 신고 또는 운영 검토로 전환해 주세요.",
          deepLink: `/jobs/${jobId}`,
          relatedEntityType: "JOB",
          relatedEntityId: jobId
        })
      ];
    }
    case "JOB_CANCELLED_BY_AGREEMENT":
    case "JOB_AUTO_CANCELLED_IDLE": {
      const jobId = typeof event.payload.jobId === "string" ? event.payload.jobId : undefined;
      const refundReasonNormalized = typeof event.payload.refundReasonNormalized === "string"
        ? event.payload.refundReasonNormalized
        : "거래 불발";
      if (!jobId) return [];
      const job = store.jobs.get(jobId);
      if (!job) return [];
      const recipients = [job.clientUserId, job.matchedRunnerUserId].filter(Boolean) as string[];
      const title = event.eventType === "JOB_AUTO_CANCELLED_IDLE" ? "거래가 자동 파기되었어요" : "합의 취소가 완료되었어요";
      const body = event.eventType === "JOB_AUTO_CANCELLED_IDLE"
        ? `개인 대화에서 20분 이상 응답이 없어 픽업 전 거래를 자동 종료했어요. 사유: ${refundReasonNormalized}`
        : `부르미 동의로 거래를 불발 처리했어요. 결제는 클라이언트 결제수단으로 환불돼요. 사유: ${refundReasonNormalized}`;
      return recipients.map((userId) =>
        makeNotification(event, {
          userId,
          category: "TRANSACTION",
          title,
          body,
          deepLink: `/jobs/${jobId}`,
          relatedEntityType: "JOB",
          relatedEntityId: jobId
        })
      );
    }
    case "JOB_PROOF_SUBMITTED": {
      const jobId = typeof event.payload.jobId === "string" ? event.payload.jobId : undefined;
      const proofType = typeof event.payload.proofType === "string" ? event.payload.proofType : "delivery";
      if (!jobId) return [];
      const job = store.jobs.get(jobId);
      if (!job) return [];
      return [
        makeNotification(event, {
          userId: job.clientUserId,
          category: "TRANSACTION",
          title: proofType === "delivery" ? "배송 증빙이 도착했어요" : "픽업 증빙이 등록되었어요",
          body: proofType === "delivery"
            ? "부르미가 배송 증빙을 등록했어요. 사진과 진행 상태를 확인해 주세요."
            : "부르미가 픽업 증빙을 등록했어요. 진행 상황을 계속 확인해 주세요.",
          deepLink: `/jobs/${jobId}`,
          relatedEntityType: "JOB",
          relatedEntityId: jobId
        })
      ];
    }
    case "PAYMENT_REFUNDED": {
      const jobId = typeof event.payload.jobId === "string" ? event.payload.jobId : undefined;
      const refundReasonNormalized = typeof event.payload.refundReasonNormalized === "string"
        ? event.payload.refundReasonNormalized
        : "거래 불발";
      if (!jobId) return [];
      const job = store.jobs.get(jobId);
      if (!job) return [];
      return [
        makeNotification(event, {
          userId: job.clientUserId,
          category: "TRANSACTION",
          title: "환불이 접수되었어요",
          body: `거래 불발 환불을 접수했어요. 결제수단 반영 시점은 카드사/계좌 사정에 따라 달라질 수 있어요. 사유: ${refundReasonNormalized}`,
          deepLink: `/jobs/${jobId}`,
          relatedEntityType: "JOB",
          relatedEntityId: jobId
        })
      ];
    }
    case "DISPUTE_RESOLVED": {
      const jobId = typeof event.payload.jobId === "string" ? event.payload.jobId : undefined;
      const resolution = typeof event.payload.resolution === "string" ? event.payload.resolution : "CANCELLED";
      if (!jobId) return [];
      const job = store.jobs.get(jobId);
      if (!job) return [];
      const recipients = [job.clientUserId, job.matchedRunnerUserId].filter(Boolean) as string[];
      return recipients.map((userId) =>
        makeNotification(event, {
          userId,
          category: "TRANSACTION",
          title: "분쟁 검토가 완료되었어요",
          body: `운영팀이 분쟁을 ${resolution} 상태로 처리했어요. 상세 결과를 확인해 주세요.`,
          deepLink: `/jobs/${jobId}`,
          relatedEntityType: "JOB",
          relatedEntityId: jobId
        })
      );
    }
    case "JOB_REVIEW_DECIDED": {
      const jobId = typeof event.payload.jobId === "string" ? event.payload.jobId : undefined;
      const decision = typeof event.payload.decision === "string" ? event.payload.decision : "REJECT";
      if (!jobId) return [];
      const job = store.jobs.get(jobId);
      if (!job) return [];
      return [
        makeNotification(event, {
          userId: job.clientUserId,
          category: "TRANSACTION",
          title: decision === "APPROVE" ? "의뢰 검수가 승인되었어요" : "의뢰 검수가 보류되었어요",
          body: decision === "APPROVE"
            ? "운영 검수를 통과했어요. 이제 부르미 매칭이 진행됩니다."
            : "운영 검수에서 의뢰가 거절되었어요. 요청 내용과 정책을 다시 확인해 주세요.",
          deepLink: `/jobs/${jobId}`,
          relatedEntityType: "JOB",
          relatedEntityId: jobId
        })
      ];
    }
    case "USER_ENFORCEMENT_APPLIED": {
      const userId = typeof event.payload.userId === "string" ? event.payload.userId : undefined;
      const reasonCode = typeof event.payload.reasonCode === "string" ? event.payload.reasonCode : "POLICY";
      if (!userId) return [];
      return [
        makeNotification(event, {
          userId,
          category: "ACCOUNT",
          title: "계정 이용이 제한되었어요",
          body: `운영정책 위반이 감지되어 계정 이용이 제한되었어요. 사유 코드: ${reasonCode}`,
          deepLink: "/me/enforcement-status",
          relatedEntityType: "USER",
          relatedEntityId: userId
        })
      ];
    }
    case "USER_REINSTATED": {
      const userId = typeof event.payload.userId === "string" ? event.payload.userId : undefined;
      if (!userId) return [];
      return [
        makeNotification(event, {
          userId,
          category: "ACCOUNT",
          title: "계정 이용 제한이 해제되었어요",
          body: "운영 검토 결과 계정 이용이 다시 가능해졌어요. 안전수칙을 확인한 뒤 이용을 재개해 주세요.",
          deepLink: "/me/enforcement-status",
          relatedEntityType: "USER",
          relatedEntityId: userId
        })
      ];
    }
    case "USER_APPEAL_SUBMITTED":
    case "APPEAL_MORE_INFO_REQUESTED":
    case "APPEAL_APPROVED":
    case "APPEAL_REJECTED": {
      const userId = typeof event.payload.userId === "string" ? event.payload.userId : undefined;
      const appealId = typeof event.payload.appealId === "string" ? event.payload.appealId : undefined;
      if (!userId || !appealId) return [];

      const contentByType = {
        USER_APPEAL_SUBMITTED: {
          title: "이의제기가 접수되었어요",
          body: "운영팀이 제출하신 이의제기를 검토할 예정이에요."
        },
        APPEAL_MORE_INFO_REQUESTED: {
          title: "추가 자료가 필요해요",
          body: "운영팀이 이의제기 검토를 위해 추가 자료를 요청했어요."
        },
        APPEAL_APPROVED: {
          title: "이의제기가 승인되었어요",
          body: "운영 검토 결과 계정 제한이 해제되었어요."
        },
        APPEAL_REJECTED: {
          title: "이의제기가 반려되었어요",
          body: "운영 검토 결과 기존 제재가 유지되었어요."
        }
      } as const;

      const content = contentByType[event.eventType as keyof typeof contentByType];
      return [
        makeNotification(event, {
          userId,
          category: "ACCOUNT",
          title: content.title,
          body: content.body,
          deepLink: `/appeals/${appealId}`,
          relatedEntityType: "APPEAL",
          relatedEntityId: appealId
        })
      ];
    }
    case "CHAT_MESSAGE_STORED": {
      const jobId = typeof event.payload.jobId === "string" ? event.payload.jobId : undefined;
      const senderUserId = typeof event.payload.senderUserId === "string" ? event.payload.senderUserId : undefined;
      const moderationStatus = typeof event.payload.moderationStatus === "string" ? event.payload.moderationStatus : "DELIVERED";
      if (!jobId || !senderUserId) return [];
      const job = store.jobs.get(jobId);
      if (!job) return [];
      const recipients = [job.clientUserId, job.matchedRunnerUserId]
        .filter((userId): userId is string => Boolean(userId) && userId !== senderUserId);
      if (moderationStatus === "SEVERE_BLOCK") {
        return [];
      }
      return recipients.map((userId) =>
        makeNotification(event, {
          userId,
          category: "CHAT",
          title: "새 채팅 메시지가 도착했어요",
          body: moderationStatus === "WARN"
            ? "주의가 필요한 메시지가 도착했어요. 개인정보는 보내지 마세요."
            : "새로운 대화가 도착했어요. 안전수칙을 지키며 확인해 주세요.",
          deepLink: `/jobs/${jobId}/chat`,
          relatedEntityType: "CHAT_ROOM",
          relatedEntityId: job.chatRoomId
        })
      );
    }
    default:
      return [];
  }
}
