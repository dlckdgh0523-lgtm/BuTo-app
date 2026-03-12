import { fail, ok, type PushSubscriptionRecord } from "../../../../packages/contracts/src/index.ts";

import type { PersistenceAdapter } from "../persistence.ts";
import type { InMemoryStore } from "../store.ts";
import { createId, nowIso } from "../utils.ts";

export class PushService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly persistence: PersistenceAdapter
  ) {}

  async listUserSubscriptions(userId: string) {
    const persisted = await this.persistence.listPushSubscriptionsByUser(userId);
    if (persisted) {
      for (const subscription of persisted) {
        this.store.pushSubscriptions.set(subscription.subscriptionId, subscription);
      }
    }

    return ok({
      items: [...this.store.pushSubscriptions.values()]
        .filter((subscription) => subscription.userId === userId)
        .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
    });
  }

  async registerSubscription(userId: string, payload: {
    provider: PushSubscriptionRecord["provider"];
    endpoint: string;
    authSecret?: string;
    p256dh?: string;
    deviceLabel?: string;
    subscriptionId?: string;
  }) {
    if (!payload.endpoint.trim()) {
      return fail("PUSH_ENDPOINT_REQUIRED", "푸시 수신 엔드포인트가 필요해요.");
    }

    const existing = [...this.store.pushSubscriptions.values()].find(
      (subscription) =>
        subscription.userId === userId &&
        subscription.provider === payload.provider &&
        subscription.endpoint === payload.endpoint
    );
    const timestamp = nowIso();
    const subscription: PushSubscriptionRecord = existing ?? {
      subscriptionId: payload.subscriptionId?.trim() || createId("push-sub"),
      userId,
      provider: payload.provider,
      endpoint: payload.endpoint.trim(),
      authSecret: payload.authSecret?.trim() || undefined,
      p256dh: payload.p256dh?.trim() || undefined,
      deviceLabel: payload.deviceLabel?.trim() || undefined,
      createdAt: timestamp,
      lastSeenAt: timestamp,
      failureCount: 0
    };

    subscription.provider = payload.provider;
    subscription.endpoint = payload.endpoint.trim();
    subscription.authSecret = payload.authSecret?.trim() || undefined;
    subscription.p256dh = payload.p256dh?.trim() || undefined;
    subscription.deviceLabel = payload.deviceLabel?.trim() || subscription.deviceLabel;
    subscription.lastSeenAt = timestamp;
    subscription.disabledAt = undefined;
    subscription.failureCount = 0;

    this.store.pushSubscriptions.set(subscription.subscriptionId, subscription);
    await this.persistence.withTransaction(async (tx) => {
      await tx.upsertPushSubscription(subscription);
    });

    return ok(subscription);
  }

  async disableSubscription(userId: string, subscriptionId: string) {
    const subscription = this.store.pushSubscriptions.get(subscriptionId);
    if (!subscription || subscription.userId !== userId) {
      return fail("PUSH_SUBSCRIPTION_NOT_FOUND", "푸시 구독 정보를 찾을 수 없어요.");
    }

    if (subscription.disabledAt) {
      return ok(subscription);
    }

    const disabledAt = nowIso();
    subscription.disabledAt = disabledAt;
    try {
      await this.persistence.withTransaction(async (tx) => {
        await tx.disablePushSubscription(subscriptionId, userId, disabledAt);
      });
    } catch (error) {
      subscription.disabledAt = undefined;
      throw error;
    }

    return ok(subscription);
  }
}
