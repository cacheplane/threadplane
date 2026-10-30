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
): Promise<{ value: T; expiresAt: Date | null }> {
  const row = await getChannelCredentials(ex, channel);
  if (!row) {
    throw new Error(
      `No ${channel} credentials stored in Neon. Authorize with: ${REAUTH_HINT[channel]}`
    );
  }
  return {
    value: JSON.parse(unseal(row.sealed, key)) as T,
    expiresAt: row.expiresAt,
  };
}

function requireEnv(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

/**
 * `ex` must be the root executor, never a transaction: X rotates its refresh
 * token on every refresh, so the rotation hook has to commit on its own even
 * if the surrounding post attempt later rolls back. Do not call this inside a
 * dispatch transaction.
 */
export async function loadAdapterOptions(
  ex: SqlExecutor,
  key: Buffer,
  env: Env
): Promise<AdapterOptions> {
  const clientId = requireEnv(env, 'X_CLIENT_ID');
  const clientSecret = requireEnv(env, 'X_CLIENT_SECRET');
  const userHandle = requireEnv(env, 'X_USER_HANDLE');

  const [x, linkedin, devto] = await Promise.all([
    loadSealed<{ accessToken: string; refreshToken: string }>(ex, key, 'x'),
    loadSealed<Omit<LinkedInCredentials, 'expiresAt'>>(ex, key, 'linkedin'),
    loadSealed<DevToCredentials>(ex, key, 'devto'),
  ]);

  return {
    x: {
      credentials: {
        clientId,
        clientSecret,
        accessToken: x.value.accessToken,
        refreshToken: x.value.refreshToken,
        userHandle,
      },
      onTokensRotated: (tokens) =>
        saveCredentials(ex, key, 'x', {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        }),
    },
    linkedin: {
      credentials: {
        ...linkedin.value,
        ...(linkedin.expiresAt ? { expiresAt: linkedin.expiresAt } : {}),
      },
    },
    devto: { credentials: devto.value },
  };
}
