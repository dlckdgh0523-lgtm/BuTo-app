alter table outbox_events
  add column if not exists claimed_at timestamptz,
  add column if not exists claimed_by text,
  add column if not exists claim_expires_at timestamptz;

create index if not exists idx_outbox_events_claimable
  on outbox_events (processed_at, claim_expires_at, available_at asc);
