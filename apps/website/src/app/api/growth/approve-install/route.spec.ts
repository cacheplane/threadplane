import { describe, expect, it, vi } from 'vitest';

// The website intentionally consumes the growth library through its internal boundary.
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  FOUNDER_APPROVE_INSTALL_TOKEN_MAX_AGE_SECONDS,
  createGrowthActionToken,
  type GrowthTokenKeyring,
  type SqlExecutor,
} from '@threadplane-internal/growth';

import { createFounderApproveInstallRoute } from './route';

vi.mock('server-only', () => ({}));

const observationId = '018f47a2-4a2b-4f86-9f03-3dca36f26e55';
const now = new Date('2026-09-16T12:00:00.000Z');
const keyring: GrowthTokenKeyring = {
  active: { version: 8, secret: 'founder-approve-route-secret-material!' },
};
const emailKeyring = {
  active: { version: 1, secret: 'email-keyring-secret-material!!' },
};

function executor(): SqlExecutor {
  return {
    execute: vi.fn(),
    transaction: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as SqlExecutor;
}

function token(
  purpose: 'founder_approve_install' | 'founder_stop' = 'founder_approve_install',
  issuedAt = now
): string {
  return createGrowthActionToken(
    { contactId: observationId, purpose, issuedAt, eventNonce: 'digest-job-7' },
    keyring.active
  );
}

function harness(
  approveResult: unknown = { approved: true, contactId: 'c1', changed: true },
  approveOverride?: (...args: never[]) => Promise<unknown>
) {
  const database = executor();
  const approve = approveOverride ?? vi.fn().mockResolvedValue(approveResult);
  const loadTokenKeyring = vi.fn(() => keyring);
  const createDatabase = vi.fn(() => database);
  const route = createFounderApproveInstallRoute({
    now: () => now,
    loadTokenKeyring,
    loadEmailKeyring: () => emailKeyring,
    createDatabase,
    approveContactFromInstallDigest: approve,
  });
  return { ...route, database, approve, loadTokenKeyring, createDatabase };
}

function corruptSignature(rawToken: string): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const parts = rawToken.split('.');
  const signature = parts[2] ?? '';
  const lastChar = signature.slice(-1);
  const replacement =
    alphabet[(alphabet.indexOf(lastChar) + 1) % alphabet.length];
  parts[2] = signature.slice(0, -1) + replacement;
  return parts.join('.');
}

const request = (path: string, init?: RequestInit) =>
  new Request(`https://threadplane.ai${path}`, init);
const post = (t: string) =>
  request('/api/growth/approve-install', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: t }).toString(),
  });

