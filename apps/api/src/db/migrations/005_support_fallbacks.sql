create table if not exists support_fallbacks (
  fallback_id text primary key,
  user_id text not null references users(user_id),
  source_notification_id text not null references notifications(notification_id),
  channel text not null check (channel in ('KAKAO_CHANNEL')),
  status text not null check (status in ('OPEN', 'ACKNOWLEDGED')),
  reason_code text not null check (
    reason_code in (
      'NO_ACTIVE_PUSH_SUBSCRIPTION',
      'PUSH_DELIVERY_DISABLED',
      'PUSH_DELIVERY_REPEATED_FAILURE'
    )
  ),
  reason_message text not null,
  created_at timestamptz not null,
  acknowledged_at timestamptz
);

create unique index if not exists idx_support_fallbacks_open_by_notification
  on support_fallbacks (source_notification_id)
  where status = 'OPEN';

create index if not exists idx_support_fallbacks_user_created
  on support_fallbacks (user_id, created_at desc);
