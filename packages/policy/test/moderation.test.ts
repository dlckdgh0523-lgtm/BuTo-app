import test from "node:test";
import assert from "node:assert/strict";

import { moderateChatMessage } from "../src/moderation.ts";

test("severe chat content locks the flow after pickup", () => {
  const result = moderateChatMessage("현금이랑 otp도 같이 보내주세요", "PICKED_UP");
  assert.equal(result.status, "SEVERE_BLOCK");
  assert.equal(result.actionTaken, "FORCE_DISPUTE_AND_HOLD_PAYOUT");
});

test("warning content still delivers", () => {
  const result = moderateChatMessage("공동현관 비밀번호 알려주세요", "MATCHED");
  assert.equal(result.status, "WARN");
});

