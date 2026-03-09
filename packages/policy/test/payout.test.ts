import test from "node:test";
import assert from "node:assert/strict";

import { evaluatePayoutRelease } from "../src/payout.ts";

test("walk jobs can move to release ready after confirmation", () => {
  const result = evaluatePayoutRelease({
    job: { status: "COMPLETED", transportRequirement: "walk", riskLevel: "LOW" },
    hasDispute: false,
    hasReport: false,
    clientConfirmed: true,
    autoConfirmExpired: false
  });

  assert.equal(result.status, "RELEASE_READY");
  assert.equal(result.releasable, true);
});

test("vehicle jobs stay on hold for manual review", () => {
  const result = evaluatePayoutRelease({
    job: { status: "COMPLETED", transportRequirement: "vehicle", riskLevel: "LOW" },
    hasDispute: false,
    hasReport: false,
    clientConfirmed: true,
    autoConfirmExpired: true
  });

  assert.equal(result.status, "HOLD");
});

