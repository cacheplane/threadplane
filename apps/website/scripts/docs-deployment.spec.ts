// @vitest-environment node
import { expect, test } from 'vitest';
import {
  requireDocsOrigin,
  redactDiagnostic,
  waitForDocsRevision,
  verifyDocsDeployment,
} from './docs-deployment';

const revision = 'a'.repeat(40);
const immutable = 'https://build.vercel.app';
const production = 'https://threadplane.ai';

test('only plain HTTPS origins and local HTTP can be audited', () => {
  expect(requireDocsOrigin(production)).toBe(production);
  expect(requireDocsOrigin('http://127.0.0.1:4308')).toBe(
    'http://127.0.0.1:4308'
  );
  for (const value of [
    'https://user:secret@site.test',
    `${production}/docs`,
    `${production}?secret=x`,
    'http://site.test',
    'file:///private',
  ]) {
    expect(() => requireDocsOrigin(value)).toThrow();
  }
});

test('bounded readiness accepts only the exact full revision and rejects redirects', async () => {
  const attempts: string[] = [];
  let calls = 0;
  const identity = await waitForDocsRevision({
    origin: immutable,
    revision,
    attempts: 2,
    delayMs: 0,
    fetchRevision: async (url, init) => {
      attempts.push(url);
      expect(init.redirect).toBe('error');
      expect(init.cache).toBe('no-store');
      return Response.json({
        revision: ++calls === 1 ? 'b'.repeat(40) : revision,
      });
    },
  });
  expect(identity).toEqual({ origin: immutable, revision });
  expect(attempts).toEqual([
    `${immutable}/api/docs-revision`,
    `${immutable}/api/docs-revision`,
  ]);
  for (const response of [
    Response.json({ revision: revision.slice(0, 7) }),
    Response.json({}),
    new Response(null, { status: 302 }),
    new Response(null, { status: 503 }),
  ]) {
    await expect(
      waitForDocsRevision({
        origin: immutable,
        revision,
        attempts: 1,
        fetchRevision: async () => response,
      })
    ).rejects.toThrow();
  }
});

test('hung identity requests time out and invalid limits fail before fetching', async () => {
  await expect(
    waitForDocsRevision({
      origin: immutable,
      revision,
      attempts: 1,
      timeoutMs: 5,
      fetchRevision: () => new Promise(() => undefined),
    })
  ).rejects.toThrow(/timed out/);
  for (const options of [
    { revision: 'short' },
    { attempts: 0 },
    { attempts: 100 },
    { timeoutMs: -1 },
    { delayMs: -1 },
  ]) {
    await expect(
      waitForDocsRevision({ origin: immutable, revision, ...options })
    ).rejects.toThrow();
  }
});

test('checks both identities around exactly one browser pass and scopes protected headers', async () => {
  const events: string[] = [];
  await verifyDocsDeployment({
    origins: [immutable, production],
    auditOrigin: production,
    revision,
    bypassOrigin: immutable,
    bypassSecret: 'private-bypass',
    fetchRevision: async (url, init) => {
      events.push(url);
      expect(new Headers(init.headers).get('x-vercel-protection-bypass')).toBe(
        new URL(url).origin === immutable ? 'private-bypass' : null
      );
      return Response.json({ revision });
    },
    audit: async (origin) => {
      events.push(`audit:${origin}`);
    },
  });
  expect(events).toEqual([
    `${immutable}/api/docs-revision`,
    `${production}/api/docs-revision`,
    `audit:${production}`,
    `${immutable}/api/docs-revision`,
    `${production}/api/docs-revision`,
  ]);
});

test('an origin sharing the protected host prefix never receives its bypass', async () => {
  await waitForDocsRevision({
    origin: 'https://build.vercel.app.example.test',
    revision,
    bypassOrigin: immutable,
    bypassSecret: 'private-bypass',
    fetchRevision: async (_url, init) => {
      expect(
        new Headers(init.headers).get('x-vercel-protection-bypass')
      ).toBeNull();
      return Response.json({ revision });
    },
  });
});

test('an audit failure is never retried and a changed final revision fails immediately', async () => {
  let audits = 0;
  await expect(
    verifyDocsDeployment({
      origins: [immutable],
      auditOrigin: immutable,
      revision,
      fetchRevision: async () => Response.json({ revision }),
      audit: async () => {
        audits++;
        throw new Error('clipped diagram');
      },
    })
  ).rejects.toThrow('clipped diagram');
  expect(audits).toBe(1);
  let calls = 0;
  await expect(
    verifyDocsDeployment({
      origins: [immutable, production],
      auditOrigin: production,
      revision,
      fetchRevision: async () =>
        Response.json({ revision: ++calls <= 2 ? revision : 'b'.repeat(40) }),
      audit: async () => undefined,
    })
  ).rejects.toThrow(/revision/);
  expect(calls).toBe(4);
});

test('diagnostics remove URL credentials, query values, fragments, and known secrets', () => {
  expect(
    redactDiagnostic(
      'Failed https://name:password@site.test/docs?token=secret#private with bypass-secret',
      ['bypass-secret']
    )
  ).toBe('Failed https://site.test/docs with [redacted]');
});
