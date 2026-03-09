import test from "node:test";
import assert from "node:assert/strict";

import { maskSensitiveText } from "../src/masking.ts";

test("masks phone numbers adjacent to Korean text", () => {
  const result = maskSensitiveText("문의는연락처010-1234-5678로주세요");
  assert.match(result, /\[masked-phone\]/);
});

test("does not over-mask dates as account numbers", () => {
  const result = maskSensitiveText("방문일은 03-09-2026 입니다.");
  assert.equal(result, "방문일은 03-09-2026 입니다.");
});
