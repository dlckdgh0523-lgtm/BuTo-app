import type { NotificationRecord, PushSubscriptionRecord } from "../../../../packages/contracts/src/index.ts";

import type { ApiRuntimeConfig } from "../env.ts";
import { signValue } from "../utils.ts";

export interface PushDispatchResult {
  providerMessageId?: string;
}

export interface PushProvider {
  send(input: {
    deliveryAttemptId: string;
    subscription: PushSubscriptionRecord;
    notification: NotificationRecord;
  }): Promise<PushDispatchResult>;
}

class LogPushProvider implements PushProvider {
  async send(input: { deliveryAttemptId: string; subscription: PushSubscriptionRecord; notification: NotificationRecord }) {
    console.log(
      JSON.stringify({
        level: "info",
        action: "PUSH_DISPATCH_LOGGED",
        deliveryAttemptId: input.deliveryAttemptId,
        subscriptionId: input.subscription.subscriptionId,
        provider: input.subscription.provider,
        notificationId: input.notification.notificationId,
        category: input.notification.category
      })
    );

    return {
      providerMessageId: `log:${input.notification.notificationId}`
    };
  }
}

class WebhookPushProvider implements PushProvider {
  constructor(
    private readonly webhookUrl: string,
    private readonly webhookSecret: string
  ) {}

  async send(input: { deliveryAttemptId: string; subscription: PushSubscriptionRecord; notification: NotificationRecord }) {
    const payload = JSON.stringify(input);
    const timestamp = new Date().toISOString();
    const signature = createPushWebhookSignature(payload, timestamp, this.webhookSecret);
    const response = await fetch(this.webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-buto-delivery-attempt-id": input.deliveryAttemptId,
        "x-buto-timestamp": timestamp,
        "x-buto-signature": signature
      },
      body: payload
    });

    if (!response.ok) {
      throw new Error(`Webhook push dispatch failed with ${response.status}`);
    }

    return {
      providerMessageId: response.headers.get("x-message-id") ?? `webhook:${input.notification.notificationId}`
    };
  }
}

export function createPushProvider(runtimeConfig: ApiRuntimeConfig): PushProvider {
  if (runtimeConfig.pushProvider === "webhook") {
    if (!runtimeConfig.pushWebhookUrl || !runtimeConfig.pushWebhookSecret) {
      throw new Error("BUTO_PUSH_WEBHOOK_URL and BUTO_PUSH_WEBHOOK_SECRET are required when BUTO_PUSH_PROVIDER=webhook");
    }

    return new WebhookPushProvider(runtimeConfig.pushWebhookUrl, runtimeConfig.pushWebhookSecret);
  }

  return new LogPushProvider();
}

export function shouldDispatchPush(notification: NotificationRecord) {
  return notification.category === "ACCOUNT" || notification.category === "SAFETY" || notification.category === "TRANSACTION";
}

export function createPushWebhookSignature(payload: string, timestamp: string, secret: string) {
  return signValue(`${timestamp}.${payload}`, secret);
}
