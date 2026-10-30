CREATE TABLE marketing_weeks (
  id uuid PRIMARY KEY,
  week_start date NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('drafting', 'approved')),
  approved_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE marketing_posts (
  id uuid PRIMARY KEY,
  week_id uuid REFERENCES marketing_weeks(id),
  channel text NOT NULL CHECK (channel IN ('x', 'linkedin', 'devto', 'blog')),
  kind text NOT NULL CHECK (kind IN ('release', 'qa', 'news', 'guide', 'take')),
  status text NOT NULL CHECK (status IN ('draft', 'scheduled', 'posting', 'posted', 'failed', 'cancelled')),
  publish_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  media jsonb NOT NULL DEFAULT '[]',
  source_refs jsonb NOT NULL DEFAULT '[]',
  depends_on uuid REFERENCES marketing_posts(id),
  utm_campaign text,
  idempotency_key text NOT NULL UNIQUE,
  confirmed_flags jsonb NOT NULL DEFAULT '[]',
  lease_token uuid,
  lease_expires_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  deploy_requested_at timestamptz,
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX marketing_posts_due ON marketing_posts(publish_at) WHERE status = 'scheduled';

CREATE TABLE marketing_post_revisions (
  id uuid PRIMARY KEY,
  post_id uuid NOT NULL REFERENCES marketing_posts(id),
  before jsonb NOT NULL,
  after jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE marketing_channel_credentials (
  channel text PRIMARY KEY CHECK (channel IN ('x', 'linkedin', 'devto')),
  sealed text NOT NULL,
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE marketing_post_metrics (
  post_id uuid NOT NULL REFERENCES marketing_posts(id),
  fetched_at timestamptz NOT NULL,
  metrics jsonb NOT NULL,
  PRIMARY KEY (post_id, fetched_at)
);

CREATE TABLE marketing_alerts (
  key text PRIMARY KEY,
  sent_at timestamptz NOT NULL DEFAULT now()
);
