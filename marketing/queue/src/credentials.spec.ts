import { randomBytes } from 'node:crypto';
import { seal, unseal } from './crypto.ts';
import { loadAdapterOptions, saveCredentials } from './credentials.ts';
import type { SqlExecutor, SqlQueryResult, SqlTransaction } from './sql.ts';

type TestRow = Record<string, unknown>;

function fakeExecutor(stored: Record<string, TestRow>) {
  const upserts: { channel: string; sealed: string; expiresAt: unknown }[] = [];
  let transactionCalls = 0;
  const transaction: SqlTransaction = {
    async execute<Row extends Record<string, unknown>>(
      sql: string,
      parameters: readonly unknown[] = []
    ): Promise<SqlQueryResult<Row>> {
      const marker = /\/\* marketing:([a-z0-9-]+) \*\//u.exec(sql)?.[1];
      if (marker === 'get-channel-credentials') {
        const row = stored[parameters[0] as string];
        return { rows: (row ? [row] : []) as Row[] };
      }
      if (marker === 'upsert-channel-credentials') {
        const [channel, sealed, expiresAt] = parameters as [
          string,
          string,
          unknown
        ];
        upserts.push({ channel, sealed, expiresAt });
        stored[channel] = { sealed, expires_at: expiresAt };
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL marker: ${marker ?? 'missing'}`);
    },
  };
  const executor: SqlExecutor = {
    execute: transaction.execute.bind(transaction),
    transaction: (operation) => {
      transactionCalls += 1;
      return operation(transaction);
    },
  };
  return { executor, upserts, transactionCalls: () => transactionCalls };
}

const key = randomBytes(32);
const otherChannels = {
  linkedin: {
    sealed: seal(JSON.stringify({ accessToken: 'li', authorUrn: 'urn:li:person:1' }), key),
    expires_at: null,
  },
  devto: { sealed: seal(JSON.stringify({ apiKey: 'dk' }), key), expires_at: null },
};
const env = {
  X_CLIENT_ID: 'cid',
  X_CLIENT_SECRET: 'csecret',
  X_USER_HANDLE: 'threadplane',
};

describe('loadAdapterOptions', () => {
  it('builds X options and its rotation hook saves sealed tokens', async () => {
    const { executor, upserts, transactionCalls } = fakeExecutor({
      ...otherChannels,
      x: { sealed: seal(JSON.stringify({ accessToken: 'a1', refreshToken: 'r1' }), key), expires_at: null },
    });
    const options = await loadAdapterOptions(executor, key, env);
    expect(options.x?.credentials).toEqual({
      clientId: 'cid',
      clientSecret: 'csecret',
      accessToken: 'a1',
      refreshToken: 'r1',
      userHandle: 'threadplane',
    });
    await options.x?.onTokensRotated?.({ accessToken: 'a2', refreshToken: 'r2' });
    expect(upserts).toHaveLength(1);
    expect(transactionCalls()).toBe(0);
    expect(upserts[0].channel).toBe('x');
    // Random base64url can contain short token substrings by coincidence.
    // Verify the encrypted envelope and authenticated round-trip instead.
    expect(upserts[0].sealed).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/u);
    expect(JSON.parse(unseal(upserts[0].sealed, key))).toEqual({
      accessToken: 'a2',
      refreshToken: 'r2',
    });
    // Adapters built later from the same options start from the rotated pair.
    expect(options.x?.credentials).toMatchObject({ accessToken: 'a2', refreshToken: 'r2' });
  });

  it('loads LinkedIn with expiry and dev.to fully from the database', async () => {
    const expiresAt = new Date('2026-12-01T00:00:00Z');
    const { executor } = fakeExecutor({
      x: { sealed: seal(JSON.stringify({ accessToken: 'a', refreshToken: 'r' }), key), expires_at: null },
      linkedin: {
        sealed: seal(JSON.stringify({ accessToken: 'li', authorUrn: 'urn:li:person:1' }), key),
        expires_at: expiresAt,
      },
      devto: { sealed: seal(JSON.stringify({ apiKey: 'dk' }), key), expires_at: null },
    });
    const options = await loadAdapterOptions(executor, key, env);
    expect(options.linkedin?.credentials).toEqual({
      accessToken: 'li',
      authorUrn: 'urn:li:person:1',
      expiresAt,
    });
    expect(options.devto?.credentials).toEqual({ apiKey: 'dk' });
  });

  it('omits channels with no stored row instead of throwing', async () => {
    const { executor } = fakeExecutor({ devto: otherChannels.devto });
    const options = await loadAdapterOptions(executor, key, {});
    expect(options).toEqual({ devto: { credentials: { apiKey: 'dk' } } });
  });

  it('missing X env omits only X', async () => {
    const { executor } = fakeExecutor({
      ...otherChannels,
      x: { sealed: seal(JSON.stringify({ accessToken: 'a', refreshToken: 'r' }), key), expires_at: null },
    });
    const options = await loadAdapterOptions(executor, key, {
      X_CLIENT_ID: 'cid',
    });
    expect(options.x).toBeUndefined();
    expect(options.linkedin?.credentials.accessToken).toBe('li');
    expect(options.devto).toEqual({ credentials: { apiKey: 'dk' } });
  });
});

describe('saveCredentials', () => {
  it('stores the sealed value with the expiry', async () => {
    const { executor, upserts } = fakeExecutor({});
    const expiresAt = new Date('2026-12-01T00:00:00Z');
    await saveCredentials(executor, key, 'linkedin', { accessToken: 't' }, expiresAt);
    expect(upserts[0].expiresAt).toEqual(expiresAt);
    expect(JSON.parse(unseal(upserts[0].sealed, key))).toEqual({ accessToken: 't' });
  });
});
