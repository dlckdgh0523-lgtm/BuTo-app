import test from "node:test";
import assert from "node:assert/strict";

import { evaluateJobRisk } from "../src/risk-engine.ts";

test("banned errand text is blocked", () => {
  const result = evaluateJobRisk({
    title: "급하게 약 좀 받아주세요",
    description: "병원 앞에서 약 전달 부탁",
    pickup: { address: "A", lat: 0, lng: 0 },
    dropoff: { address: "B", lat: 0, lng: 0 },
    transportRequirement: "walk",
    offerAmount: 10000
  });

  assert.equal(result.disposition, "BLOCK");
});

test("high amount vehicle job is reviewed", () => {
  const result = evaluateJobRisk({
    title: "짐 옮겨주세요",
    description: "관공서 근처에서 픽업",
    pickup: { address: "A", lat: 0, lng: 0 },
    dropoff: { address: "B", lat: 0, lng: 0 },
    transportRequirement: "vehicle",
    offerAmount: 180000
  });

  assert.equal(result.disposition, "REVIEW");
});

