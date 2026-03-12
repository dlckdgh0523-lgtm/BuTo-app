alter table users
  add column if not exists toss_user_key text;

create unique index if not exists idx_users_toss_user_key
  on users (toss_user_key)
  where toss_user_key is not null;

alter table payments
  add column if not exists fee_amount integer not null default 0,
  add column if not exists pay_token text,
  add column if not exists transaction_id text,
  add column if not exists provider_payment_method text,
  add column if not exists provider_status text,
  add column if not exists refundable_amount integer;

create unique index if not exists idx_payments_pay_token
  on payments (pay_token)
  where pay_token is not null;
