-- BUTO enforcement and appeals schema
-- PostgreSQL-oriented reference schema.
-- Users remain in the users table. Current account availability is controlled by users.status.

create type account_status as enum (
  'ACTIVE',
  'RESTRICTED',
  'SUSPENDED',
  'APPEAL_PENDING',
  'REINSTATED',
  'PERMANENTLY_BANNED',
  'WITHDRAWN'
);

create type enforcement_scope as enum (
  'ACCOUNT_FULL',
  'CHAT_ONLY',
  'MATCHING_DISABLED',
  'PAYOUT_HOLD'
);

create type enforcement_review_status as enum (
  'AUTO_APPLIED',
  'UNDER_REVIEW',
  'APPEAL_PENDING',
  'MORE_INFO_REQUESTED',
  'UPHELD',
  'REINSTATED'
);

create type appeal_status as enum (
  'SUBMITTED',
  'MORE_INFO_REQUESTED',
  'APPROVED',
  'REJECTED'
);

create type appeal_decision as enum (
  'APPROVE',
  'REJECT',
  'REQUEST_MORE_INFO'
);

alter table users
  add column if not exists status account_status not null default 'ACTIVE',
  add column if not exists restriction_reason_code text,
  add column if not exists restriction_reason_message text,
  add column if not exists restriction_scope enforcement_scope,
  add column if not exists restriction_review_status enforcement_review_status,
  add column if not exists restriction_action_id text,
  add column if not exists restriction_updated_at timestamptz,
  add column if not exists withdrawn_at timestamptz;

create index if not exists idx_users_status on users (status);

create table if not exists user_enforcement_actions (
  action_id text primary key,
  user_id text not null references users(user_id),
  status_applied account_status not null,
  source text not null check (source in ('AI_MODERATION', 'ADMIN_POLICY')),
  scope enforcement_scope not null,
  review_status enforcement_review_status not null,
  reason_code text not null,
  reason_message text not null,
  appeal_eligible boolean not null default true,
  evidence_bundle_id text not null,
  created_at timestamptz not null default now(),
  lifted_at timestamptz,
  lifted_by_action_id text
);

create index if not exists idx_user_enforcement_actions_user_created
  on user_enforcement_actions (user_id, created_at desc);

create index if not exists idx_user_enforcement_actions_review_status
  on user_enforcement_actions (review_status);

create table if not exists enforcement_evidence_bundles (
  evidence_bundle_id text primary key,
  user_id text not null references users(user_id),
  source_action_id text not null references user_enforcement_actions(action_id),
  evidence_type text not null check (evidence_type in ('CHAT_MESSAGE', 'ADMIN_NOTE', 'PAYMENT_RISK', 'LOCATION_PROOF', 'SYSTEM_EVENT')),
  summary text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_enforcement_evidence_bundles_user_created
  on enforcement_evidence_bundles (user_id, created_at desc);

create table if not exists user_appeals (
  appeal_id text primary key,
  user_id text not null references users(user_id),
  action_id text not null references user_enforcement_actions(action_id),
  appeal_text text not null,
  status appeal_status not null,
  submitted_at timestamptz not null default now(),
  last_updated_at timestamptz not null default now()
);

create unique index if not exists idx_user_appeals_one_open_per_action
  on user_appeals (action_id)
  where status in ('SUBMITTED', 'MORE_INFO_REQUESTED');

create index if not exists idx_user_appeals_user_submitted
  on user_appeals (user_id, submitted_at desc);

create table if not exists appeal_review_actions (
  review_action_id text primary key,
  appeal_id text not null references user_appeals(appeal_id),
  action_id text not null references user_enforcement_actions(action_id),
  reviewer_user_id text not null references users(user_id),
  decision appeal_decision not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_appeal_review_actions_appeal_created
  on appeal_review_actions (appeal_id, created_at asc);

-- Important operational rule:
-- Do not move suspended or banned users to a different table.
-- Reinstatement changes users.status and appends review/audit history.
