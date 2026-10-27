import { expect, test, vi } from 'vitest';

import { readInboxRecoveryPaused, recoverInbox } from './inbox-recovery.ts';
import { executorWith } from './inbox-test-support.ts';

const config = {
  enabled: true as const,
  address: 'brian@threadplane.ai',
  startedAt: new Date('2026-10-22T00:00:00Z'),
};
const now = new Date('2026-10-22T01:00:00Z');

function setup(overrides: Parameters<typeof executorWith>[0] = {}) {
  return executorWith({
    'inbox-ensure-mailbox': () => ({ rows: [{ address: config.address }] }),
    'inbox-recovery-start': () => ({
      rows: [
        {
          healthy_through: null,
          scan_cursor: null,
          scan_started_at: now,
          scan_complete: false,
        },
      ],
    }),
    'inbox-recovery-generation-lock': () => ({
      rows: [{ address: config.address }],
    }),
    'inbox-scan-progress': () => ({ rows: [{ address: config.address }] }),
    'inbox-admit': () => ({ rows: [] }),
    'inbox-processing-failed': () => ({ rows: [] }),
    'inbox-forward-attempt': () => ({ rows: [] }),
    'inbox-unbound': () => ({ rows: [] }),
    'inbox-list-pending': () => ({ rows: [] }),
    'inbox-recovery-complete': () => ({ rows: [{ address: config.address }] }),
    'inbox-list-unforwarded': () => ({ rows: [] }),
    ...overrides,
  });
}

test('failed enumeration never publishes a healthy checkpoint', async () => {
  const { executor, calls } = setup();
  const listReceived = async function* () {
    throw new Error('network');
    yield { id: 'unreachable', to: [], created_at: '' };
  };

  await expect(
    recoverInbox(executor, config, {
      listReceived,
      getSent: vi.fn(),
      getReceived: vi.fn(),
      stopContact: vi.fn(),
      now: () => now,
    })
  ).rejects.toThrow('network');
  expect(calls.some((call) => call.marker === 'inbox-recovery-complete')).toBe(
    false
  );
});

test('checkpoint uses scan start and compare-and-set generation after all work', async () => {
  const { executor, calls } = setup();

  await recoverInbox(executor, config, {
    listReceived: async function* () {
      yield* [];
    },
    getSent: vi.fn(),
    getReceived: vi.fn(),
    stopContact: vi.fn(),
    now: () => now,
  });

  const checkpoint = calls.find(
    (call) => call.marker === 'inbox-recovery-complete'
  );
  expect(checkpoint?.params[2]).toEqual(now);
  expect(checkpoint?.sql).toContain('recovery_id = $2::uuid');
  expect(checkpoint?.sql).toContain('reference_ids is null');
});

test('a gap beyond provider retention cannot be declared recovered', async () => {
  const { executor, calls } = setup();

  await expect(
    recoverInbox(executor, config, {
      listReceived: async function* () {
        yield* [];
      },
      getSent: vi.fn(),
      getReceived: vi.fn(),
      stopContact: vi.fn(),
      now: () => new Date('2026-11-23T00:00:00Z'),
    })
  ).rejects.toThrow('retention');
  expect(calls.some((call) => call.marker === 'inbox-recovery-complete')).toBe(
    false
  );
});

test('recovery forwards completed and ignored receipts independently of pending replies', async () => {
  const { executor, calls } = setup({
    'inbox-list-unforwarded': () => ({
      rows: [{ id: 'stopped-mail' }, { id: 'ignored-mail' }],
    }),
  });
  const forwardReceipt = vi.fn(async () => 'forward-id');

  await recoverInbox(executor, config, {
    listReceived: async function* () {
      yield* [];
    },
    getSent: vi.fn(),
    getReceived: vi.fn(),
    stopContact: vi.fn(),
    now: () => now,
    forwardReceipt,
  });

  expect(forwardReceipt.mock.calls).toEqual([
    [executor, 'stopped-mail'],
    [executor, 'ignored-mail'],
  ]);
  const selection = calls.find(
    (call) => call.marker === 'inbox-list-unforwarded'
  );
  expect(selection?.sql).toContain('forward_provider_id is null');
  expect(selection?.sql).not.toContain("status = 'pending'");
});

