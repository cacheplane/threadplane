-- Receiving state is opt-in. No DNS or provider configuration is performed here.
CREATE TABLE growth_reply_mailboxes (
  address text PRIMARY KEY CHECK (address = 'brian@threadplane.ai'),
  enabled boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL,
  recovery_id uuid,
  scan_cursor text,
  scan_head_id text,
  covered_head_id text,
  scan_started_at timestamptz,
  scan_complete boolean NOT NULL DEFAULT false,
  google_retired_at timestamptz,
  healthy_through timestamptz,
  CHECK (healthy_through IS NULL OR healthy_through >= started_at)
);

CREATE TABLE growth_reply_receipts (
  id text PRIMARY KEY,
  recipient text NOT NULL REFERENCES growth_reply_mailboxes(address),
  received_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'stopped', 'ignored')),
  contact_id uuid REFERENCES growth_contacts(id),
  rfc_message_id text,
  reference_ids jsonb,
  attempts integer NOT NULL DEFAULT 0,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX growth_reply_receipts_pending
  ON growth_reply_receipts(recipient, created_at, id) WHERE status = 'pending';
CREATE UNIQUE INDEX growth_reply_receipts_rfc
  ON growth_reply_receipts(recipient, rfc_message_id)
  WHERE rfc_message_id IS NOT NULL;
-- Persist only identifiers and digests, never rendered email content.
CREATE TABLE growth_provider_attempts (
  idempotency_key text PRIMARY KEY,
  first_attempted_at timestamptz NOT NULL,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  provider_email_id text
);
ALTER TABLE growth_reply_receipts ADD COLUMN forward_provider_id text;
