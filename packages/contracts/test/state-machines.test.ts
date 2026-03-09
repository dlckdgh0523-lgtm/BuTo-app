import test from "node:test";
import assert from "node:assert/strict";

import { getAllowedTransitions, isValidJobTransition } from "../src/state-machines.ts";

test("matched jobs can be disputed by the system", () => {
  assert.equal(isValidJobTransition("MATCHED", "DISPUTED", "SYSTEM"), true);
});

test("picked up jobs cannot be cancelled by the client", () => {
  assert.equal(isValidJobTransition("PICKED_UP", "CANCELLED", "CLIENT"), false);
});

test("admin can settle disputed jobs into completed", () => {
  assert.deepEqual(getAllowedTransitions("DISPUTED", "ADMIN"), [
    "COMPLETED",
    "CANCELLED",
    "FAILED_SETTLEMENT"
  ]);
});

