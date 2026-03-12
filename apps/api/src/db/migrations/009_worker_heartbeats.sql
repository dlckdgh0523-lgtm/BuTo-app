create table if not exists worker_heartbeats (
  worker_key text primary key,
  last_started_at timestamptz not null,
  last_completed_at timestamptz,
  last_status text not null,
  last_summary jsonb
);
