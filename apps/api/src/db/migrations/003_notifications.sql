create table if not exists notifications (
  notification_id text primary key,
  user_id text not null references users(user_id),
  channel text not null check (channel in ('IN_APP')),
  category text not null check (category in ('SAFETY', 'TRANSACTION', 'ACCOUNT', 'CHAT')),
  title text not null,
  body text not null,
  deep_link text,
  related_entity_type text check (related_entity_type in ('JOB', 'APPEAL', 'USER', 'CHAT_ROOM')),
  related_entity_id text,
  triggered_by_event_id text not null,
  created_at timestamptz not null,
  read_at timestamptz
);

create index if not exists idx_notifications_user_created
  on notifications (user_id, created_at desc);
