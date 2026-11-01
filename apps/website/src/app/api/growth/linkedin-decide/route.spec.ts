import { describe, expect, it, vi } from 'vitest';

// The website intentionally consumes the growth library through its internal boundary.
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  createGrowthActionToken,
  type GrowthTokenKeyring,
  type SqlExecutor,
} from '@threadplane-internal/growth';

import { createFounderLinkedInDecideRoute } from './route';

vi.mock('server-only', () => ({}));

const leadId = '9a1e2d3c-4b5a-4c7d-8e9f-a0b1c2d3e4f5';
const now = new Date('2026-11-01T12:00:00.000Z');
const keyring: GrowthTokenKeyring = {
  active: { version: 5, secret: 'linkedin-decide-route-secret-material!' },
};

function executor(): SqlExecutor {
  return {
    execute: vi.fn(),
    transaction: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as SqlExecutor;
}

function token(
  options: {
    purpose?: 'founder_linkedin_decide' | 'founder_approve_install';
    reason?: string | null;
    issuedAt?: Date;
  } = {}
): string {
  const reason = options.reason === undefined ? 'deny' : options.reason;
  return createGrowthActionToken(
    {
      contactId: leadId,
      purpose: options.purpose ?? 'founder_linkedin_decide',
      issuedAt: options.issuedAt ?? now,
      ...(reason === null ? {} : { reason }),
    },
    keyring.active
  );
}

function harness(results: string[] = ['applied']) {
  const database = executor();
  const decide = vi.fn();
  for (const result of results) decide.mockResolvedValueOnce(result);
  const route = createFounderLinkedInDecideRoute({
    now: () => now,
    loadTokenKeyring: () => keyring,
    createDatabase: () => database,
    decideLead: decide as never,
  });
  return { ...route, database, decide };
}

const request = (path: string, init?: RequestInit) =>
  new Request(`https://threadplane.ai${path}`, init);
const post = (t: string) =>
  request('/api/growth/linkedin-decide', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: t }).toString(),
  });

describe('/api/growth/linkedin-decide', () => {
  it('GET renders a confirmation form naming the action', async () => {
    const h = harness();
    const deny = await h.GET(
      request(`/api/growth/linkedin-decide?token=${token()}`) as never
    );
    const denyBody = await deny.text();
    expect(deny.status).toBe(200);
    expect(denyBody).toContain('Deny this lead forever');
    expect(denyBody).toContain(`name="token" value="${token()}"`);

    const reject = await h.GET(
      request(
        `/api/growth/linkedin-decide?token=${token({ reason: 'reject' })}`
      ) as never
    );
    expect(await reject.text()).toContain('Reject this lead');
    expect(h.decide).not.toHaveBeenCalled();
  });

  it('POST applies the decision once and treats a repeat as success', async () => {
    const h = harness(['applied', 'already_decided']);
    const first = await h.POST(post(token({ reason: 'reject' })) as never);
    expect(first.status).toBe(200);
    expect(await first.text()).toContain('Lead rejected');
    expect(h.decide).toHaveBeenCalledWith(h.database, {
      leadId,
      decision: 'reject',
      decidedBy: 'founder_email_link',
      now,
    });

    const second = await h.POST(post(token()) as never);
    expect(second.status).toBe(200);
    expect(await second.text()).toContain('Lead denied forever');
    expect(h.decide).toHaveBeenLastCalledWith(h.database, {
      leadId,
      decision: 'deny',
      decidedBy: 'founder_email_link',
      now,
    });
    expect(h.database.close).toHaveBeenCalledTimes(2);
  });

  it('POST rejects a token with the wrong purpose or no reason', async () => {
    const h = harness();
    for (const bad of [
      token({ purpose: 'founder_approve_install' }),
      token({ reason: null }),
      token({ issuedAt: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000) }),
    ]) {
      const response = await h.POST(post(bad) as never);
      expect(response.status).toBe(400);
      expect(await response.text()).toContain('Unable to process');
    }
    expect(h.decide).not.toHaveBeenCalled();
  });

  it('POST fails for unknown leads and non-form bodies', async () => {
    const h = harness(['not_found', 'denied_by_list']);
    expect((await h.POST(post(token()) as never)).status).toBe(400);
    expect((await h.POST(post(token()) as never)).status).toBe(400);
    const json = await h.POST(
      request('/api/growth/linkedin-decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: token() }),
      }) as never
    );
    expect(json.status).toBe(400);
    expect(h.decide).toHaveBeenCalledTimes(2);
  });

  it('POST never approves', async () => {
    const h = harness();
    const response = await h.POST(post(token({ reason: 'approve' })) as never);
    expect(response.status).toBe(400);
    const get = await h.GET(
      request(
        `/api/growth/linkedin-decide?token=${token({ reason: 'approve' })}`
      ) as never
    );
    expect(get.status).toBe(400);
    expect(h.decide).not.toHaveBeenCalled();
  });
});
