import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { observeProvider } from './canonical-provider';

test(
  'backup setup writes pass through without summary faults or control endpoints',
  { timeout: 10000 },
  async (t) => {
    const bodies: unknown[] = [];
    const upstream = createServer(async (request, response) => {
      let body = '';
      for await (const part of request) body += part;
      bodies.push(JSON.parse(body));
      response.setHeader('content-type', 'application/json');
      response.end('{"checkpoint_id":"owned"}');
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, '127.0.0.1', resolve)
    );
    t.after(
      () =>
        new Promise<void>((resolve) => {
          upstream.closeAllConnections();
          upstream.close(() => resolve());
        })
    );
    const address = upstream.address();
    assert.ok(address && typeof address !== 'string');
    const observer = await Reflect.apply(observeProvider, undefined, [
      address.port,
      'backup-effect',
    ]);
    t.after(() => observer.close());
    for (let index = 0; index < 3; index++) {
      const body = { values: { backups: [{ id: 'owned-' + index }] } };
      const response = await fetch(
        observer.url + '/threads/owned-' + index + '/state',
        { method: 'POST', body: JSON.stringify(body) }
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { checkpoint_id: 'owned' });
      assert.deepEqual(bodies[index], body);
    }
    assert.equal(observer.controlUrl, undefined);
    assert.deepEqual(observer.controls, []);
    assert.equal(observer.requests.length, 3);
    assert.deepEqual(observer.forwardedRequests, observer.requests);
  }
);

import { acceptBackupCapture } from './backup-provider';
import { inventory, prompts } from './backup-provider-contract';

// These are rejection controls, not actual provider acceptance evidence.
for (const [name, capture] of [
  [
    'test Operations',
    { scenario: 'backup-effect', testOperations: true, cleanupConfirmed: true },
  ],
  ['missing cleanup', { scenario: 'backup-effect', testOperations: false }],
  [
    'unknown scenario',
    { scenario: 'other', testOperations: false, cleanupConfirmed: true },
  ],
  [
    'missing cases',
    {
      scenario: 'backup-effect',
      testOperations: false,
      cleanupConfirmed: true,
      proof: {},
    },
  ],
] as const)
  test('backup acceptance rejects ' + name, () => {
    assert.throws(() =>
      Reflect.apply(acceptBackupCapture, undefined, [capture])
    );
  });

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  scenarios,
  seed,
  remaining,
  deletionResult,
  emptyListResult,
  listPrompt,
  title,
} from './backup-provider-contract';
import { expectedClientTools } from './trip-summary-provider-contract';

function candidate() {
  const requests: {
    method: string;
    path: string;
    body?: unknown;
    status: number;
    upstreamStatus: number;
    forwarded: boolean;
    upstreamComplete: boolean;
    downstreamFinished: boolean;
  }[] = [];
  const push = (method: string, path: string, body?: unknown) =>
    requests.push({
      method,
      path,
      ...(body === undefined ? {} : { body }),
      status: method === 'DELETE' ? 204 : 200,
      upstreamStatus: method === 'DELETE' ? 204 : 200,
      forwarded: true,
      upstreamComplete: true,
      downstreamFinished: true,
    });
  const modelJournal: { body: { messages: unknown[]; tools: unknown[] } }[] =
    [];
  const cases = scenarios.map((scenario, index) => {
    const threadId = 'owned-' + scenario;
    const base = '/threads/' + threadId;
    const call = {
      type: 'tool_call',
      id: 'delete-' + scenario,
      name: 'delete_backups',
      args: { ids: ['proof-delete'] },
    };
    const list = {
      type: 'tool_call',
      id: 'list-empty',
      name: 'list_backups',
      args: { older_than_days: 0 },
    };
    const human = { type: 'human', content: prompts[scenario] };
    const assistant = { type: 'ai', content: '', tool_calls: [call] };
    const tool = {
      type: 'tool',
      content: JSON.stringify(deletionResult(scenario)),
      tool_call_id: call.id,
    };
    const listTool = {
      type: 'tool',
      content: JSON.stringify(emptyListResult),
      tool_call_id: list.id,
    };
    const paused = {
      values: { backups: seed(scenario), messages: [human, assistant] },
      next: ['tools'],
    };
    const saved = {
      values: {
        backups: remaining(scenario),
        messages: [human, assistant, tool],
      },
      next: [],
    };
    const final =
      scenario === 'empty'
        ? {
            values: {
              backups: [],
              messages: [
                ...saved.values.messages,
                { type: 'human', content: listPrompt },
                { type: 'ai', content: '', tool_calls: [list] },
                listTool,
              ],
            },
            next: [],
          }
        : saved;
    const id = String(index + 1).repeat(32);
    const stream = {
      stream_mode: ['values', 'messages-tuple', 'updates', 'custom'],
      stream_subgraphs: true,
      stream_resumable: true,
      on_disconnect: 'continue',
    };
    const submit = (prompt: string) => {
      push('POST', base + '/runs/stream', {
        assistant_id: 'chat',
        input: {
          messages: [
            {
              type: 'human',
              id: '12345678-1234-1234-1234-123456789abc',
              content: prompt,
            },
          ],
          client_tools: expectedClientTools,
        },
        ...stream,
      });
      push('GET', base + '/runs/owned-run');
    };
    const admit = () => {
      push('POST', '/threads/search', { limit: 50, offset: 0 });
      push('GET', base);
      push('POST', base + '/history', { limit: 10 });
    };
    push('POST', '/threads', {
      metadata: { title: title(scenario), graph_id: 'chat' },
    });
    push('POST', base + '/state', { values: { backups: seed(scenario) } });
    push('GET', base + '/state');
    admit();
    submit(prompts[scenario]);
    push('GET', base + '/state');
    push('POST', base + '/runs/stream', {
      assistant_id: 'chat',
      input: null,
      command: {
        resume: { [id]: scenario === 'decline' ? 'denied' : 'approved' },
      },
      ...stream,
    });
    push('GET', base + '/runs/owned-run');
    push('GET', base + '/state');
    if (scenario === 'empty') {
      submit(listPrompt);
      push('GET', base + '/state');
    }
    admit();
    push('DELETE', base);
    const user = { role: 'user', content: prompts[scenario] };
    const modelCall = (c: typeof call | typeof list) => ({
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.args) },
        },
      ],
    });
    const result = {
      role: 'tool',
      content: tool.content,
      tool_call_id: call.id,
    };
    const rounds: unknown[][] = [[user], [user, modelCall(call), result]];
    if (scenario === 'empty')
      rounds.push(
        [user, modelCall(call), result, { role: 'user', content: listPrompt }],
        [
          user,
          modelCall(call),
          result,
          { role: 'user', content: listPrompt },
          modelCall(list),
          { role: 'tool', content: listTool.content, tool_call_id: list.id },
        ]
      );
    for (const messages of rounds)
      modelJournal.push({
        body: {
          messages,
          tools: [
            ...expectedClientTools.map((definition) => ({
              type: 'function',
              function: definition,
            })),
            { type: 'function', function: { name: 'delete_backups' } },
            { type: 'function', function: { name: 'list_backups' } },
          ],
        },
      });
    return {
      scenario,
      threadId,
      checkpoint: { checkpoint_id: 'setup' },
      setup: {
        values: { backups: seed(scenario), messages: [] },
        next: ['generate'],
      },
      paused,
      saved,
      final,
      interrupt: {
        id,
        value: {
          type: 'approval_request',
          reason:
            'Delete 1 backups (2.5 GB): proof-delete. This permanently removes them from storage and cannot be undone.',
          ids: ['proof-delete'],
        },
      },
      restored: {
        backups: remaining(scenario),
        tools: final.values.messages
          .filter((m) => m.type === 'tool')
          .map((m) => ({
            content: m.content,
            tool_call_id: 'tool_call_id' in m ? m.tool_call_id : undefined,
          })),
        cards: 0,
      },
    };
  });
  return {
    scenario: 'backup-effect',
    accepted: false,
    testOperations: false,
    cleanupConfirmed: true,
    proof: { cases, modelJournal },
    requests,
    forwardedRequests: requests,
    controls: [],
  };
}