test('reply processing failure still forwards all receipts and prevents recovery checkpoint', async () => {
  const { executor, calls } = setup({
    'inbox-list-pending': () => ({ rows: [{ id: 'incoming-1' }] }),
    'inbox-list-unforwarded': () => ({
      rows: [{ id: 'incoming-1' }, { id: 'incoming-2' }],
    }),
  });
  const forwardReceipt = vi.fn(async () => 'forward-id');

  await expect(
    recoverInbox(executor, config, {
      listReceived: async function* () {
        yield* [];
      },
      getSent: vi.fn(),
      getReceived: vi.fn().mockRejectedValue(new Error('read failed')),
      stopContact: vi.fn(),
      now: () => now,
      forwardReceipt,
    })
  ).rejects.toThrow();

  expect(forwardReceipt).toHaveBeenCalledTimes(2);
  expect(calls.some((call) => call.marker === 'inbox-recovery-complete')).toBe(
    false
  );
});

test('forward failure continues remaining forwards and prevents recovery checkpoint', async () => {
  const { executor, calls } = setup({
    'inbox-list-unforwarded': () => ({
      rows: [{ id: 'incoming-1' }, { id: 'incoming-2' }],
    }),
  });
  const forwardReceipt = vi
    .fn()
    .mockRejectedValueOnce(new Error('send failed'))
    .mockResolvedValueOnce('forward-id');

  await expect(
    recoverInbox(executor, config, {
      listReceived: async function* () {
        yield* [];
      },
      getSent: vi.fn(),
      getReceived: vi.fn(),
      stopContact: vi.fn(),
      now: () => now,
      forwardReceipt,
    })
  ).rejects.toThrow();

  expect(forwardReceipt).toHaveBeenCalledTimes(2);
  expect(calls.some((call) => call.marker === 'inbox-recovery-complete')).toBe(
    false
  );
});

test('recovery scopes outbound binding to jobs created in the receiving period', async () => {
  const { executor, calls } = setup();
  await recoverInbox(executor, config, {
    listReceived: async function* () {
      yield* [];
    },
    getSent: vi.fn(),
    getReceived: vi.fn(),
    stopContact: vi.fn(),
    now: () => now,
  });
  const query = calls.find((call) => call.marker === 'inbox-unbound');
  expect(query?.sql).toContain('j.created_at >= $1::timestamptz');
  expect(query?.params).toEqual([config.startedAt]);
});

test('active-period bindings only scan completed provider-accepted send jobs', async () => {
  const { executor, calls } = setup();
  await recoverInbox(executor, config, {
    listReceived: async function* () {
      yield* [];
    },
    getSent: vi.fn(),
    getReceived: vi.fn(),
    stopContact: vi.fn(),
    now: () => now,
  });
  const query = calls.find((call) => call.marker === 'inbox-unbound');
  expect(query?.sql).toContain("j.status = 'completed'");
  expect(query?.sql).toContain('j.delivery_status in');
});

test('bounded shared-account scan durably advances foreign cursors and resumes original coverage', async () => {
  let cursor: string | null = null;
  const scanStart = new Date('2026-10-22T00:30:00Z');
  const { executor, calls } = setup({
    'inbox-recovery-start': () => ({
      rows: [
        {
          healthy_through: null,
          scan_cursor: cursor,
          scan_started_at: scanStart,
          scan_complete: false,
        },
      ],
    }),
    'inbox-scan-progress': (params) => {
      cursor = params[2] as string | null;
      return { rows: [{ address: config.address }] };
    },
  });
  const seen: (string | undefined)[] = [];
  const deps = {
    listReceived: async function* (after?: string) {
      seen.push(after);
      const start = after ? Number(after.slice(4)) + 1 : 0;
      for (let index = start; index < 102; index++)
        yield {
          id: `mail${index}`,
          to: ['other@hashbrown.dev'],
          created_at: now.toISOString(),
        };
    },
    getSent: vi.fn(),
    getReceived: vi.fn(),
    stopContact: vi.fn(),
    now: () => now,
  };
  expect(await recoverInbox(executor, config, deps)).toEqual({
    received: 0,
    processed: 0,
    complete: false,
  });
  expect(cursor).toBe('mail99');
  expect(calls.some((call) => call.marker === 'inbox-recovery-complete')).toBe(
    false
  );
  expect(await recoverInbox(executor, config, deps)).toMatchObject({
    complete: true,
  });
  expect(seen).toEqual([undefined, 'mail99']);
  expect(
    calls.find((call) => call.marker === 'inbox-recovery-complete')?.params[2]
  ).toEqual(scanStart);
});

