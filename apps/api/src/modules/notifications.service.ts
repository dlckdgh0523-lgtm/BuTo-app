import { fail, ok } from "../../../../packages/contracts/src/index.ts";

import type { PersistenceAdapter } from "../persistence.ts";
import type { InMemoryStore } from "../store.ts";
import { nowIso } from "../utils.ts";

export class NotificationsService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly persistence: PersistenceAdapter
  ) {}

  async listUserNotifications(userId: string) {
    const persisted = await this.persistence.listNotificationsByUser(userId);
    if (persisted) {
      for (const notification of persisted) {
        this.store.notifications.set(notification.notificationId, notification);
      }
    }

    return ok({
      items: [...this.store.notifications.values()]
        .filter((notification) => notification.userId === userId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    });
  }

  async markNotificationRead(userId: string, notificationId: string) {
    const notification = this.store.notifications.get(notificationId);
    if (!notification || notification.userId !== userId) {
      return fail("NOTIFICATION_NOT_FOUND", "알림을 찾을 수 없어요.");
    }

    if (notification.readAt) {
      return ok(notification);
    }

    const readAt = nowIso();
    notification.readAt = readAt;
    try {
      await this.persistence.withTransaction(async (tx) => {
        await tx.markNotificationRead(notificationId, userId, readAt);
      });
    } catch (error) {
      notification.readAt = undefined;
      throw error;
    }

    return ok(notification);
  }
}