test('concrete backup acceptance checks complete synthetic control data before exclusive publication', () => {
  const directory = mkdtempSync(join(tmpdir(), 'backup-acceptance-'));
  try {
    const result = Reflect.apply(acceptBackupCapture, undefined, [
      candidate(),
      directory,
    ]);
    assert.equal(result.accepted, true);
    assert.equal(existsSync(join(directory, 'evidence.json')), true);
    assert.throws(
      () =>
        Reflect.apply(acceptBackupCapture, undefined, [candidate(), directory]),
      /EEXIST/
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
const mutations: [string, (value: ReturnType<typeof candidate>) => void][] = [
  [
    'directory before seed',
    (v) => {
      const index = v.requests.findIndex((q) => q.path === '/threads/search');
      v.requests.unshift(...v.requests.splice(index, 1));
    },
  ],
  [
    'remaining inventory',
    (v) => {
      v.proof.cases[0].saved.values.backups = inventory;
    },
  ],
  [
    'empty resurrection',
    (v) => {
      v.proof.cases[2].final.values.backups = inventory;
    },
  ],
  [
    'decline result',
    (v) => {
      v.proof.cases[1].saved.values.messages[2].content =
        '{"deleted":["proof-delete"]}';
    },
  ],
  [
    'lost call association',
    (v) => {
      const m = v.proof.cases[0].saved.values.messages[2];
      if ('tool_call_id' in m) m.tool_call_id = 'other';
    },
  ],
  [
    'extra human',
    (v) => {
      v.proof.cases[0].saved.values.messages.push({
        type: 'human',
        content: 'approved',
      });
    },
  ],
  [
    'changed restoration',
    (v) => {
      v.proof.cases[2].restored.backups = inventory;
    },
  ],
  [
    'missing continuation result',
    (v) => {
      v.proof.modelJournal[1].body.messages.pop();
    },
  ],
  [
    'extra model',
    (v) => {
      v.proof.modelJournal.push(v.proof.modelJournal[0]);
    },
  ],
  [
    'extra HTTP',
    (v) => {
      v.requests.push({ ...v.requests[0], path: '/unclassified' });
    },
  ],
  [
    'application state write',
    (v) => {
      v.requests.push({ ...v.requests[1] });
    },
  ],
  [
    'non-null resume input',
    (v) => {
      const q = v.requests.find(
        (q) => q.body && typeof q.body === 'object' && 'command' in q.body
      )!;
      q.body = { ...(q.body as object), input: { messages: [] } };
    },
  ],
  [
    'seed misclassification',
    (v) => {
      v.requests[1].body = { values: { backups: [] } };
    },
  ],
  [
    'wrong status',
    (v) => {
      v.requests[0].status = 503;
    },
  ],
  [
    'missing forwarded request',
    (v) => {
      v.forwardedRequests = v.requests.slice(1);
    },
  ],
];
for (const [name, mutate] of mutations)
  test('backup acceptance rejects ' + name + ' without publication', () => {
    const directory = mkdtempSync(join(tmpdir(), 'backup-rejection-'));
    try {
      const value = structuredClone(candidate());
      mutate(value);
      assert.throws(() =>
        Reflect.apply(acceptBackupCapture, undefined, [value, directory])
      );
      assert.equal(existsSync(join(directory, 'evidence.json')), false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
