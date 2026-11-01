import { expect, test } from 'vitest';

import {
  addDenyEntry,
  listDenyEntries,
  matchDeny,
  normalizeDenyValue,
  recordDrop,
  removeDenyEntry,
} from './deny.ts';
import { executorWith } from '../inbox-test-support.ts';

test('normalizeDenyValue by kind', () => {
  expect(
    normalizeDenyValue('profile_url', 'https://linkedin.com/in/Jane/')
  ).toBe('https://www.linkedin.com/in/jane');
  expect(normalizeDenyValue('company_name', 'Acme, Inc.')).toBe('acme');
  expect(normalizeDenyValue('company_domain', 'Acme.Example')).toBe(
    'acme.example'
  );
  expect(() =>
    normalizeDenyValue('profile_url', 'https://example.com/x')
  ).toThrow();
  expect(() => normalizeDenyValue('company_domain', 'not a host')).toThrow();
  expect(() => normalizeDenyValue('company_name', ' ,. ')).toThrow();
});

test('matchDeny probes profile url, headline domains and current company only', async () => {
  const { executor, calls } = executorWith({
    'linkedin-deny-match': () => ({ rows: [] }),
  });
  const result = await executor.transaction((tx) =>
    matchDeny(tx, {
      profileUrl: 'https://www.linkedin.com/in/jane',
      headline: 'CTO at Acme Widgets GmbH | acme.example',
    })
  );
  expect(result).toBeNull();
  expect(calls).toHaveLength(1);
  expect(calls[0].params).toEqual([
    'https://www.linkedin.com/in/jane',
    ['acme.example'],
    ['acme widgets'],
  ]);
});

test('matchDeny returns the first matching deny id', async () => {
  const { executor } = executorWith({
    'linkedin-deny-match': () => ({ rows: [{ id: 'deny-1' }] }),
  });
  expect(
    await executor.transaction((tx) =>
      matchDeny(tx, {
        profileUrl: 'https://www.linkedin.com/in/jane',
        headline: 'CTO at Acme',
      })
    )
  ).toBe('deny-1');
});

test('matchDeny sends no company candidate for ex- phrasing', async () => {
  const { executor, calls } = executorWith({
    'linkedin-deny-match': () => ({ rows: [] }),
  });
  await executor.transaction((tx) =>
    matchDeny(tx, {
      profileUrl: 'https://www.linkedin.com/in/jane',
      headline: 'ex-Acme, now independent',
    })
  );
  expect(calls[0].params[2]).toEqual([]);
});

test('addDenyEntry reports whether a row was created', async () => {
  const created = executorWith({
    'linkedin-deny-add': () => ({ rows: [{ id: 'new-1' }] }),
  });
  expect(
    await addDenyEntry(created.executor, {
      kind: 'company_name',
      value: 'Acme, Inc.',
      reason: 'competitor',
      addedBy: 'brian',
    })
  ).toEqual({ id: 'new-1', created: true });
  expect(created.calls[0].params).toEqual([
    'company_name',
    'acme',
    'competitor',
    'brian',
  ]);

  let n = 0;
  const existing = executorWith({
    'linkedin-deny-add': () =>
      n++ === 0 ? { rows: [] } : { rows: [{ id: 'old-1' }] },
  });
  expect(
    await addDenyEntry(existing.executor, {
      kind: 'company_domain',
      value: 'Acme.Example',
      addedBy: 'brian',
    })
  ).toEqual({ id: 'old-1', created: false });
  expect(existing.calls).toHaveLength(2);
  expect(existing.calls[0].params).toEqual([
    'company_domain',
    'acme.example',
    null,
    'brian',
  ]);
  expect(existing.calls[1].params).toEqual(['company_domain', 'acme.example']);
});

test('removeDenyEntry soft-removes the active row', async () => {
  const hit = executorWith({
    'linkedin-deny-remove': () => ({ rows: [{ id: 'd1' }] }),
  });
  expect(
    await removeDenyEntry(hit.executor, {
      kind: 'profile_url',
      value: 'https://linkedin.com/in/Jane/',
    })
  ).toBe(true);
  expect(hit.calls[0].params).toEqual([
    'profile_url',
    'https://www.linkedin.com/in/jane',
  ]);
  const miss = executorWith({
    'linkedin-deny-remove': () => ({ rows: [] }),
  });
  expect(
    await removeDenyEntry(miss.executor, {
      kind: 'company_name',
      value: 'Acme',
    })
  ).toBe(false);
});

test('listDenyEntries maps rows and filters removed entries by default', async () => {
  const addedAt = new Date('2026-11-01T00:00:00Z');
  const { executor, calls } = executorWith({
    'linkedin-deny-list': () => ({
      rows: [
        {
          id: 'd1',
          kind: 'company_name',
          value: 'acme',
          reason: null,
          added_by: 'brian',
          added_at: addedAt,
          removed_at: null,
        },
      ],
    }),
  });
  expect(await listDenyEntries(executor)).toEqual([
    {
      id: 'd1',
      kind: 'company_name',
      value: 'acme',
      reason: null,
      addedBy: 'brian',
      addedAt,
      removedAt: null,
    },
  ]);
  expect(calls[0].params).toEqual([false]);
  await listDenyEntries(executor, { includeRemoved: true });
  expect(calls[1].params).toEqual([true]);
});

test('recordDrop stores only receipt and deny ids', async () => {
  const { executor, calls } = executorWith({
    'linkedin-drop': () => ({ rows: [] }),
  });
  const droppedAt = new Date('2026-11-01T00:00:00Z');
  await executor.transaction((tx) =>
    recordDrop(tx, { receiptId: 'r1', denyId: 'd1', droppedAt })
  );
  expect(calls[0].params).toEqual(['r1', 'd1', droppedAt]);
});
