import type {
  AdapterOptions,
  DevToCredentials,
  LinkedInCredentials,
} from '@threadplane-internal/marketing-channels';
import { seal, unseal } from './crypto.ts';
import {
  getChannelCredentials,
  upsertChannelCredentials,
  type CredentialChannel,
} from './repository.ts';
import type { SqlExecutor, SqlTransaction } from './sql.ts';

type Env = Record<string, string | undefined>;

const REAUTH_HINT: Record<CredentialChannel, string> = {
  x: 'npm run marketing:channels:x:auth -- --target=<preview|production>',
  linkedin:
    'npm run marketing:channels:linkedin:auth -- --target=<preview|production>',
  devto: 'npm run marketing:queue -- set-devto-key --target=<preview|production>',
};

export async function saveCredentials(
  ex: SqlTransaction,
  key: Buffer,
  channel: CredentialChannel,
  value: object,
  expiresAt?: Date
): Promise<void> {
  await upsertChannelCredentials(
    ex,
    channel,
    seal(JSON.stringify(value), key),
    expiresAt
  );
}

async function loadSealed<T>(
  ex: SqlTransaction,
  key: Buffer,
  channel: CredentialChannel
): Promise<{ value: T; expiresAt: Date | null } | null> {
  const row = await getChannelCredentials(ex, channel);
  if (!row) return null;
  return {
    value: JSON.parse(unseal(row.sealed, key)) as T,
    expiresAt: row.expiresAt,
  };
}

/** Operator-facing hint for a channel with no stored credentials. */
export function reauthHint(channel: CredentialChannel): string {
  return `No ${channel} credentials stored in Neon. Authorize with: ${REAUTH_HINT[channel]}`;
}

/**
 * `ex` must be the root executor, never a transaction: X rotates its refresh
 * token on every refresh, so the rotation hook has to commit on its own even
 * if the surrounding post attempt later rolls back. Do not call this inside a
 * dispatch transaction.
 *
 * Channels with no stored row (and X without X_CLIENT_ID, X_CLIENT_SECRET and
 * X_USER_HANDLE) are omitted, so one unavailable channel does not block the
 * others; callers treat a missing entry as unavailable.
 */
export async function loadAdapterOptions(
  ex: SqlExecutor,
  key: Buffer,
  env: Env
): Promise<AdapterOptions> {
  const [x, linkedin, devto] = await Promise.all([
    loadSealed<{ accessToken: string; refreshToken: string }>(ex, key, 'x'),
    loadSealed<Omit<LinkedInCredentials, 'expiresAt'>>(ex, key, 'linkedin'),
    loadSealed<DevToCredentials>(ex, key, 'devto'),
  ]);

  const options: AdapterOptions = {};
  const clientId = env['X_CLIENT_ID'];
  const clientSecret = env['X_CLIENT_SECRET'];
  const userHandle = env['X_USER_HANDLE'];
  // Missing X app config omits only X, so LinkedIn and dev.to keep posting.
  if (x && clientId && clientSecret && userHandle) {
    const credentials = {
      clientId,
      clientSecret,
      accessToken: x.value.accessToken,
      refreshToken: x.value.refreshToken,
      userHandle,
    };
    options.x = {
      credentials,
      onTokensRotated: async (tokens) => {
        // X has already invalidated the old refresh token, so an adapter
        // built later from these options (the next X row in the same tick)
        // must start from the new pair.
        credentials.accessToken = tokens.accessToken;
        credentials.refreshToken = tokens.refreshToken;
        await saveCredentials(ex, key, 'x', {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        });
      },
    };
  }
  if (linkedin) {
    options.linkedin = {
      credentials: {
        ...linkedin.value,
        ...(linkedin.expiresAt ? { expiresAt: linkedin.expiresAt } : {}),
      },
    };
  }
  if (devto) options.devto = { credentials: devto.value };
  return options;
}
