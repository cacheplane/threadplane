import { describe, expect, it, test, vi } from 'vitest';

// The website intentionally consumes the growth library through its internal boundary.
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  createGrowthActionToken,
  type EmailHmacKeyring,
  type GrowthTokenKeyring,
  type SqlExecutor,
} from '@threadplane-internal/growth';

import { createUnsubscribeRoute } from './route';

const contactId = '018f47a2-4a2b-4f86-9f03-3dca36f26e55';
const now = new Date('2026-09-01T12:00:00.000Z');
const tokenKeyring: GrowthTokenKeyring = {
  active: { version: 3, secret: 'unsubscribe-route-token-secret!!' },
  previous: [{ version: 2, secret: 'previous-route-token-secret-data' }],
};
const emailKeyring: EmailHmacKeyring = {
  active: { version: 4, secret: 'email-lookup-route-secret-material' },
  previous: [{ version: 3, secret: 'old-email-route-secret-material!!' }],
};

function executor(): SqlExecutor {
  return {
    execute: vi.fn(),
    transaction: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as SqlExecutor;
}

function request(path: string, init: RequestInit = { method: 'GET' }): Request {
  return new Request(`https://threadplane.ai${path}`, init);
}

function unsubscribeToken(
  overrides: Partial<{
    issuedAt: Date;
    key: GrowthTokenKeyring['active'];
  }> = {}
): string {
  return createGrowthActionToken(
    {
      contactId,
      purpose: 'unsubscribe',
      issuedAt: overrides.issuedAt ?? now,
      eventNonce: 'campaign-v1-step-1',
    },
    overrides.key ?? tokenKeyring.active
  );
}

function routeHarness() {
  const database = executor();
  const loadTokenKeyring = vi.fn(() => tokenKeyring);
  const loadEmailKeyring = vi.fn(() => emailKeyring);
  const createDatabase = vi.fn(() => database);
  const stopLegacyEmailUnsubscribe = vi.fn().mockResolvedValue({
    applied: true,
    contactMatched: true,
    effective: true,
  });
  const stopContact = vi.fn().mockResolvedValue({
    applied: true,
    effective: true,
  });
  const route = createUnsubscribeRoute({
    now: () => now,
    loadTokenKeyring,
    loadEmailKeyring,
    createDatabase,
    stopLegacyEmailUnsubscribe,
    stopContact,
  });
  return {
    ...route,
    database,
    loadTokenKeyring,
    loadEmailKeyring,
    createDatabase,
    stopLegacyEmailUnsubscribe,
    stopContact,
  };
}

describe('/api/unsubscribe', () => {
  it('renders signed GET confirmation without mutation, database access, or cookies', async () => {
    const harness = routeHarness();
    const token = unsubscribeToken();

    const response = await harness.GET(
      request(`/api/unsubscribe?token=${token}`) as never
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(body).toContain('Confirm email preference');
    expect(body).toContain(`name="token" value="${token}"`);
    expect(body).not.toMatch(/@|%40/iu);
    expect(harness.loadTokenKeyring).toHaveBeenCalledTimes(1);
    expect(harness.createDatabase).not.toHaveBeenCalled();
    expect(harness.stopContact).not.toHaveBeenCalled();
  });

  it('performs RFC one-click POST without cookies or CSRF state', async () => {
    const harness = routeHarness();
    const issuedAt = new Date('2026-08-01T12:00:00.000Z');
    const token = unsubscribeToken({ issuedAt });
    const response = await harness.POST(
      request(`/api/unsubscribe?token=${token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      }) as never
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.text()).toContain('Email preference updated');
    expect(harness.stopContact).toHaveBeenCalledWith(
      harness.database,
      expect.objectContaining({
        contactId,
        reason: 'unsubscribe',
        eventKey: `token:unsubscribe:${contactId}:${issuedAt.getTime()}:campaign-v1-step-1`,
        occurredAt: now,
        source: 'signed_unsubscribe',
        provenance: {
          actor: 'recipient',
          kind: 'one_click',
          policyVersion: 'growth-lifecycle-v1',
        },
      })
    );
    expect(harness.database.close).toHaveBeenCalledTimes(1);
  });

  it('maps one-click and ordinary confirmation replays to the same canonical stop envelope', async () => {
    const harness = routeHarness();
    const token = unsubscribeToken();
    const oneClick = request(`/api/unsubscribe?token=${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    });
    const ordinaryConfirmation = request('/api/unsubscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    });

    const first = await harness.POST(oneClick as never);
    const second = await harness.POST(ordinaryConfirmation as never);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(harness.stopContact).toHaveBeenCalledTimes(2);
    expect(harness.stopContact.mock.calls[0]?.[1]).toEqual(
      harness.stopContact.mock.calls[1]?.[1]
    );
    expect(harness.stopContact.mock.calls[0]?.[1]).toMatchObject({
      provenance: {
        actor: 'recipient',
        kind: 'one_click',
        policyVersion: 'growth-lifecycle-v1',
      },
    });
  });

  it('returns one non-enumerating shape for token failures and unknown contacts', async () => {
    const valid = unsubscribeToken();
    const tampered = `${valid.slice(0, -1)}${valid.endsWith('a') ? 'b' : 'a'}`;
    const wrongPurpose = createGrowthActionToken(
      { contactId, purpose: 'founder_stop', issuedAt: now },
      tokenKeyring.active
    );
    const expired = unsubscribeToken({
      issuedAt: new Date('2019-01-01T00:00:00.000Z'),
    });
    const unknownKey = unsubscribeToken({
      key: { version: 99, secret: 'unknown-unsubscribe-route-secret!!' },
    });
    const failureResponses = [];

    for (const token of [tampered, wrongPurpose, expired, unknownKey]) {
      const harness = routeHarness();
      failureResponses.push(
        await harness.POST(
          request('/api/unsubscribe', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token }).toString(),
          }) as never
        )
      );
      expect(harness.createDatabase).not.toHaveBeenCalled();
    }

    const bodies = await Promise.all(
      failureResponses.map(async (response) => ({
        body: await response.text(),
        contentType: response.headers.get('content-type'),
        setCookie: response.headers.get('set-cookie'),
        status: response.status,
      }))
    );
    expect(new Set(bodies.map(({ body }) => body)).size).toBe(1);
    expect(new Set(bodies.map(({ status }) => status))).toEqual(new Set([400]));
    expect(bodies.every(({ setCookie }) => setCookie === null)).toBe(true);
    expect(bodies[0]?.body).not.toContain(contactId);
  });

  it.each([
    ['canonical stop failure', 'stop'],
    ['database close failure', 'close'],
  ])(
    'answers a signed one-click %s with the retryable server shape',
    async (_label, failure) => {
      const harness = routeHarness();
      if (failure === 'stop') {
        harness.stopContact.mockRejectedValueOnce(
          new Error(`Growth contact not found: ${contactId}`)
        );
      } else {
        vi.mocked(
          harness.database.close as () => Promise<void>
        ).mockRejectedValueOnce(new Error('connection reset'));
      }

      const response = await harness.POST(
        request('/api/unsubscribe', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: unsubscribeToken() }).toString(),
        }) as never
      );
      const body = await response.text();

      expect(response.status).toBe(503);
      expect(body).not.toContain(contactId);
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(harness.database.close).toHaveBeenCalledTimes(1);
    }
  );

  it('keeps invalid no-argument requests compatible without loading environment state', async () => {
    const harness = routeHarness();

    const response = await harness.GET(request('/api/unsubscribe') as never);

    expect(response.status).toBe(400);
    expect(harness.loadTokenKeyring).not.toHaveBeenCalled();
    expect(harness.loadEmailKeyring).not.toHaveBeenCalled();
    expect(harness.createDatabase).not.toHaveBeenCalled();
  });

  it('keeps legacy raw-email GET mutating through alias-aware lookup and the canonical stop path', async () => {
    const harness = routeHarness();

    const response = await harness.GET(
      request('/api/unsubscribe?email=Legacy%40Example.com') as never
    );

    expect(response.status).toBe(200);
    expect(harness.stopLegacyEmailUnsubscribe).toHaveBeenCalledWith(
      harness.database,
      expect.objectContaining({
        email: 'Legacy@Example.com',
        keyring: emailKeyring,
        occurredAt: now,
        source: 'legacy_raw_email_unsubscribe',
        policyVersion: 'growth-lifecycle-v1',
      })
    );
    expect(harness.stopContact).not.toHaveBeenCalled();
    expect(harness.database.close).toHaveBeenCalledTimes(1);
  });

  it('returns one legacy success shape for known and unknown healthy outcomes', async () => {
    const known = routeHarness();
    const unknown = routeHarness();
    unknown.stopLegacyEmailUnsubscribe.mockResolvedValueOnce({
      applied: false,
      contactMatched: false,
      effective: false,
    });

    const responses = await Promise.all(
      [known, unknown].map((harness) =>
        harness.GET(
          request('/api/unsubscribe?email=recipient%40example.com') as never
        )
      )
    );
    const shapes = await Promise.all(
      responses.map(async (response) => ({
        body: await response.text(),
        contentType: response.headers.get('content-type'),
        status: response.status,
      }))
    );

    expect(new Set(shapes.map(({ status }) => status))).toEqual(new Set([200]));
    expect(new Set(shapes.map(({ body }) => body)).size).toBe(1);
    expect(new Set(shapes.map(({ contentType }) => contentType)).size).toBe(1);
  });

  it.each([
    ['stop failure', 'stop'],
    ['database close failure', 'close'],
  ])(
    'never claims a legacy raw-email %s succeeded',
    async (_label, failure) => {
      const harness = routeHarness();
      if (failure === 'stop') {
        harness.stopLegacyEmailUnsubscribe.mockRejectedValueOnce(
          new Error('lookup unavailable')
        );
      } else {
        vi.mocked(
          harness.database.close as () => Promise<void>
        ).mockRejectedValueOnce(new Error('connection reset'));
      }

      const response = await harness.GET(
        request('/api/unsubscribe?email=recipient%40example.com') as never
      );
      const body = await response.text();

      expect(response.status).toBe(503);
      expect(body).not.toContain('recipient@example.com');
      expect(body).not.toContain('lookup unavailable');
      expect(harness.database.close).toHaveBeenCalledTimes(1);
    }
  );

  it('rejects malformed legacy email syntax without loading environment or database state', async () => {
    const harness = routeHarness();

    const response = await harness.GET(
      request('/api/unsubscribe?email=not-an-address') as never
    );

    expect(response.status).toBe(400);
    expect(harness.loadEmailKeyring).not.toHaveBeenCalled();
    expect(harness.createDatabase).not.toHaveBeenCalled();
    expect(harness.stopLegacyEmailUnsubscribe).not.toHaveBeenCalled();
  });

  it('rejects declared and streamed byte-overflow bodies before loading keys or database state', async () => {
    const declared = routeHarness();
    const declaredResponse = await declared.POST(
      request('/api/unsubscribe', {
        method: 'POST',
        headers: {
          'content-length': '2049',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'token=x',
      }) as never
    );

    let chunk = 0;
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const value = [
          new TextEncoder().encode('é'.repeat(1024)),
          new TextEncoder().encode('x'),
        ][chunk++];
        if (value) controller.enqueue(value);
        else controller.close();
      },
      cancel,
    });
    const streamed = routeHarness();
    const streamedResponse = await streamed.POST(
      new Request('https://threadplane.ai/api/unsubscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: stream,
        duplex: 'half',
      } as RequestInit) as never
    );

    expect([declaredResponse.status, streamedResponse.status]).toEqual([
      400, 400,
    ]);
    expect(cancel).toHaveBeenCalledTimes(1);
    for (const harness of [declared, streamed]) {
      expect(harness.loadTokenKeyring).not.toHaveBeenCalled();
      expect(harness.createDatabase).not.toHaveBeenCalled();
    }
  });

  it('rejects malformed one-click bodies before database access', async () => {
    const harness = routeHarness();
    const token = unsubscribeToken();
    const response = await harness.POST(
      request(`/api/unsubscribe?token=${token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=No',
      }) as never
    );

    expect(response.status).toBe(400);
    expect(harness.createDatabase).not.toHaveBeenCalled();
  });

  it('rejects query-token POSTs unless they are exact form-encoded RFC one-click requests', async () => {
    const token = unsubscribeToken();
    const requests = [
      request(`/api/unsubscribe?token=${token}`, { method: 'POST' }),
      request(`/api/unsubscribe?token=${token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: '',
      }),
      request(`/api/unsubscribe?token=${token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=',
      }),
      request(`/api/unsubscribe?token=${token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click&extra=1',
      }),
      request(`/api/unsubscribe?token=${token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }).toString(),
      }),
      request(`/api/unsubscribe?token=${token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      }),
    ];

    const shapes = [];
    for (const invalidRequest of requests) {
      const harness = routeHarness();
      const response = await harness.POST(invalidRequest as never);
      shapes.push({ body: await response.text(), status: response.status });
      expect(harness.loadTokenKeyring).not.toHaveBeenCalled();
      expect(harness.createDatabase).not.toHaveBeenCalled();
      expect(harness.stopContact).not.toHaveBeenCalled();
    }

    expect(new Set(shapes.map(({ status }) => status))).toEqual(new Set([400]));
    expect(new Set(shapes.map(({ body }) => body)).size).toBe(1);
  });

  it('accepts human confirmation only as a token-only form body with an explicit content type', async () => {
    const token = unsubscribeToken();
    const invalidRequests = [
      request('/api/unsubscribe', {
        method: 'POST',
        body: new URLSearchParams({ token }).toString(),
      }),
      request('/api/unsubscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      }),
      request('/api/unsubscribe', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: new URLSearchParams({ token }).toString(),
      }),
      request('/api/unsubscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token, extra: '1' }).toString(),
      }),
    ];

    for (const invalidRequest of invalidRequests) {
      const harness = routeHarness();
      const response = await harness.POST(invalidRequest as never);
      expect(response.status).toBe(400);
      expect(harness.loadTokenKeyring).not.toHaveBeenCalled();
      expect(harness.createDatabase).not.toHaveBeenCalled();
    }

    const validHarness = routeHarness();
    const valid = await validHarness.POST(
      request('/api/unsubscribe', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        body: new URLSearchParams({ token }).toString(),
      }) as never
    );
    expect(valid.status).toBe(200);
    expect(validHarness.stopContact).toHaveBeenCalledTimes(1);
  });

  it('escapes a verified token before echoing it into the confirmation form', async () => {
    // The signature check is the real gate, so reaching this branch needs a
    // token the verifier accepts. Mocking only the verifier proves the escaping
    // itself rather than re-testing the signature.
    vi.resetModules();
    vi.doMock('@threadplane-internal/growth', async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      verifyGrowthActionToken: () => ({
        contactId,
        purpose: 'unsubscribe',
        issuedAt: now,
        eventNonce: 'campaign-v1-step-1',
      }),
    }));
    const { createUnsubscribeRoute } = await import('./route');
    const hostile = '"><script>alert(1)</script>';
    const route = createUnsubscribeRoute({
      now: () => now,
      loadTokenKeyring: () => tokenKeyring,
      createDatabase: () => executor(),
      stopLegacyEmailUnsubscribe: vi.fn(),
      stopContact: vi.fn(),
    });

    const response = await route.GET(
      request(`/api/unsubscribe?token=${encodeURIComponent(hostile)}`) as never
    );
    const body = await response.text();

    expect(body).not.toContain('<script>alert(1)</script>');
    expect(body).toContain('&quot;&gt;&lt;script&gt;');
    vi.doUnmock('@threadplane-internal/growth');
    vi.resetModules();
  });
});

test('accepts a bounded multipart one-click request with the signed query token', async () => {
  const h = routeHarness();
  const body = new FormData();
  body.set('List-Unsubscribe', 'One-Click');

  const response = await h.POST(
    request(`/api/unsubscribe?token=${unsubscribeToken()}`, {
      method: 'POST',
      body,
    }) as never
  );

  expect(response.status).toBe(200);
  expect(h.stopContact).toHaveBeenCalledOnce();
});

test('rejects duplicate multipart one-click fields before opening the database', async () => {
  const h = routeHarness();
  const body = new FormData();
  body.append('List-Unsubscribe', 'One-Click');
  body.append('List-Unsubscribe', 'One-Click');

  const response = await h.POST(
    request(`/api/unsubscribe?token=${unsubscribeToken()}`, {
      method: 'POST',
      body,
    }) as never
  );

  expect(response.status).toBe(400);
  expect(h.createDatabase).not.toHaveBeenCalled();
});
