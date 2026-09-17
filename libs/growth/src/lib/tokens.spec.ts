import { createHmac } from 'node:crypto';

import {
  FOUNDER_APPROVE_INSTALL_TOKEN_MAX_AGE_SECONDS,
  FOUNDER_STOP_TOKEN_MAX_AGE_SECONDS,
  compareTokenHmac,
  createGrowthActionToken,
  createUnsubscribeActionUrl,
  growthStopEventKey,
  loadGrowthTokenKeyring,
  unsubscribeActionUrlValueForContact,
  unsubscribeActionUrlValue,
  verifyGrowthActionToken,
  type GrowthTokenKeyring,
} from './tokens.ts';

const contactId = '018f47a2-4a2b-4f86-9f03-3dca36f26e55';
const issuedAt = new Date('2026-09-01T12:00:00.000Z');
const activeSecret = 'active-growth-token-secret-material!';
const previousSecret = 'previous-growth-token-secret-data!';
const keyring: GrowthTokenKeyring = {
  active: { version: 7, secret: activeSecret },
  previous: [{ version: 6, secret: previousSecret }],
};

describe('growth action tokens', () => {
  it('constructs the exact canonical unsubscribe-purpose URL as an opaque value', () => {
    const actionUrl = createUnsubscribeActionUrl(
      {
        contactId,
        issuedAt,
        eventNonce: 'send-step-1',
      },
      keyring.active,
      'https://threadplane-preview.example'
    );
    const value = unsubscribeActionUrlValue(actionUrl);
    const token = new URL(value).searchParams.get('token');

    expect(value).toMatch(
      /^https:\/\/threadplane-preview\.example\/api\/unsubscribe\?token=g1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u
    );
    expect(token).not.toBeNull();
    expect(
      verifyGrowthActionToken(token ?? '', {
        expectedPurpose: 'unsubscribe',
        keyring,
        now: issuedAt,
      })
    ).toMatchObject({ contactId, purpose: 'unsubscribe' });
    expect(() => unsubscribeActionUrlValue(value as never)).toThrow(
      /unsubscribe action URL/iu
    );
    expect(unsubscribeActionUrlValueForContact(actionUrl, contactId)).toBe(
      value
    );
    expect(() =>
      unsubscribeActionUrlValueForContact(
        actionUrl,
        '00000000-0000-4000-8000-000000000777'
      )
    ).toThrow(/contact/iu);
  });

  it.each([
    'http://threadplane-preview.example',
    'https://user:password@threadplane-preview.example',
    'https://threadplane-preview.example/path',
    'https://threadplane-preview.example?environment=preview',
    'https://threadplane-preview.example#preview',
  ])('rejects a non-HTTPS or non-origin public action URL %s', (origin) => {
    expect(() =>
      createUnsubscribeActionUrl(
        { contactId, issuedAt },
        keyring.active,
        origin
      )
    ).toThrow(/public action origin/iu);
  });

  it('signs canonical versioned bytes without putting an email in the token URL', () => {
    const token = createGrowthActionToken(
      {
        contactId,
        purpose: 'unsubscribe',
        issuedAt,
        eventNonce: 'send-step-1',
      },
      keyring.active
    );
    const [version, encodedPayload, signature] = token.split('.');
    const payload = Buffer.from(encodedPayload ?? '', 'base64url').toString(
      'utf8'
    );
    const expectedSignature = createHmac('sha256', activeSecret)
      .update(`g1.${encodedPayload}`, 'utf8')
      .digest('base64url');

    expect(version).toBe('g1');
    expect(JSON.parse(payload)).toEqual({
      c: contactId,
      i: issuedAt.getTime(),
      k: 7,
      n: 'send-step-1',
      p: 'unsubscribe',
    });
    expect(signature).toBe(expectedSignature);
    expect(token).not.toMatch(/@|%40/iu);
    expect(token).toMatch(/^g1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u);
  });

  it('verifies active and previous keys during rotation', () => {
    const activeToken = createGrowthActionToken(
      { contactId, purpose: 'unsubscribe', issuedAt },
      keyring.active
    );
    const previousToken = createGrowthActionToken(
      { contactId, purpose: 'unsubscribe', issuedAt },
      keyring.previous?.[0] ?? keyring.active
    );

    expect(
      verifyGrowthActionToken(activeToken, {
        expectedPurpose: 'unsubscribe',
        keyring,
        now: issuedAt,
      })
    ).toMatchObject({ contactId, keyVersion: 7, purpose: 'unsubscribe' });
    expect(
      verifyGrowthActionToken(previousToken, {
        expectedPurpose: 'unsubscribe',
        keyring,
        now: issuedAt,
      })
    ).toMatchObject({ contactId, keyVersion: 6, purpose: 'unsubscribe' });
  });

  it('preserves issued-at milliseconds for canonical stop ordering', () => {
    const preciseIssuedAt = new Date('2026-09-01T12:00:00.789Z');
    const token = createGrowthActionToken(
      { contactId, purpose: 'unsubscribe', issuedAt: preciseIssuedAt },
      keyring.active
    );

    expect(
      verifyGrowthActionToken(token, {
        expectedPurpose: 'unsubscribe',
        keyring,
        now: preciseIssuedAt,
      })?.issuedAt
    ).toEqual(preciseIssuedAt);
  });

  it('fails uniformly for tampering, the wrong purpose, unknown keys, future issue times, and expiry', () => {
    const token = createGrowthActionToken(
      { contactId, purpose: 'founder_stop', issuedAt },
      keyring.active
    );
    const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
    const unknownKeyToken = createGrowthActionToken(
      { contactId, purpose: 'founder_stop', issuedAt },
      { version: 99, secret: 'unknown-growth-token-secret-value!' }
    );
    const futureToken = createGrowthActionToken(
      {
        contactId,
        purpose: 'founder_stop',
        issuedAt: new Date(issuedAt.getTime() + 301_000),
      },
      keyring.active
    );
    const expiredToken = createGrowthActionToken(
      { contactId, purpose: 'founder_stop', issuedAt },
      keyring.active
    );
    const options = {
      expectedPurpose: 'founder_stop' as const,
      keyring,
      now: issuedAt,
      maxAgeSeconds: FOUNDER_STOP_TOKEN_MAX_AGE_SECONDS,
    };

    expect(verifyGrowthActionToken(tampered, options)).toBeNull();
    expect(
      verifyGrowthActionToken(token, {
        ...options,
        expectedPurpose: 'unsubscribe',
      })
    ).toBeNull();
    expect(verifyGrowthActionToken(unknownKeyToken, options)).toBeNull();
    expect(verifyGrowthActionToken(futureToken, options)).toBeNull();
    expect(
      verifyGrowthActionToken(expiredToken, {
        ...options,
        now: new Date(
          issuedAt.getTime() + (FOUNDER_STOP_TOKEN_MAX_AGE_SECONDS + 1) * 1_000
        ),
      })
    ).toBeNull();
  });

  it('permits an explicit long-lived unsubscribe policy while still rejecting future tokens', () => {
    const token = createGrowthActionToken(
      { contactId, purpose: 'unsubscribe', issuedAt },
      keyring.active
    );

    expect(
      verifyGrowthActionToken(token, {
        expectedPurpose: 'unsubscribe',
        keyring,
        now: new Date('2036-09-01T12:00:00.000Z'),
      })
    ).toMatchObject({ contactId, issuedAt });
  });

  it('rejects non-canonical encodings and bounded-field violations', () => {
    expect(() =>
      createGrowthActionToken(
        {
          contactId,
          purpose: 'unsubscribe',
          issuedAt,
          eventNonce: 'x'.repeat(101),
        },
        keyring.active
      )
    ).toThrow(/event nonce/iu);
    expect(() =>
      createGrowthActionToken(
        {
          contactId,
          purpose: 'unsubscribe',
          issuedAt,
          reason: 'x'.repeat(101),
        },
        keyring.active
      )
    ).toThrow(/reason/iu);
    expect(() =>
      createGrowthActionToken(
        {
          contactId,
          purpose: 'unsubscribe',
          issuedAt,
          reason: 'person@example.com',
        },
        keyring.active
      )
    ).toThrow(/reason/iu);

    const token = createGrowthActionToken(
      { contactId, purpose: 'unsubscribe', issuedAt },
      keyring.active
    );
    const [version, payload, signature] = token.split('.');
    expect(
      verifyGrowthActionToken(`${version}.${payload}=.${signature}`, {
        expectedPurpose: 'unsubscribe',
        keyring,
        now: issuedAt,
      })
    ).toBeNull();
  });

  it('uses fixed-width comparisons and rejects malformed MAC encodings', () => {
    const mac = createHmac('sha256', activeSecret)
      .update('message')
      .digest('base64url');
    const otherMac = createHmac('sha256', activeSecret)
      .update('other')
      .digest('base64url');

    expect(compareTokenHmac(mac, mac)).toBe(true);
    expect(compareTokenHmac(mac, otherMac)).toBe(false);
    expect(compareTokenHmac(mac, 'short')).toBe(false);
    expect(compareTokenHmac('short', 'also-short')).toBe(false);
    expect(compareTokenHmac(mac, `${mac}=`)).toBe(false);
  });

  it('loads a validated keyring only when explicitly called', () => {
    expect(
      loadGrowthTokenKeyring({
        GROWTH_ACTION_TOKEN_ACTIVE_VERSION: '7',
        GROWTH_ACTION_TOKEN_ACTIVE_SECRET: activeSecret,
        GROWTH_ACTION_TOKEN_PREVIOUS_KEYS: JSON.stringify([
          { version: 6, secret: previousSecret },
        ]),
      })
    ).toEqual(keyring);

    expect(() =>
      loadGrowthTokenKeyring({
        GROWTH_ACTION_TOKEN_ACTIVE_VERSION: '7',
        GROWTH_ACTION_TOKEN_ACTIVE_SECRET: 'short',
      })
    ).toThrow(/32 bytes/iu);
    expect(() =>
      loadGrowthTokenKeyring({
        GROWTH_ACTION_TOKEN_ACTIVE_VERSION: '7',
        GROWTH_ACTION_TOKEN_ACTIVE_SECRET: activeSecret,
        GROWTH_ACTION_TOKEN_PREVIOUS_KEYS: '{',
      })
    ).toThrow(/previous keys/iu);
  });

  it('derives the exact replay key only from bounded token identity fields', () => {
    const token = createGrowthActionToken(
      {
        contactId,
        purpose: 'founder_stop',
        issuedAt,
        eventNonce: 'founder-message-3',
      },
      keyring.active
    );
    const payload = verifyGrowthActionToken(token, {
      expectedPurpose: 'founder_stop',
      keyring,
      now: issuedAt,
      maxAgeSeconds: FOUNDER_STOP_TOKEN_MAX_AGE_SECONDS,
    });

    expect(payload).not.toBeNull();
    if (!payload) throw new Error('Expected a valid founder-stop token');
    expect(growthStopEventKey(payload)).toBe(
      `token:founder_stop:${contactId}:${issuedAt.getTime()}:founder-message-3`
    );
    expect(growthStopEventKey(payload)).not.toContain(token);
  });
});

