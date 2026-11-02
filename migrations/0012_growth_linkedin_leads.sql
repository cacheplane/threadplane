create table growth_linkedin_posts (
  id uuid primary key default gen_random_uuid(),
  urn text unique,                       -- urn:li:activity:... or urn:li:share:...
  url text,
  marketing_post_id uuid references marketing_posts(id),
  first_seen_at timestamptz not null,
  check (urn is not null or url is not null)
);
create unique index growth_linkedin_posts_url on growth_linkedin_posts(url) where url is not null;

create table growth_linkedin_receipts (
  id text primary key,                   -- Resend email id
  recipient text not null,
  received_at timestamptz not null,
  source text not null default 'email' check (source in ('email','manual')),
  status text not null default 'pending' check (status in ('pending','parsed','unparsed')),
  kind text check (kind in ('comment','reply','reaction','repost','mention')),
  unparsed_reason text,
  sender text,
  headers jsonb,
  raw_subject text,
  raw_text text,
  raw_html text,
  forward_required boolean not null default false,
  forward_provider_id text,
  attempts integer not null default 0,
  last_error_code text,
  scrubbed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index growth_linkedin_receipts_forward_pending
  on growth_linkedin_receipts(received_at) where forward_required and forward_provider_id is null;
create index growth_linkedin_receipts_retention
  on growth_linkedin_receipts(received_at) where scrubbed_at is null and (raw_text is not null or raw_html is not null);

create table growth_linkedin_leads (
  id uuid primary key default gen_random_uuid(),
  profile_url text not null unique,
  display_name text not null,
  headline text not null default '',
  company_name text,
  source text not null default 'email' check (source in ('email','manual')),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  status text not null default 'new' check (status in ('new','approved','rejected','denied')),
  score integer not null default 0,
  decided_at timestamptz,
  decided_by text,
  approved_variant text check (approved_variant in ('connection','message')),
  approved_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index growth_linkedin_leads_status on growth_linkedin_leads(status, score desc, last_seen_at desc);

create table growth_linkedin_engagements (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references growth_linkedin_leads(id) on delete cascade,
  post_id uuid not null references growth_linkedin_posts(id),
  kind text not null check (kind in ('comment','reply','reaction','repost','mention')),
  comment_text text,
  comment_hash text not null default '',  -- sha256 hex of comment_text, '' when null
  occurred_at timestamptz not null,
  receipt_id text references growth_linkedin_receipts(id),
  created_at timestamptz not null default now(),
  unique (lead_id, post_id, kind, comment_hash)
);

create table growth_linkedin_deny (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('profile_url','company_name','company_domain')),
  value text not null,
  reason text,
  added_by text not null,
  added_at timestamptz not null default now(),
  removed_at timestamptz
);
create unique index growth_linkedin_deny_active on growth_linkedin_deny(kind, value) where removed_at is null;

-- Carries no actor identity by design.
create table growth_linkedin_drops (
  id uuid primary key default gen_random_uuid(),
  receipt_id text not null references growth_linkedin_receipts(id),
  deny_id uuid not null references growth_linkedin_deny(id),
  dropped_at timestamptz not null default now()
);

create table growth_linkedin_digests (
  business_date date primary key,
  job_id uuid not null references growth_jobs(id),
  sent_at timestamptz not null,
  lead_count integer not null,
  unparsed_count integer not null,
  drop_count integer not null,
  ingest_count integer not null
);
