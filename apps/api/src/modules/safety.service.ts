import { productConfig } from "../../../../packages/config/src/index.ts";
import { fail, ok } from "../../../../packages/contracts/src/index.ts";

import type { PersistenceAdapter } from "../persistence.ts";
import type { InMemoryStore } from "../store.ts";
import { nowIso } from "../utils.ts";

const ruleItems = [
  "집 주소, 상세 동호수, 공동현관 비밀번호, 계좌 비밀번호, 신분증 사진은 채팅으로 보내지 마세요.",
  "현금 전달, 통장/카드/OTP 전달, 술·담배·약 전달 요청은 바로 중단하고 신고해 주세요.",
  "위협, 강요, 성희롱, 목적지 변경 강요가 있으면 진행을 멈추고 긴급 버튼을 눌러주세요.",
  "불법·협박·부적절 대화가 확인되면 의뢰가 중단되고 계정이 제한될 수 있어요."
] as const;

export class SafetyService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly persistence: PersistenceAdapter
  ) {}

  getCurrentRules() {
    return ok({
      rulesVersion: productConfig.rulesVersion,
      title: "안전하게 이용해주세요",
      items: [...ruleItems],
      requiresAcknowledgement: true
    });
  }

  async acknowledge(userId: string, rulesVersion: string, acknowledged: boolean, deviceHash?: string) {
    const user = this.store.users.get(userId);
    if (!user) {
      return fail("USER_NOT_FOUND", "사용자를 찾을 수 없어요.");
    }

    if (!acknowledged || rulesVersion !== productConfig.rulesVersion) {
      return fail("SAFETY_ACK_INVALID", "최신 안전수칙 확인이 필요해요.");
    }

    user.safetyAcknowledgedAt = nowIso();
    await this.persistence.upsertUser(user);
    return ok({
      acknowledgedAt: user.safetyAcknowledgedAt,
      reconfirmOnNextLogin: true,
      deviceHash: deviceHash ?? "unknown-device"
    });
  }
}
