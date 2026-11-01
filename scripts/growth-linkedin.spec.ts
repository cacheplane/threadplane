// This repository-level CLI spec deliberately sits outside the Nx growth project.
// eslint-disable-next-line @nx/enforce-module-boundaries
import type {
  LinkedInDenyEntry,
  LinkedInParseResult,
  SqlExecutor,
} from '../libs/growth/src/index.ts';
import {
  databaseHost,
  mainGrowthLinkedIn,
  parseArguments,
  resolveTarget,
  runGrowthLinkedIn,
  type GrowthLinkedInOperations,
  type GrowthLinkedInRunnerDependencies,
} from './growth-linkedin.mts';

const now = new Date('2026-11-01T12:00:00.000Z');

function harness(
  files: Record<string, string> = {},
  overrides: Partial<GrowthLinkedInRunnerDependencies> = {},
  operationOverrides: Partial<GrowthLinkedInOperations> = {}
) {
  const out: string[] = [];
  const err: string[] = [];
  const calls: Record<string, unknown[]> = {};
  const record =
    <T>(name: string, result: T) =>
    async (...args: unknown[]): Promise<T> => {
      (calls[name] ??= []).push(args);
      return result;
    };
  const operations: GrowthLinkedInOperations = {
    denyImport: record('denyImport', { added: 2, existing: 0, invalid: 1 }),
    denyAdd: record('denyAdd', { id: 'd1', created: true }),
    denyRemove: record('denyRemove', true),
    denyList: record('denyList', [] as LinkedInDenyEntry[]),
    leads: record('leads', []),
    decide: record('decide', 'applied' as const),
    deleteLead: record('deleteLead', true),
    ingestManual: record('ingestManual', { recorded: 1, dropped: 0 }),
    ...operationOverrides,
  } as GrowthLinkedInOperations;
  const deps: GrowthLinkedInRunnerDependencies = {
    operations,
    readFile: async (path) => {
      if (!(path in files)) throw new Error(`ENOENT ${path}`);
      return files[path];
    },
    isInsideGitWorktree: async () => false,
    parseEml: () => ({
      from: 'a@b.c',
      subject: 's',
      text: 't',
      html: null,
      headers: {},
    }),
    parse: () => ({ outcome: 'unparsed', reason: 'untrusted_sender' }),
    now: () => now,
    writeOutput: (line) => out.push(line),
    writeError: (line) => err.push(line),
    ...overrides,
  };
  return { deps, out, err, calls };
}

