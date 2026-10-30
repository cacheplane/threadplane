import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { LinkedInAuth } from './auth.ts';

const env = {
  LINKEDIN_ACCESS_TOKEN: 'li-access-1',
  LINKEDIN_AUTHOR_URN: 'urn:li:person:abc_123-XY',
  LINKEDIN_TOKEN_EXPIRES_AT: '2026-12-01T00:00:00.000Z',
};

let origEnv: NodeJS.ProcessEnv;
beforeEach(() => {
  origEnv = { ...process.env };
  Object.assign(process.env, env);
});
afterEach(() => {
  process.env = origEnv;
  vi.restoreAllMocks();
});

describe('LinkedInAuth construction', () => {
  it('reads required env vars', () => {
    const auth = new LinkedInAuth();
    expect(auth.accessToken).toBe('li-access-1');
    expect(auth.authorUrn).toBe('urn:li:person:abc_123-XY');
    expect(auth.expiresAt?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('throws with the list of missing env vars', () => {
    delete process.env.LINKEDIN_ACCESS_TOKEN;
    delete process.env.LINKEDIN_AUTHOR_URN;
    expect(() => new LinkedInAuth()).toThrow(/LINKEDIN_ACCESS_TOKEN, LINKEDIN_AUTHOR_URN/);
  });

  it('rejects an author URN that is not a person', () => {
    process.env.LINKEDIN_AUTHOR_URN = 'urn:li:organization:123';
    expect(() => new LinkedInAuth()).toThrow(/urn:li:person/);
  });

  it('rejects an unparseable expiry', () => {
    process.env.LINKEDIN_TOKEN_EXPIRES_AT = 'soon';
    expect(() => new LinkedInAuth()).toThrow(/not a valid date/);
  });

  it('treats a missing expiry as unknown, not expired', () => {
    delete process.env.LINKEDIN_TOKEN_EXPIRES_AT;
    const auth = new LinkedInAuth();
    expect(auth.expiresAt).toBeUndefined();
    expect(() => auth.assertUsable()).not.toThrow();
  });
});

describe('LinkedInAuth.assertUsable', () => {
  it('passes quietly with more than 7 days left', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    new LinkedInAuth().assertUsable(new Date('2026-11-01T00:00:00Z'));
    expect(spy).not.toHaveBeenCalled();
  });

  it('warns without printing the token inside the last 7 days', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    new LinkedInAuth().assertUsable(new Date('2026-11-28T00:00:00Z'));
    const written = spy.mock.calls.map((c) => String(c[0])).join('');
    expect(written).toContain('marketing:channels:linkedin:auth');
    expect(written).not.toContain('li-access-1');
  });

  it('throws with the bootstrapper hint once expired', () => {
    expect(() => new LinkedInAuth().assertUsable(new Date('2026-12-01T00:00:01Z'))).toThrow(
      /expired.*marketing:channels:linkedin:auth/,
    );
  });
});

describe('LinkedInAuth with injected credentials', () => {
  it('ignores env and validates the URN', () => {
    delete process.env.LINKEDIN_ACCESS_TOKEN;
    delete process.env.LINKEDIN_AUTHOR_URN;
    const auth = new LinkedInAuth({
      credentials: { accessToken: 'tok', authorUrn: 'urn:li:person:abc' },
    });
    expect(auth.accessToken).toBe('tok');
    expect(auth.expiresAt).toBeUndefined();
    expect(
      () =>
        new LinkedInAuth({
          credentials: { accessToken: 'tok', authorUrn: 'urn:li:organization:1' },
        }),
    ).toThrow(/urn:li:person/);
  });

  it('expiresInMs returns expiresAt minus now, undefined without expiry', () => {
    const expiresAt = new Date('2026-12-01T00:00:00Z');
    const withExpiry = new LinkedInAuth({
      credentials: { accessToken: 't', authorUrn: 'urn:li:person:a', expiresAt },
    });
    expect(withExpiry.expiresInMs(new Date('2026-11-30T00:00:00Z'))).toBe(86_400_000);
    const without = new LinkedInAuth({
      credentials: { accessToken: 't', authorUrn: 'urn:li:person:a' },
    });
    expect(without.expiresInMs(new Date())).toBeUndefined();
  });
});
