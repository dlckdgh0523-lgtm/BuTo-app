import { ok } from "../../../../packages/contracts/src/index.ts";

import type { InMemoryStore } from "../store.ts";

export class AdminService {
  constructor(private readonly store: InMemoryStore) {}

  reviewQueue() {
    return ok({
      items: [...this.store.jobs.values()].filter((job) => job.requiresManualReview || job.riskLevel === "HIGH")
    });
  }

  disputeCenter() {
    return ok({
      items: [...this.store.jobs.values()].filter((job) => job.hasDispute || job.status === "DISPUTED")
    });
  }

  emergencyFeed() {
    return ok({
      items: [...this.store.emergencies.values()]
    });
  }

  documentsQueue() {
    return ok({
      items: [...this.store.users.values()]
        .filter((user) => user.roleFlags.includes("RUNNER"))
        .map((user) => ({
          userId: user.userId,
          nickname: user.nickname,
          businessVerified: user.businessVerified,
          vehicleTier: user.vehicleTier ?? "walk_only"
        }))
    });
  }

  payoutHolds() {
    return ok({
      items: [...this.store.jobs.values()].filter((job) => job.hasDispute || job.hasReport || job.riskLevel === "HIGH")
    });
  }

  policyDictionary() {
    return ok({
      blockedTerms: ["약", "담배", "술", "현금", "OTP"],
      reviewTerms: ["병원", "약국", "관공서", "법원", "경찰서"]
    });
  }
}

