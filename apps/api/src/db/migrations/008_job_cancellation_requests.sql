create table if not exists job_cancellation_requests (
  cancellation_request_id text primary key,
  job_id text not null references jobs (job_id) on delete cascade,
  requested_by_user_id text not null references users (user_id),
  requester_role text not null,
  reason text not null,
  status text not null,
  requested_at timestamptz not null,
  responded_at timestamptz,
  response_by_user_id text references users (user_id),
  response_note text,
  refund_reason_normalized text
);

create index if not exists idx_job_cancellation_requests_job_requested_at
  on job_cancellation_requests (job_id, requested_at desc);
