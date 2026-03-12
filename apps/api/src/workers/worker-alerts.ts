import type { NotificationRecord } from "../../../../packages/contracts/src/index.ts";

import type { PersistenceAdapter } from "../persistence.ts";
import type { InMemoryStore } from "../store.ts";

export async function persistWorkerFailureNotifications(input: {
  store: InMemoryStore;
  persistence: PersistenceAdapter;
  workerKey: string;
  startedAt: string;
  errorMessage: string;
}) {
  const eventId = `worker-failure:${input.workerKey}:${input.startedAt}`;
  const admins = [...input.store.users.values()].filter(
    (user) => user.roleFlags.includes("ADMIN") && user.status === "ACTIVE"
  );

  for (const admin of admins) {
    const notification: NotificationRecord = {
      notificationId: `${eventId}:${admin.userId}`,
      userId: admin.userId,
      channel: "IN_APP",
      category: "ACCOUNT",
      title: `worker 실패: ${input.workerKey}`,
      body: `백그라운드 작업이 실패했어요. ${input.errorMessage}`,
      deepLink: "/home?panel=admin-workers",
      relatedEntityType: "USER",
      relatedEntityId: admin.userId,
      triggeredByEventId: eventId,
      createdAt: input.startedAt
    };
    input.store.notifications.set(notification.notificationId, notification);
    await input.persistence.upsertNotification(notification);
  }
}
