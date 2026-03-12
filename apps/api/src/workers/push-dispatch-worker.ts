import { loadApiRuntimeConfig, validateApiRuntimeConfig, validateDatabaseEnv } from "../env.ts";
import { PostgresPersistenceAdapter } from "../persistence.ts";
import { createStore } from "../bootstrap.ts";
import { createId, nowIso } from "../utils.ts";
import { createPushProvider, shouldDispatchPush } from "./push-provider.ts";
import { persistWorkerFailureNotifications } from "./worker-alerts.ts";

function ensureSupportFallback(
  store: ReturnType<typeof createStore>,
  input: {
    userId: string;
    sourceNotificationId: string;
    reasonCode: "NO_ACTIVE_PUSH_SUBSCRIPTION" | "PUSH_DELIVERY_DISABLED" | "PUSH_DELIVERY_REPEATED_FAILURE";
    reasonMessage: string;
  }
) {
  const existing = [...store.supportFallbacks.values()].find(
    (fallback) =>
      fallback.userId === input.userId &&
      fallback.sourceNotificationId === input.sourceNotificationId &&
      fallback.status === "OPEN"
  );
  if (existing) {
    return existing;
  }

  const fallback = {
    fallbackId: createId("support"),
    userId: input.userId,
    sourceNotificationId: input.sourceNotificationId,
    channel: "KAKAO_CHANNEL" as const,
    status: "OPEN" as const,
    reasonCode: input.reasonCode,
    reasonMessage: input.reasonMessage,
    createdAt: nowIso()
  };
  store.supportFallbacks.set(fallback.fallbackId, fallback);
  return fallback;
}

const runtimeConfig = loadApiRuntimeConfig();
const runtimeValidation = validateApiRuntimeConfig(runtimeConfig);
if (!runtimeValidation.ok) {
  throw new Error(`Invalid BUTO runtime env: ${runtimeValidation.issues.join(", ")}`);
}

const databaseValidation = validateDatabaseEnv(runtimeConfig);
if (!databaseValidation.ok || !runtimeConfig.databaseUrl) {
  throw new Error(`Missing BUTO database env: ${databaseValidation.issues.join(", ")}`);
}

const persistence = new PostgresPersistenceAdapter(runtimeConfig.databaseUrl);
const provider = createPushProvider(runtimeConfig);
const workerKey = "push-dispatch-worker";
const startedAt = nowIso();

try {
  await persistence.upsertWorkerHeartbeat({
    workerKey,
    lastStartedAt: startedAt,
    lastStatus: "RUNNING",
    lastSummary: {
      provider: runtimeConfig.pushProvider
    }
  });
  const store = createStore();
  await persistence.hydrate(store);
  let processed = 0;

  for (const notification of store.notifications.values()) {
    if (!shouldDispatchPush(notification) || notification.readAt) {
      continue;
    }

    const hasActiveSubscription = [...store.pushSubscriptions.values()].some(
      (subscription) => subscription.userId === notification.userId && !subscription.disabledAt
    );
    if (!hasActiveSubscription) {
      const fallback = ensureSupportFallback(store, {
        userId: notification.userId,
        sourceNotificationId: notification.notificationId,
        reasonCode: "NO_ACTIVE_PUSH_SUBSCRIPTION",
        reasonMessage: "푸시 수신 채널이 없어 카카오톡 상담 채널 안내로 대체했어요."
      });
      await persistence.upsertSupportFallback(fallback);
    }
  }

  const deliveries = await persistence.listPendingPushDeliveries(runtimeConfig.pushDispatchBatchSize);

  for (const delivery of deliveries) {
    const subscription = store.pushSubscriptions.get(delivery.subscription.subscriptionId) ?? delivery.subscription;
    const notification = store.notifications.get(delivery.notification.notificationId) ?? delivery.notification;

    if (!shouldDispatchPush(notification)) {
      const attempt = {
        deliveryAttemptId: createId("push-attempt"),
        notificationId: notification.notificationId,
        subscriptionId: subscription.subscriptionId,
        provider: subscription.provider,
        status: "SKIPPED" as const,
        attemptedAt: nowIso(),
        errorMessage: "CATEGORY_SKIPPED"
      };
      store.pushDeliveryAttempts.set(attempt.deliveryAttemptId, attempt);
      await persistence.appendPushDeliveryAttempt(attempt);
      processed += 1;
      continue;
    }

    try {
      const deliveryAttemptId = createId("push-attempt");
      const result = await provider.send({
        deliveryAttemptId,
        subscription,
        notification
      });

      const attempt = {
        deliveryAttemptId,
        notificationId: notification.notificationId,
        subscriptionId: subscription.subscriptionId,
        provider: subscription.provider,
        status: "SUCCESS" as const,
        attemptedAt: nowIso(),
        providerMessageId: result.providerMessageId
      };
      subscription.failureCount = 0;
      subscription.lastSeenAt = attempt.attemptedAt;
      store.pushSubscriptions.set(subscription.subscriptionId, subscription);
      store.pushDeliveryAttempts.set(attempt.deliveryAttemptId, attempt);
      await persistence.withTransaction(async (tx) => {
        await tx.upsertPushSubscription(subscription);
        await tx.appendPushDeliveryAttempt(attempt);
      });
      processed += 1;
    } catch (error) {
      const deliveryAttemptId = createId("push-attempt");
      subscription.failureCount += 1;
      subscription.lastSeenAt = nowIso();
      if (subscription.failureCount >= 3) {
        subscription.disabledAt = subscription.lastSeenAt;
      }

      const attempt = {
        deliveryAttemptId,
        notificationId: notification.notificationId,
        subscriptionId: subscription.subscriptionId,
        provider: subscription.provider,
        status: "FAILED" as const,
        attemptedAt: subscription.lastSeenAt,
        errorMessage: error instanceof Error ? error.message : "unknown"
      };

      store.pushSubscriptions.set(subscription.subscriptionId, subscription);
      store.pushDeliveryAttempts.set(attempt.deliveryAttemptId, attempt);
      const fallback = ensureSupportFallback(store, {
        userId: notification.userId,
        sourceNotificationId: notification.notificationId,
        reasonCode: subscription.disabledAt ? "PUSH_DELIVERY_DISABLED" : "PUSH_DELIVERY_REPEATED_FAILURE",
        reasonMessage: subscription.disabledAt
          ? "푸시 전달이 반복 실패해 카카오톡 상담 채널 안내로 전환했어요."
          : "푸시 전달 실패가 발생해 카카오톡 상담 채널 안내를 준비했어요."
      });
      store.supportFallbacks.set(fallback.fallbackId, fallback);
      await persistence.withTransaction(async (tx) => {
        await tx.upsertPushSubscription(subscription);
        await tx.appendPushDeliveryAttempt(attempt);
        await tx.upsertSupportFallback(fallback);
      });
      processed += 1;
    }
  }
  await persistence.upsertWorkerHeartbeat({
    workerKey,
    lastStartedAt: startedAt,
    lastCompletedAt: nowIso(),
    lastStatus: "SUCCESS",
    lastSummary: {
      provider: runtimeConfig.pushProvider,
      processed
    }
  });
} catch (error) {
  await persistence.upsertWorkerHeartbeat({
    workerKey,
    lastStartedAt: startedAt,
    lastCompletedAt: nowIso(),
    lastStatus: "FAILED",
    lastSummary: {
      provider: runtimeConfig.pushProvider,
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
