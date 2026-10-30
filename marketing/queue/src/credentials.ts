// Structural copies of the marketing-channels credential shapes. Importing
// them would make marketing-queue and marketing-channels (whose auth CLIs use
// this package) circular; the dispatcher's createAdapter() call type-checks
// the result against the real AdapterOptions.
interface DevToCredentials {
  apiKey: string;
}
interface LinkedInCredentials {
  accessToken: string;
  authorUrn: string;
  expiresAt?: Date;
}
export interface AdapterOptions {
  x?: {
    credentials: {
      clientId: string;
      clientSecret: string;
      accessToken: string;
      refreshToken: string;
      userHandle: string;
    };
    onTokensRotated?: (t: {
      accessToken: string;
      refreshToken: string;
    }) => Promise<void>;
  };
  linkedin?: { credentials: LinkedInCredentials };
  devto?: { credentials: DevToCredentials };
}

import { seal, unseal } from './crypto.ts';
import {
  getChannelCredentials,
  upsertChannelCredentials,
  type CredentialChannel,
} from './repository.ts';
import type { SqlTransaction } from './sql.ts';

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

export async function loadAdapterOptions(
  ex: SqlTransaction,
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