describe('/api/growth/approve-install', () => {
  it('GET renders a confirmation form without touching the database', async () => {
    const h = harness();
    const response = await h.GET(
      request(`/api/growth/approve-install?token=${token()}`) as never
    );
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain('Confirm outreach approval');
    expect(body).toContain(`name="token" value="${token()}"`);
    expect(body).not.toMatch(/@|%40/iu);
    expect(h.approve).not.toHaveBeenCalled();
  });

  it('POST approves from the install observation id with the purpose-bound token', async () => {
    const h = harness();
    const response = await h.POST(post(token()) as never);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Outreach approved');
    expect(h.approve).toHaveBeenCalledWith(h.database, {
      installObservationId: observationId,
      occurredAt: now,
      eventKey: `token:founder_approve_install:${observationId}:${now.getTime()}:digest-job-7`,
      keyring: emailKeyring,
    });
    expect(h.database.close).toHaveBeenCalled();
  });

  it('POST reports failure for a stopped identity, a wrong purpose, and an expired token', async () => {
    const stopped = harness({ approved: false, reason: 'stopped' });
    expect(
      await (await stopped.POST(post(token()) as never)).text()
    ).toContain('Unable to process');

    const wrong = harness();
    await wrong.POST(post(token('founder_stop')) as never);
    expect(wrong.approve).not.toHaveBeenCalled();

    const expired = harness();
    const old = new Date(
      now.getTime() - (FOUNDER_APPROVE_INSTALL_TOKEN_MAX_AGE_SECONDS + 60) * 1000
    );
    await expired.POST(post(token('founder_approve_install', old)) as never);
    expect(expired.approve).not.toHaveBeenCalled();
  });

  it('POST rejects query parameters, wrong content types, and extra fields', async () => {
    const h = harness();
    await h.POST(
      request(`/api/growth/approve-install?token=${token()}`, {
        method: 'POST',
      }) as never
    );
    await h.POST(
      request('/api/growth/approve-install', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: token() }),
      }) as never
    );
    await h.POST(
      request('/api/growth/approve-install', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: token(), extra: '1' }).toString(),
      }) as never
    );
    expect(h.approve).not.toHaveBeenCalled();
  });

  it('POST is idempotent on a double click that finds no change to apply', async () => {
    const h = harness({ approved: true, contactId: 'c1', changed: false });
    const response = await h.POST(post(token()) as never);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Outreach approved');
    expect(h.approve).toHaveBeenCalledTimes(1);
    expect(h.database.close).toHaveBeenCalled();
  });

  it('POST rejects a token whose signature has been tampered with, without touching the database', async () => {
    const h = harness();
    const tampered = corruptSignature(token());
    const response = await h.POST(post(tampered) as never);
    expect((await response.text())).toContain('Unable to process');
    expect(h.approve).not.toHaveBeenCalled();
    expect(h.createDatabase).not.toHaveBeenCalled();
  });

  it('POST reports the same failure shape for a stopped identity, wrong purpose, expired token, and bad signature', async () => {
    const stopped = harness({ approved: false, reason: 'stopped' });
    const stoppedResponse = await stopped.POST(post(token()) as never);

    const wrongPurpose = harness();
    const wrongPurposeResponse = await wrongPurpose.POST(
      post(token('founder_stop')) as never
    );

    const expired = harness();
    const old = new Date(
      now.getTime() - (FOUNDER_APPROVE_INSTALL_TOKEN_MAX_AGE_SECONDS + 60) * 1000
    );
    const expiredResponse = await expired.POST(
      post(token('founder_approve_install', old)) as never
    );

    const badSignature = harness();
    const badSignatureResponse = await badSignature.POST(
      post(corruptSignature(token())) as never
    );

    const shapes = await Promise.all(
      [stoppedResponse, wrongPurposeResponse, expiredResponse, badSignatureResponse].map(
        async (response) => ({
          status: response.status,
          body: await response.text(),
        })
      )
    );

    expect(new Set(shapes.map(({ status }) => status))).toEqual(new Set([400]));
    expect(new Set(shapes.map(({ body }) => body)).size).toBe(1);
  });

  it('POST rejects a missing token before loading keys or opening the database', async () => {
    const h = harness();
    const response = await h.POST(
      request('/api/growth/approve-install', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      }) as never
    );
    expect(response.status).toBe(400);
    expect(h.loadTokenKeyring).not.toHaveBeenCalled();
    expect(h.createDatabase).not.toHaveBeenCalled();
  });

  it('POST closes the database even when approval throws', async () => {
    const h = harness(undefined, vi.fn().mockRejectedValue(new Error('boom')));
    const response = await h.POST(post(token()) as never);
    expect(response.status).toBe(400);
    expect(h.database.close).toHaveBeenCalled();
  });

  it('escapes a verified token before echoing it into the confirmation form', async () => {
    // The signature check is the real gate, so reaching this branch needs a
    // token the verifier accepts. Mocking only the verifier proves the escaping
    // itself rather than re-testing the signature.
    vi.resetModules();
    vi.doMock('@threadplane-internal/growth', async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      verifyGrowthActionToken: () => ({
        contactId: observationId,
        purpose: 'founder_approve_install',
        issuedAt: now,
        eventNonce: 'digest-job-7',
      }),
    }));
    const { createFounderApproveInstallRoute: createHostileRoute } = await import(
      './route'
    );
    const hostile = '"><script>alert(1)</script>';
    const hostileRoute = createHostileRoute({
      now: () => now,
      loadTokenKeyring: () => keyring,
      loadEmailKeyring: () => emailKeyring,
      createDatabase: () => executor(),
      approveContactFromInstallDigest: vi.fn(),
    });

    const response = await hostileRoute.GET(
      request(
        `/api/growth/approve-install?token=${encodeURIComponent(hostile)}`
      ) as never
    );
    const body = await response.text();

    expect(body).not.toContain('<script>alert(1)</script>');
    expect(body).toContain('&quot;&gt;&lt;script&gt;');
    vi.doUnmock('@threadplane-internal/growth');
    vi.resetModules();
  });
});
