import { loadApiRuntimeConfig, validateDatabaseEnv } from "../env.ts";
import { PostgresPersistenceAdapter } from "../persistence.ts";
import { createStore } from "../bootstrap.ts";
import { buildNotificationsForOutboxEvent } from "./notification-projector.ts";
import { persistWorkerFailureNotifications } from "./worker-alerts.ts";

const runtimeConfig = loadApiRuntimeConfig();
const databaseValidation = validateDatabaseEnv(runtimeConfig);
if (!databaseValidation.ok || !runtimeConfig.databaseUrl) {
  throw new Error(`Missing BUTO database env: ${databaseValidation.issues.join(", ")}`);
}

const persistence = new PostgresPersistenceAdapter(runtimeConfig.databaseUrl);
const workerId = `outbox-worker:${process.pid}`;
const workerKey = "outbox-worker";
const startedAt = new Date().toISOString();

try {
  await persistence.upsertWorkerHeartbeat({
    workerKey,
    lastStartedAt: startedAt,
    lastStatus: "RUNNING",
    lastSummary: {
      workerId
    }
  });
  const store = createStore();
  await persistence.hydrate(store);
  const events = await persistence.claimOutboxEvents(
    runtimeConfig.outboxBatchSize,
    workerId,
    runtimeConfig.outboxLeaseSeconds
  );

  for (const event of events) {
    const notifications = buildNotificationsForOutboxEvent(store, event);
    for (const notification of notifications) {
      store.notifications.set(notification.notificationId, notification);
      await persistence.upsertNotification(notification);
    }

    console.log(
      JSON.stringify({
        level: "info",
        action: "OUTBOX_EVENT_PROCESSED",
        eventId: event.eventId,
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        notificationCount: notifications.length
      })
    );

    await persistence.markOutboxEventProcessed(event.eventId, workerId, {
      worker: "outbox-worker",
      processedAt: new Date().toISOString(),
      notificationCount: notifications.length
    });
  }
  await persistence.upsertWorkerHeartbeat({
    workerKey,
    lastStartedAt: startedAt,
    lastCompletedAt: new Date().toISOString(),
    lastStatus: "SUCCESS",
    lastSummary: {
      workerId,
      processedEvents: events.length
    }
  });
} catch (error) {
  await persistence.upsertWorkerHeartbeat({
    workerKey,
    lastStartedAt: startedAt,
    lastCompletedAt: new Date().toISOString(),
    lastStatus: "FAILED",
    lastSummary: {
      workerId,
      error: error instanceof Error ? error.message : "unknown"
    }
  });
  const store = createStore();
  await persistence.hydrate(store);
  await persistWorkerFailureNotifications({
    store,
    persistence,
    workerKey,
    startedAt,
    errorMessage: error instanceof Error ? error.message : "unknown"
  });
  throw error;
} finally {
  await persistence.close();
}
