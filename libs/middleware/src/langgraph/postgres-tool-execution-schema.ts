/** Fresh installations only. Existing tables require the explicit migration. */
export const THREADPLANE_CLIENT_TOOL_EXECUTIONS_SCHEMA = `
CREATE TABLE IF NOT EXISTS threadplane_client_tool_executions (
  tenant_id     text        NOT NULL DEFAULT '',
  thread_id     text        NOT NULL,
  tool_call_id  text        NOT NULL,
  status        text        NOT NULL,
  result        jsonb,
  invocation    text,
  owner_token   text        NOT NULL,
  encoded_result text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, thread_id, tool_call_id)
);
`;

/** Drain all writers first. This fences old INSERT/UPSERT factory statements,
 * not custom direct UPDATE writers. Historical results remain uncertified. */
export const THREADPLANE_CLIENT_TOOL_EXECUTIONS_MIGRATION = `
BEGIN;
LOCK TABLE threadplane_client_tool_executions IN ACCESS EXCLUSIVE MODE;
ALTER TABLE threadplane_client_tool_executions
  ADD COLUMN IF NOT EXISTS invocation text,
  ADD COLUMN IF NOT EXISTS owner_token text,
  ADD COLUMN IF NOT EXISTS encoded_result text;
UPDATE threadplane_client_tool_executions
SET owner_token = 'legacy-unknown'
WHERE owner_token IS NULL;
ALTER TABLE threadplane_client_tool_executions
  ALTER COLUMN owner_token DROP DEFAULT,
  ALTER COLUMN owner_token SET NOT NULL;
COMMIT;
`;
