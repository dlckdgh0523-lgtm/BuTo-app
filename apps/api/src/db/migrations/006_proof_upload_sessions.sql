create table if not exists proof_upload_sessions (
  upload_session_id text primary key,
  job_id text not null references jobs(job_id),
  user_id text not null references users(user_id),
  proof_type text not null,
  source text not null,
  object_key text not null,
  status text not null,
  local_asset_path text,
  mime_type text,
  image_id text,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  uploaded_at timestamptz,
  completed_at timestamptz
);

create index if not exists idx_proof_upload_sessions_job_created
  on proof_upload_sessions (job_id, created_at asc);

create index if not exists idx_proof_upload_sessions_user_created
  on proof_upload_sessions (user_id, created_at asc);