test('time exhaustion stops before next provider fetch and leaves health paused', async () => {
  let elapsed = 0;
  let fetched = 0;
  const { executor, calls } = setup({
    'inbox-scan-progress': () => {
      elapsed = 240000;
      return { rows: [{ address: config.address }] };
    },
  });
  const listReceived = vi.fn(async function* () {
    for (const id of ['one', 'two']) {
      fetched++;
      yield { id, to: ['other@example.com'], created_at: now.toISOString() };
    }
  });
  const result = await recoverInbox(executor, config, {
    listReceived,
    getSent: vi.fn(),
    getReceived: vi.fn(),
    stopContact: vi.fn(),
    now: () => now,
    budgetMs: 240000,
    monotonicNow: () => elapsed,
  });
  expect(fetched).toBe(1);
  expect(result.complete).toBe(false);
  expect(calls.some((call) => call.marker === 'inbox-recovery-complete')).toBe(
    false
  );
});

test('superseded scan cannot advance admission cursor or publish health', async () => {
  const { executor, calls } = setup({
    'inbox-recovery-generation-lock': () => ({ rows: [] }),
  });
  await expect(
    recoverInbox(executor, config, {
      listReceived: async function* () {
        yield {
          id: 'one',
          to: [config.address],
          created_at: now.toISOString(),
        };
      },
      getSent: vi.fn(),
      getReceived: vi.fn(),
      stopContact: vi.fn(),
      now: () => now,
    })
  ).rejects.toThrow('superseded');
  expect(calls.some((call) => call.marker === 'inbox-admit')).toBe(false);
  expect(calls.some((call) => call.marker === 'inbox-recovery-complete')).toBe(
    false
  );
});

test('recovery query batches favor unread receipts and constrain all backlog work', async () => {
  const { executor, calls } = setup();
  await recoverInbox(executor, config, {
    listReceived: async function* () {
      yield* [];
    },
    getSent: vi.fn(),
    getReceived: vi.fn(),
    stopContact: vi.fn(),
    now: () => now,
  });
  for (const marker of [
    'inbox-unbound',
    'inbox-list-pending',
    'inbox-list-unforwarded',
  ]) {
    expect(calls.find((call) => call.marker === marker)?.sql).toContain(
      'limit 100'
    );
  }
  expect(
    calls.find((call) => call.marker === 'inbox-list-pending')?.sql
  ).toContain('(reference_ids is null) desc');
  expect(
    calls.find((call) => call.marker === 'inbox-recovery-complete')?.sql
  ).toContain('scan_complete');
  expect(
    calls.find((call) => call.marker === 'inbox-recovery-complete')?.sql
  ).toContain('forward_provider_id is null');
});

test.each(['enumeration', 'admission'])(
  '%s failure preserves the last durable scan cursor',
  async (failure) => {
    const { executor, calls } = setup({
      'inbox-recovery-start': () => ({
        rows: [
          {
            healthy_through: null,
            scan_cursor: 'saved',
            scan_started_at: now,
            scan_complete: false,
          },
        ],
      }),
    });
    await expect(
      recoverInbox(executor, config, {
        listReceived: async function* (after?: string) {
          expect(after).toBe('saved');
          if (failure === 'enumeration')
            throw new Error('expired provider cursor');
          yield {
            id: 'invalid-mail',
            to: [config.address],
            created_at: 'invalid timestamp',
          };
        },
        getSent: vi.fn(),
        getReceived: vi.fn(),
        stopContact: vi.fn(),
        now: () => now,
      })
    ).rejects.toThrow();
    expect(calls.some((call) => call.marker === 'inbox-scan-progress')).toBe(
      false
    );
    expect(
      calls.some((call) => call.marker === 'inbox-recovery-complete')
    ).toBe(false);
  }
);

