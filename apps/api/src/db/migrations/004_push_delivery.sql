create table if not exists push_subscriptions (
  subscription_id text primary key,
  user_id text not null references users(user_id),
  provider text not null check (provider in ('WEBHOOK', 'FCM', 'APNS')),
  endpoint text not null,
  auth_secret text,
  p256dh text,
  device_label text,
  created_at timestamptz not null,
  last_seen_at timestamptz not null,
  disabled_at timestamptz,
  failure_count integer not null default 0
);

create index if not exists idx_push_subscriptions_user_active
  on push_subscriptions (user_id, disabled_at, last_seen_at desc);

create table if not exists push_delivery_attempts (
  delivery_attempt_id text primary key,
  notification_id text not null references notifications(notification_id),
  subscription_id text not null references push_subscriptions(subscription_id),
  provider text not null check (provider in ('WEBHOOK', 'FCM', 'APNS')),
  status text not null check (status in ('SUCCESS', 'FAILED', 'SKIPPED')),
  attempted_at timestamptz not null,
  provider_message_id text,
  error_message text
);

create unique index if not exists idx_push_delivery_attempts_once_per_subscription_notification
  on push_delivery_attempts (notification_id, subscription_id);
