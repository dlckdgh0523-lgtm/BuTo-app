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

create table if not exists users (
  user_id text primary key,
  ci_hash text not null unique,
  nickname text not null,
  adult_verified boolean not null default false,
  status account_status not null default 'ACTIVE',
  role_flags text[] not null default '{}',
  safety_acknowledged_at timestamptz,
  runner_verified boolean not null default false,
  risk_score integer not null default 0,
  transport_mode text,
  vehicle_tier text,
  business_verified boolean not null default false,
  payout_account_verified boolean not null default false,
  active_jobs integer not null default 0,
  last_active_at timestamptz not null default now(),
  restriction_source text check (restriction_source in ('AI_MODERATION', 'ADMIN_POLICY', 'SELF_WITHDRAWAL')),
  restriction_reason_code text,
  restriction_reason_message text,
  restriction_scope enforcement_scope,
  restriction_review_status enforcement_review_status,
  restriction_action_id text,
  restriction_updated_at timestamptz,
  withdrawn_at timestamptz
);

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

create table if not exists enforcement_evidence_bundles (
  evidence_bundle_id text primary key,
  user_id text not null references users(user_id),
  source_action_id text not null references user_enforcement_actions(action_id),
  evidence_type text not null check (evidence_type in ('CHAT_MESSAGE', 'ADMIN_NOTE', 'PAYMENT_RISK', 'LOCATION_PROOF', 'SYSTEM_EVENT')),
  summary text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

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

create table if not exists appeal_review_actions (
  review_action_id text primary key,
  appeal_id text not null references user_appeals(appeal_id),
  action_id text not null references user_enforcement_actions(action_id),
  reviewer_user_id text not null references users(user_id),
  decision appeal_decision not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  audit_id text primary key,
  actor_user_id text not null,
  action text not null,
  entity_type text not null check (entity_type in ('JOB', 'USER')),
  entity_id text not null,
  note text,
  before_payload jsonb,
  after_payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_entity_created
  on audit_logs (entity_type, entity_id, created_at desc);

create table if not exists jobs (
  job_id text primary key,
  client_user_id text not null references users(user_id),
  title text not null,
  description text not null,
  pickup jsonb not null,
  dropoff jsonb not null,
  transport_requirement text not null,
  vehicle_tier_required text,
  offer_amount integer not null,
  requested_start_at timestamptz,
  attachments jsonb not null default '[]'::jsonb,
  urgent boolean not null default false,
  status text not null,
  risk_level text not null,
  requires_manual_review boolean not null default false,
  payment_init_required boolean not null default true,
  matched_runner_user_id text references users(user_id),
  chat_room_id text,
  has_report boolean not null default false,
  has_dispute boolean not null default false,
  client_confirmed boolean not null default false,
  auto_confirm_expired boolean not null default false
);

create index if not exists idx_jobs_status on jobs (status);

create table if not exists payments (
  payment_id text primary key,
  job_id text not null references jobs(job_id),
  user_id text not null references users(user_id),
  order_id text not null unique,
  status text not null,
  amount_total integer not null,
  held_amount integer not null,
  approved_at timestamptz
);

create table if not exists reports (
  report_id text primary key,
  job_id text references jobs(job_id),
  reporter_user_id text not null references users(user_id),
  target_user_id text not null references users(user_id),
  report_type text not null,
  detail text,
  created_at timestamptz not null default now()
);

create table if not exists emergencies (
  emergency_event_id text primary key,
  job_id text not null references jobs(job_id),
  event_type text not null,
  lat double precision not null,
  lng double precision not null,
  created_at timestamptz not null default now()
);

create table if not exists location_logs (
  log_id bigserial primary key,
  job_id text not null references jobs(job_id),
  user_id text not null references users(user_id),
  role text not null,
  lat double precision not null,
  lng double precision not null,
  accuracy double precision not null,
  source text not null,
  logged_at timestamptz not null
);

create index if not exists idx_location_logs_job_logged
  on location_logs (job_id, logged_at asc);

create table if not exists proof_photos (
  proof_id text primary key,
  job_id text not null references jobs(job_id),
  uploaded_by text not null references users(user_id),
  proof_type text not null,
  s3_key text not null,
  watermarked_url text not null,
  created_at timestamptz not null default now()
);

create table if not exists idempotency_cache (
  cache_key text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists login_states (
  state text primary key,
  created_at timestamptz not null,
  expires_at timestamptz not null
);

create table if not exists refresh_sessions (
  refresh_token text primary key,
  user_id text not null references users(user_id),
  issued_at timestamptz not null,
  expires_at timestamptz not null
);

create index if not exists idx_refresh_sessions_user_issued
  on refresh_sessions (user_id, issued_at asc);

create table if not exists face_auth_sessions (
  face_auth_session_id text primary key,
  user_id text not null references users(user_id),
  job_draft_id text,
  intent text not null,
  provider text not null,
  provider_request_id text,
  request_url text,
  tx_id text,
  toss_face_tx_id text,
  verified_at timestamptz,
  consumed_at timestamptz,
  expires_at timestamptz not null
);

create table if not exists chat_rooms (
  room_id text primary key,
  job_id text not null references jobs(job_id),
  status text not null,
  created_at timestamptz not null
);

create table if not exists chat_messages (
  message_id text primary key,
  room_id text not null references chat_rooms(room_id),
  sender_user_id text not null references users(user_id),
  message_type text not null,
  body text not null,
  moderation_status text not null,
  action_taken text not null,
  created_at timestamptz not null
);

create index if not exists idx_chat_messages_room_created
  on chat_messages (room_id, created_at asc);

create table if not exists reviews (
  review_id text primary key,
  job_id text not null references jobs(job_id),
  author_user_id text not null references users(user_id),
  target_user_id text not null references users(user_id),
  rating_value integer not null,
  body text not null,
  created_at timestamptz not null
);

create table if not exists community_posts (
  post_id text primary key,
  author_user_id text not null references users(user_id),
  title text not null,
  body text not null,
  image_url text,
  created_at timestamptz not null
);

create table if not exists outbox_events (
  event_id text primary key,
  aggregate_type text not null,
  aggregate_id text not null,
  event_type text not null,
  payload jsonb not null,
  available_at timestamptz not null,
  processed_at timestamptz,
  result_payload jsonb
);

create index if not exists idx_outbox_events_pending
  on outbox_events (processed_at, available_at asc);