test('large retained mailbox catches up across cron runs then publishes fresh incremental health', async () => {
  let virtualNow = new Date('2026-10-22T01:00:00Z');
  const state = {
    recovery_id: null as string | null,
    healthy_through: null as Date | null,
    scan_cursor: null as string | null,
    scan_started_at: null as Date | null,
    scan_complete: false,
    scan_head_id: null as string | null,
    covered_head_id: null as string | null,
  };
  const { executor, calls } = setup({
    'inbox-recovery-start': (params, sql) => {
      if (state.recovery_id === null) {
        state.scan_cursor = null;
        state.scan_complete = false;
        state.scan_started_at = params[2] as Date;
        if (sql.includes('scan_head_id = case')) state.scan_head_id = null;
      }
      state.recovery_id = params[1] as string;
      return { rows: [{ ...state }] };
    },
    'inbox-recovery-generation-lock': (params) => ({
      rows:
        state.recovery_id === params[1] ? [{ address: config.address }] : [],
    }),
    'inbox-scan-progress': (params, sql) => {
      if (state.recovery_id !== params[1]) return { rows: [] };
      state.scan_cursor = (params[2] as string | null) ?? state.scan_cursor;
      state.scan_complete = params[3] as boolean;
      if (sql.includes('scan_head_id ='))
        state.scan_head_id ??= params[4] as string | null;
      return { rows: [{ address: config.address }] };
    },
    'inbox-recovery-complete': (params, sql) => {
      if (state.recovery_id !== params[1] || !state.scan_complete)
        return { rows: [] };
      state.healthy_through = params[2] as Date;
      state.recovery_id = null;
      if (sql.includes('covered_head_id ='))
        state.covered_head_id = state.scan_head_id ?? state.covered_head_id;
      return { rows: [{ address: config.address }] };
    },
    'read-resend-mailbox-recovery-pause': () => ({
      rows: [
        {
          paused:
            state.recovery_id !== null ||
            state.healthy_through === null ||
            virtualNow.getTime() - state.healthy_through.getTime() > 600000,
        },
      ],
    }),
  });
  const retained = Array.from({ length: 305 }, (_, index) => ({
    id: `retained-${305 - index}`,
    to: ['other@example.com'],
    created_at: now.toISOString(),
  }));
  let fetched = 0;
  const deps = {
    listReceived: async function* (after?: string) {
      const start = after
        ? retained.findIndex((item) => item.id === after) + 1
        : 0;
      for (const item of retained.slice(start)) {
        fetched++;
        yield item;
      }
    },
    getSent: vi.fn(),
    getReceived: vi.fn(),
    stopContact: vi.fn(),
    now: () => virtualNow,
  };
  for (let run = 0; run < 3; run++) {
    expect((await recoverInbox(executor, config, deps)).complete).toBe(false);
    expect(await readInboxRecoveryPaused(executor, virtualNow)).toBe(true);
    virtualNow = new Date(virtualNow.getTime() + 300000);
  }
  expect((await recoverInbox(executor, config, deps)).complete).toBe(true);
  expect(await readInboxRecoveryPaused(executor, virtualNow)).toBe(true);
  expect(state.covered_head_id).toBe('retained-305');
  virtualNow = new Date(virtualNow.getTime() + 300000);
  retained.unshift({
    id: 'new-arrival',
    to: ['other@example.com'],
    created_at: virtualNow.toISOString(),
  });
  fetched = 0;
  expect((await recoverInbox(executor, config, deps)).complete).toBe(true);
  expect(fetched).toBe(2);
  expect(state.covered_head_id).toBe('new-arrival');
  expect(state.healthy_through).toEqual(virtualNow);
  expect(await readInboxRecoveryPaused(executor, virtualNow)).toBe(false);
  expect(
    calls.find((call) => call.marker === 'inbox-recovery-complete')?.sql
  ).toContain('recovery_id = $2::uuid');
});

test('active send scope includes pre-created jobs accepted after receiving began', async () => {
  const { executor, calls } = setup();
  await recoverInbox(executor, config, {
    listReceived: async function* () {
      yield* [];
    },
    getSent: vi.fn(),
    getReceived: vi.fn(),
    stopContact: vi.fn(),
    now: () => now,
  });
  for (const marker of ['inbox-unbound', 'inbox-recovery-complete']) {
    const sql = calls.find((call) => call.marker === marker)?.sql;
    expect(sql).toContain('or exists (');
    expect(sql).toContain(
      "accepted.event_key = 'job:' || j.id::text || ':provider-accepted'"
    );
    expect(sql).toContain('accepted.occurred_at >=');
  }
});
