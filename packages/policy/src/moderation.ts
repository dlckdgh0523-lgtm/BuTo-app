import type { JobStatus, ModerationDecision } from "../../contracts/src/index.ts";

const severePatterns = [
  "otp",
  "계좌번호",
  "통장 보내",
  "술 사",
  "담배 사",
  "약 좀",
  "현금",
  "성관계",
  "죽여",
  "협박"
];

const warnPatterns = ["공동현관", "비밀번호", "메신저로", "전화번호", "카톡"];

export function moderateChatMessage(message: string, jobStatus: JobStatus): ModerationDecision {
  const lowered = message.toLowerCase();
  const reasons: string[] = [];

  for (const pattern of severePatterns) {
    if (lowered.includes(pattern.toLowerCase())) {
      reasons.push(`severe:${pattern}`);
    }
  }

  if (reasons.length > 0) {
    const actionTaken =
      jobStatus === "PICKED_UP" || jobStatus === "DELIVERING" || jobStatus === "DELIVERY_PROOF_SUBMITTED"
        ? "FORCE_DISPUTE_AND_HOLD_PAYOUT"
        : "LOCK_CHAT_AND_FREEZE_JOB";

    return {
      status: "SEVERE_BLOCK",
      actionTaken,
      reasons
    };
  }

  for (const pattern of warnPatterns) {
    if (lowered.includes(pattern.toLowerCase())) {
      reasons.push(`warn:${pattern}`);
    }
  }

  if (reasons.length > 0) {
    return {
      status: "WARN",
      actionTaken: "DELIVER_WITH_WARNING",
      reasons
    };
  }

  return {
    status: "DELIVERED",
    actionTaken: "NONE",
    reasons: []
  };
}

