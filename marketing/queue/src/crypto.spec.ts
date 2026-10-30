import { randomBytes } from 'node:crypto';
import { loadCredentialKey, seal, unseal } from './crypto.ts';

const key = randomBytes(32);

describe('seal/unseal', () => {
  it('round-trips', () => {
    const sealed = seal('{"a":1}', key);
    expect(sealed).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/u);
    expect(unseal(sealed, key)).toBe('{"a":1}');
  });

  it('uses a fresh iv each time', () => {
    expect(seal('x', key)).not.toBe(seal('x', key));
  });

  it('rejects a tampered tag', () => {
    const [v, iv, tag, ct] = seal('secret', key).split('.');
    const flipped = Buffer.from(tag, 'base64url');
    flipped[0] ^= 1;
    const tampered = [v, iv, flipped.toString('base64url'), ct].join('.');
    expect(() => unseal(tampered, key)).toThrow();
  });

  it('rejects a truncated tag', () => {
    const [v, iv, tag, ct] = seal('secret', key).split('.');
    const short = Buffer.from(tag, 'base64url').subarray(0, 4);
    expect(() =>
      unseal([v, iv, short.toString('base64url'), ct].join('.'), key)
    ).toThrow(/format/u);
  });

  it('rejects an iv that is not 12 bytes', () => {
    const [v, , tag, ct] = seal('secret', key).split('.');
    const iv = randomBytes(16).toString('base64url');
    expect(() => unseal([v, iv, tag, ct].join('.'), key)).toThrow(/format/u);
  });

  it('rejects the wrong key and unknown versions', () => {
    expect(() => unseal(seal('s', key), randomBytes(32))).toThrow();
    expect(() => unseal('v2.a.b.c', key)).toThrow(/format/u);
  });
});

describe('loadCredentialKey', () => {
  it('decodes a 32 byte base64 key', () => {
    const raw = randomBytes(32);
    const loaded = loadCredentialKey({
      MARKETING_CREDENTIALS_KEY: raw.toString('base64'),
    });
    expect(loaded.equals(raw)).toBe(true);
  });

  it('rejects 31 bytes', () => {
    expect(() =>
      loadCredentialKey({
        MARKETING_CREDENTIALS_KEY: randomBytes(31).toString('base64'),
      })
    ).toThrow('MARKETING_CREDENTIALS_KEY must be 32 bytes base64');
  });

  it('rejects a missing key', () => {
    expect(() => loadCredentialKey({})).toThrow(
      'MARKETING_CREDENTIALS_KEY must be 32 bytes base64'
    );
  });
});
