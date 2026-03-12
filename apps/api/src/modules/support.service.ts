import { fail, ok } from "../../../../packages/contracts/src/index.ts";

import type { PersistenceAdapter } from "../persistence.ts";
import type { InMemoryStore } from "../store.ts";
import { nowIso } from "../utils.ts";

export class SupportService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly persistence: PersistenceAdapter
  ) {}

  async listUserFallbacks(userId: string) {
    const persisted = await this.persistence.listSupportFallbacksByUser(userId);
    if (persisted) {
      for (const fallback of persisted) {
        this.store.supportFallbacks.set(fallback.fallbackId, fallback);
      }
    }

    return ok({
      items: [...this.store.supportFallbacks.values()]
        .filter((fallback) => fallback.userId === userId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    });
  }

  async acknowledgeFallback(userId: string, fallbackId: string) {
    const fallback = this.store.supportFallbacks.get(fallbackId);
    if (!fallback || fallback.userId !== userId) {
      return fail("SUPPORT_FALLBACK_NOT_FOUND", "상담 안내 내역을 찾을 수 없어요.");
    }

    if (fallback.status === "ACKNOWLEDGED") {
      return ok(fallback);
    }

    const acknowledgedAt = nowIso();
    fallback.status = "ACKNOWLEDGED";
    fallback.acknowledgedAt = acknowledgedAt;
    try {
      await this.persistence.withTransaction(async (tx) => {
        await tx.acknowledgeSupportFallback(fallbackId, userId, acknowledgedAt);
      });
    } catch (error) {
      fallback.status = "OPEN";
      fallback.acknowledgedAt = undefined;
      throw error;
    }

    return ok(fallback);
  }
}