describe('growth:linkedin runner', () => {
  test('deny-import refuses a path inside a git worktree', async () => {
    const h = harness(
      { '/repo/deny.txt': 'company_name Acme' },
      { isInsideGitWorktree: async () => true }
    );
    const code = await runGrowthLinkedIn(
      ['deny-import', '--target=preview', '--file', '/repo/deny.txt'],
      h.deps
    );
    expect(code).toBe(2);
    expect(h.calls['denyImport']).toBeUndefined();
    expect(h.err.join('\n')).toMatch(/worktree/i);
  });

  test('deny-import parses kind value reason lines and skips blanks/comments', async () => {
    const h = harness({
      '/x/d.txt':
        'profile_url https://www.linkedin.com/in/x competitor\n# c\n\ncompany_name Acme Inc\n',
    });
    const code = await runGrowthLinkedIn(
      ['deny-import', '--target=preview', '--file', '/x/d.txt'],
      h.deps
    );
    expect(code).toBe(0);
    expect(h.calls['denyImport']).toEqual([
      [
        [
          'profile_url https://www.linkedin.com/in/x competitor',
          'company_name Acme Inc',
        ],
        'founder_cli_import',
      ],
    ]);
    expect(h.out).toEqual([
      '{"command":"deny-import","added":2,"existing":0,"invalid":1}',
    ]);
  });

  test('decide --approve requires a variant and text file', async () => {
    const h = harness({ '/t.txt': ' hello \n' });
    expect(
      await runGrowthLinkedIn(
        [
          'decide',
          '--target=preview',
          '--lead',
          'L1',
          '--approve',
          '--text-file',
          '/t.txt',
        ],
        h.deps
      )
    ).toBe(2);
    expect(
      await runGrowthLinkedIn(
        [
          'decide',
          '--target=preview',
          '--lead',
          'L1',
          '--approve',
          '--variant',
          'connection',
        ],
        h.deps
      )
    ).toBe(2);
    expect(h.calls['decide']).toBeUndefined();
  });

  test('decide --approve passes trimmed text and founder_cli', async () => {
    const h = harness({ '/t.txt': ' hello \n' });
    const code = await runGrowthLinkedIn(
      [
        'decide',
        '--target=preview',
        '--lead',
        'L1',
        '--approve',
        '--variant',
        'message',
        '--text-file',
        '/t.txt',
      ],
      h.deps
    );
    expect(code).toBe(0);
    expect(h.calls['decide']).toEqual([
      [
        {
          leadId: 'L1',
          decision: 'approve',
          variant: 'message',
          text: 'hello',
          decidedBy: 'founder_cli',
          now,
        },
      ],
    ]);
  });

  test('decide --reject prints the result', async () => {
    const h = harness();
    const code = await runGrowthLinkedIn(
      ['decide', '--target=preview', '--lead', 'L1', '--reject'],
      h.deps
    );
    expect(code).toBe(0);
    expect(h.out).toEqual([
      '{"command":"decide","leadId":"L1","result":"applied"}',
    ]);
  });

  test('decide exits 1 when the lead is not found', async () => {
    const h = harness({}, {}, { decide: async () => 'not_found' });
    expect(
      await runGrowthLinkedIn(
        ['decide', '--target=preview', '--lead', 'L1', '--deny'],
        h.deps
      )
    ).toBe(1);
  });

  test('replay prints the parser result without a target', async () => {
    const h = harness({ '/m.eml': 'raw' });
    const code = await runGrowthLinkedIn(
      ['replay', '--file', '/m.eml'],
      h.deps
    );
    expect(code).toBe(0);
    expect(h.out).toEqual([
      '{"outcome":"unparsed","reason":"untrusted_sender"}',
    ]);
  });

  test('a database verb without --target is a usage error', async () => {
    const h = harness();
    expect(await runGrowthLinkedIn(['deny-list'], h.deps)).toBe(2);
    expect(h.calls['denyList']).toBeUndefined();
  });

  test('deny-add, deny-remove, deny-list, leads, delete-lead route to operations', async () => {
    const h = harness();
    const t = '--target=production';
    await runGrowthLinkedIn(
      [
        'deny-add',
        t,
        '--kind',
        'company_name',
        '--value',
        'Acme',
        '--reason',
        'r',
      ],
      h.deps
    );
    await runGrowthLinkedIn(
      ['deny-remove', t, '--kind', 'company_name', '--value', 'Acme'],
      h.deps
    );
    await runGrowthLinkedIn(['deny-list', t, '--include-removed'], h.deps);
    await runGrowthLinkedIn(
      ['leads', t, '--status', 'new', '--limit', '5'],
      h.deps
    );
    await runGrowthLinkedIn(
      ['delete-lead', t, '--profile-url', 'https://www.linkedin.com/in/x'],
      h.deps
    );
    expect(h.calls['denyAdd']).toEqual([['company_name', 'Acme', 'r']]);
    expect(h.calls['denyRemove']).toEqual([['company_name', 'Acme']]);
    expect(h.calls['denyList']).toEqual([[true]]);
    expect(h.calls['leads']).toEqual([['new', 5]]);
    expect(h.calls['deleteLead']).toEqual([['https://www.linkedin.com/in/x']]);
  });

  test('ingest records a parsed email and exits 1 for an unparsed one', async () => {
    const parsed: LinkedInParseResult = {
      outcome: 'parsed',
      kind: 'reaction',
      actors: [],
      post: { urn: null, url: null },
      aggregateCount: null,
    } as unknown as LinkedInParseResult;
    const h = harness(
      { '/m.eml': 'raw' },
      {
        parse: () => parsed,
        parseEml: () => ({
          from: 'a',
          subject: null,
          text: null,
          html: null,
          headers: { date: 'Mon, 26 Oct 2026 10:00:00 +0000' },
        }),
      }
    );
    expect(
      await runGrowthLinkedIn(
        ['ingest', '--target=preview', '--file', '/m.eml'],
        h.deps
      )
    ).toBe(0);
    const [[input]] = h.calls['ingestManual'] as [
      [{ receiptId: string; receivedAt: Date }]
    ];
    expect(input.receiptId).toMatch(/^manual:[0-9a-f]{32}$/);
    expect(input.receivedAt.toISOString()).toBe('2026-10-26T10:00:00.000Z');

    const u = harness({ '/m.eml': 'raw' });
    expect(
      await runGrowthLinkedIn(
        ['ingest', '--target=preview', '--file', '/m.eml'],
        u.deps
      )
    ).toBe(1);
    expect(u.calls['ingestManual']).toBeUndefined();
    expect(u.out[0]).toContain('"outcome":"unparsed"');
  });
});

describe('growth:linkedin arguments and target', () => {
  test('parseArguments rejects unknown verbs and bad flags', () => {
    expect(() => parseArguments(['nope'])).toThrow(/Usage/);
    expect(() =>
      parseArguments(['leads', '--target=preview', '--status', 'bogus'])
    ).toThrow();
    expect(() =>
      parseArguments([
        'deny-add',
        '--target=preview',
        '--kind',
        'x',
        '--value',
        'y',
      ])
    ).toThrow();
  });

  test('resolveTarget reads the growth env vars and databaseHost hides credentials', () => {
    expect(
      resolveTarget('preview', {
        GROWTH_DATABASE_URL_PREVIEW: 'postgres://u:p@h.example/db',
      }).databaseUrl
    ).toBe('postgres://u:p@h.example/db');
    expect(() => resolveTarget('production', {})).toThrow(
      /GROWTH_DATABASE_URL_PRODUCTION/
    );
    expect(databaseHost('postgres://u:p@h.example/db')).toBe('h.example');
  });

  test('main prints the target line first and closes the executor', async () => {
    const out: string[] = [];
    let closed = false;
    const code = await mainGrowthLinkedIn(['deny-list', '--target=preview'], {
      env: { GROWTH_DATABASE_URL_PREVIEW: 'postgres://u:p@h.example/db' },
      createExecutor: () =>
        ({
          close: async () => {
            closed = true;
          },
        } as unknown as SqlExecutor),
      createOperations: () => harness().deps.operations,
      readFile: async () => '',
      isInsideGitWorktree: async () => false,
      now: () => now,
      writeOutput: (l) => out.push(l),
      writeError: () => undefined,
    });
    expect(code).toBe(0);
    expect(out[0]).toBe('target: preview (h.example)');
    expect(closed).toBe(true);
  });
});