describe('founder_approve_install tokens', () => {
  const key = { version: 3, secret: 'approve-install-token-secret-material!' };
  const observationId = '0f1e2d3c-4b5a-4c7d-8e9f-a0b1c2d3e4f5';
  const issuedAt = new Date('2026-09-16T15:00:00.000Z');

  it('signs and verifies an install observation id under the approve purpose for seven days', () => {
    const token = createGrowthActionToken(
      { contactId: observationId, purpose: 'founder_approve_install', issuedAt, eventNonce: 'digest-job-1' },
      key
    );
    expect(FOUNDER_APPROVE_INSTALL_TOKEN_MAX_AGE_SECONDS).toBe(7 * 24 * 60 * 60);
    expect(
      verifyGrowthActionToken(token, {
        expectedPurpose: 'founder_approve_install',
        keyring: { active: key },
        now: new Date(issuedAt.getTime() + 6 * 24 * 60 * 60 * 1000),
        maxAgeSeconds: FOUNDER_APPROVE_INSTALL_TOKEN_MAX_AGE_SECONDS,
      })
    ).toMatchObject({ contactId: observationId, purpose: 'founder_approve_install', eventNonce: 'digest-job-1' });
    expect(
      verifyGrowthActionToken(token, {
        expectedPurpose: 'founder_approve_install',
        keyring: { active: key },
        now: new Date(issuedAt.getTime() + 8 * 24 * 60 * 60 * 1000),
        maxAgeSeconds: FOUNDER_APPROVE_INSTALL_TOKEN_MAX_AGE_SECONDS,
      })
    ).toBeNull();
    expect(
      verifyGrowthActionToken(token, {
        expectedPurpose: 'founder_stop',
        keyring: { active: key },
        now: issuedAt,
      })
    ).toBeNull();
  });
});
