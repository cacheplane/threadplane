import { INBOX_ADDRESS } from '../inbox-replies.ts';

/** Server-side switches for the LinkedIn notification ingest. */
export type LinkedInIngestConfig =
  | { enabled: false }
  | { enabled: true; address: string; forwardNotifications: boolean };

function exactBoolean(name: string, value: string | undefined): boolean {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error(`Invalid LinkedIn ingest configuration: ${name}`);
}

/**
 * Loads the opt-in LinkedIn ingest. Switches accept only exact `true`/`false`;
 * an enabled configuration needs its own threadplane.ai address and fails
 * closed otherwise.
 */
export function loadLinkedInIngestConfig(
  env: Record<string, string | undefined> = process.env
): LinkedInIngestConfig {
  if (
    !exactBoolean(
      'GROWTH_LINKEDIN_INGEST_ENABLED',
      env['GROWTH_LINKEDIN_INGEST_ENABLED']
    )
  )
    return { enabled: false };
  const address = (env['GROWTH_LINKEDIN_INGEST_ADDRESS'] ?? '')
    .trim()
    .toLowerCase();
  if (!/^[^@\s<>]+@threadplane\.ai$/.test(address) || address === INBOX_ADDRESS)
    throw new Error('Invalid LinkedIn ingest configuration: address');
  return {
    enabled: true,
    address,
    forwardNotifications: exactBoolean(
      'GROWTH_LINKEDIN_FORWARD_NOTIFICATIONS',
      env['GROWTH_LINKEDIN_FORWARD_NOTIFICATIONS']
    ),
  };
}
