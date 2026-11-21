import { createServer, type Server } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createFilesystemClient } from './connection';
import { createFilesystemApplication } from './application';

/* eslint-disable @nx/enforce-module-boundaries -- Local test backend tooling is never bundled. */
// @ts-expect-error Local test-only JavaScript has no published declaration.
import { createAimockBackend } from '../../../../../scripts/react-cockpit/aimock-backend.mjs';
// @ts-expect-error Local test-only JavaScript has no published declaration.
import { createLanggraphProxy } from '../../../../../scripts/react-cockpit/langgraph-proxy.mjs';
// @ts-expect-error Local test-only JavaScript has no published declaration.
import { reactCockpitConfiguration } from '../../../../../scripts/react-cockpit/configuration.mjs';
/* eslint-enable @nx/enforce-module-boundaries */

// The real graph runs under `langgraph dev` on aimock fixtures shared with the
// Angular example (cockpit/deep-agents/filesystem/angular/e2e/fixtures). Each
// scenario is a tagged prompt; the in-process proxy records requests and holds
// or fails the next call (scripts/react-cockpit/langgraph-proxy.mjs).
const { backend: config } = reactCockpitConfiguration('deep-agents-filesystem');
const backend = createAimockBackend({ root: resolve(__dirname, '../../../../..'), backend: config });
beforeAll(() => backend.ensure(), 180000);
afterAll(() => backend.close());
type Handler = (request: unknown, response: unknown, pathname: string) => Promise<boolean>;
let server: Server | undefined,
  application: ReturnType<typeof createFilesystemApplication> | undefined;
afterEach(async () => {
  await application?.dispose();
  if (server)
    await new Promise<void>((done) => {
      server?.close(() => done());
      server?.closeAllConnections();
    });
});
const evidenceDirectory = mkdtempSync(
  '/tmp/threadplane-filesystem-task3-native-'
);
writeFileSync(
  '/tmp/threadplane-filesystem-task3-native-latest-directory.txt',
  evidenceDirectory
);
let evidenceNumber = 0;
async function setup() {
  const handle: Handler = createLanggraphProxy({
    upstream: `http://127.0.0.1:${config.langgraphPort}`,
    ready: () => backend.ensure(),
  });
  const http = createServer(async (req, res) => {
    if (!(await handle(req, res, new URL(req.url ?? '/', 'http://localhost').pathname))) {
      res.writeHead(404);
      res.end();
    }
  });
  server = http;
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw Error('No address');
  const base = `http://127.0.0.1:${address.port}`,
    client = createFilesystemClient({ apiUrl: base + '/api', headers: {} });
  const rawCheckpoints: unknown[] = [];
  const readExact = client.readCheckpoint;
  const read = vi
      .spyOn(client, 'readCheckpoint')
      .mockImplementation(async (...args) => {
        const raw = await readExact(...args);
        rawCheckpoints.push(raw);
        return raw;
      }),
    app = createFilesystemApplication(client);
  application = app;
  const lifecycle: unknown[] = [];
  let scenario = 'normal';
  const record = async (label: string) => {
    const snapshot = app.getSnapshot();
    lifecycle.push({
      label,
      phase: snapshot.phase,
      outcome: snapshot.outcome,
      threadId: snapshot.threadId,
      messages: snapshot.messages,
      toolCalls: snapshot.toolCalls,
      savedWorkspace: snapshot.savedWorkspace,
      observedWorkspace: snapshot.observedWorkspace,
      approval: snapshot.approval,
      decisionToken: snapshot.decisionToken,
    });
    writeFileSync(
      evidenceDirectory + '/' + String(evidenceNumber) + '.json',
      JSON.stringify(
        {
          scenario,
          lifecycle,
          rawCheckpoints,
          requests: await (await fetch(base + '/__requests')).json(),
        },
        null,
        2
      )
    );
  };
  evidenceNumber++;
  const submit = app.submit,
    decide = app.decide;
  // The scenario tag selects the scripted model turns (shared aimock fixtures).
  app.submit = async (text, ...rest) => {
    const result = await submit(`${text} [scenario:${scenario}]`, ...rest);
    await record('submit');
    return result;
  };
  app.decide = async (...args) => {
    const result = await decide(...args);
    await record('decision');
    return result;
  };
  const control = async (path: string) =>
    expect((await fetch(base + path, { method: 'POST' })).ok).toBe(true);
  const configure = async (
    nextScenario: string,
    extra: Record<string, boolean> = {}
  ) => {
    if (extra.failStream) await control('/__fail-stream');
    // The confirmation read of the saved checkpoint.
    if (extra.holdCheckpoint) await control('/__hold/state');
    scenario = nextScenario;
  };
  const release = async () => {
    await control('/__release-state');
    await control('/__release');
  };
  return { app, client, read, base, configure, release };
}

it('mount is inert and native submit pauses with actual note, exact whole batch approve confirms report', async () => {
  const f = await setup();
  expect(await (await fetch(f.base + '/__requests')).json()).toEqual([]);
  expect(await f.app.submit('Runway note')).toBe(true);
  expect(f.app.getSnapshot()).toMatchObject({
    phase: 'paused',
    canSubmit: false,
  });
  expect(f.app.getSnapshot().savedWorkspace.files.map((x) => x.path)).toEqual([
    '/notes/kase.txt',
  ]);
  expect(await f.app.decide('approve', f.app.getSnapshot().decisionToken)).toBe(
    true
  );
  expect(f.app.getSnapshot().phase).toBe('saved');
  expect(f.app.getSnapshot().savedWorkspace.files.map((x) => x.path)).toContain(
    '/reports/kase.md'
  );
  const requests: {
    body?: { command?: { resume: { decisions: unknown[] } } };
  }[] = await (await fetch(f.base + '/__requests')).json();
  expect(
    requests.filter((x) => x.body?.command).map((x) => x.body!.command!)
  ).toEqual([{ resume: { decisions: [{ type: 'approve' }] } }]);
}, 30000);
for (const scenario of [
  'batch',
  'duplicates',
  'report-overwrite',
  'delete',
  'reject-reproposal',
])
  it(
    'native ' +
      scenario +
      ' preserves ordered batch and original human across explicit decisions',
    async () => {
      const f = await setup();
      await f.configure(scenario);
      expect(await f.app.submit('Work on files')).toBe(true);
      expect(f.app.getSnapshot().phase).toBe('paused');
      const human = f.app
        .getSnapshot()
        .messages.filter((x) => x.role === 'user');
      const batch = f.app.getSnapshot().approval;
      if (!batch || batch.kind !== 'valid') throw Error('Expected valid batch');
      expect(batch?.kind).toBe('valid');
      expect(
        await f.app.decide(
          scenario === 'reject-reproposal' ? 'reject' : 'approve',
          f.app.getSnapshot().decisionToken
        )
      ).toBe(true);
      expect(
        f.app.getSnapshot().messages.filter((x) => x.role === 'user')
      ).toEqual(human);
      expect(f.app.getSnapshot().phase).toBe(
        ['reject-reproposal', 'report-overwrite', 'delete'].includes(scenario)
          ? 'paused'
          : 'saved'
      );
      if (['report-overwrite', 'delete'].includes(scenario)) {
        expect(
          await f.app.decide('approve', f.app.getSnapshot().decisionToken)
        ).toBe(true);
        expect(f.app.getSnapshot().phase).toBe('saved');
      }
      const requests: {
        body?: { command?: { resume: { decisions: unknown[] } } };
      }[] = await (await fetch(f.base + '/__requests')).json();
      expect(
        requests.filter((x) => x.body?.command)[0]?.body?.command?.resume
          .decisions
      ).toHaveLength(batch.actions.length);
    },
    30000
  );
it('reject does not predict a saved report and double decision sends once', async () => {
  const f = await setup();
  await f.app.submit('Files');
  const one = f.app.decide('reject', f.app.getSnapshot().decisionToken);
  expect(await f.app.decide('approve', f.app.getSnapshot().decisionToken)).toBe(
    false
  );
  expect(await one).toBe(true);
  expect(f.app.getSnapshot().phase).toBe('saved');
  expect(
    f.app.getSnapshot().savedWorkspace.files.map((x) => x.path)
  ).not.toContain('/reports/kase.md');
}, 30000);
for (const scenario of [
  'no-files',
  'read-only',
  'unchanged',
  'empty',
  'write-error',
  'edit',
])
  it(
    'actual ' + scenario + ' reconciles files without predictions',
    async () => {
      const f = await setup();
      await f.configure(scenario);
      expect(await f.app.submit('Files')).toBe(true);
      expect(f.app.getSnapshot().phase).toBe('saved');
    },
    30000
  );
it('first transport failure requires New and no retry authors a conversation', async () => {
  const f = await setup();
  await f.configure('normal', { failStream: true });
  expect(await f.app.submit('Files')).toBe(false);
  expect(f.app.getSnapshot().canSubmit).toBe(false);
  expect(await f.app.submit('Retry')).toBe(false);
  await f.app.newConversation();
  expect(await f.app.submit('Fresh')).toBe(true);
}, 30000);
it('failed checkpoint retains confirmed workspace and requires New', async () => {
  const f = await setup();
  await f.app.submit('Files');
  const saved = f.app.getSnapshot().savedWorkspace;
  f.read.mockRejectedValueOnce(Error('Exact read failed'));
  expect(await f.app.decide('approve', f.app.getSnapshot().decisionToken)).toBe(
    false
  );
  expect(f.app.getSnapshot()).toMatchObject({
    savedWorkspace: saved,
    phase: 'unconfirmed',
    canSubmit: false,
  });
}, 30000);
for (const cancel of ['stop', 'newConversation', 'dispose'] as const)
  it(
    cancel + ' invalidates held native completion and all later callbacks',
    async () => {
      const f = await setup();
      await f.configure('normal', { holdCheckpoint: true });
      const pending = f.app.submit('Files');
      expect(await f.app.submit('Twice')).toBe(false);
      await vi.waitFor(
        () => expect(f.app.getSnapshot().phase).toBe('confirming'),
        { timeout: 10000 }
      );
      await f.app[cancel]();
      const snapshot = f.app.getSnapshot();
      await f.release();
      await pending;
      expect(f.app.getSnapshot()).toBe(snapshot);
    },
    30000
  );
it('stale prior batch token cannot approve a replacement pause in the same view', async () => {
  const f = await setup();
  await f.configure('reject-reproposal');
  await f.app.submit('Files');
  const old = f.app.getSnapshot().decisionToken;
  expect(await f.app.decide('reject', old)).toBe(true);
  expect(f.app.getSnapshot().phase).toBe('paused');
  const before: { body?: { command?: unknown } }[] = await (
    await fetch(f.base + '/__requests')
  ).json();
  expect(await f.app.decide('approve', old)).toBe(false);
  expect(await (await fetch(f.base + '/__requests')).json()).toEqual(before);
  expect(f.app.getSnapshot().phase).toBe('paused');
}, 30000);
it('preflight external current head advancement prevents resume despite exact old checkpoint remaining readable', async () => {
  const f = await setup();
  await f.app.submit('Files');
  const token = f.app.getSnapshot().decisionToken;
  const head = (await f.client.readCurrent(
    f.app.getSnapshot().threadId!,
    new AbortController().signal
  )) as { checkpoint: Record<string, unknown> };
  vi.spyOn(f.client, 'readCurrent').mockResolvedValue({
    ...head,
    checkpoint: { ...head.checkpoint, checkpoint_id: 'external-new-head' },
  });
  const before: { body?: { command?: unknown } }[] = await (
    await fetch(f.base + '/__requests')
  ).json();
  expect(await f.app.decide('approve', token)).toBe(false);
  const after: { body?: { command?: unknown } }[] = await (
    await fetch(f.base + '/__requests')
  ).json();
  expect(after.filter((x) => x.body?.command)).toHaveLength(
    before.filter((x) => x.body?.command).length
  );
  expect(f.app.getSnapshot().canSubmit).toBe(false);
}, 30000);
for (const scenario of ['protected-edit', 'mixed'])
  it(
    'actual native ' +
      scenario +
      ' confirms the current protected subset and explicit second pause',
    async () => {
      const f = await setup();
      await f.configure(scenario);
      expect(await f.app.submit('Files')).toBe(true);
      expect(f.app.getSnapshot().phase).toBe('paused');
      if (scenario === 'mixed') {
        expect(f.app.getSnapshot().savedWorkspace.files).toEqual([]);
        expect(
          f.app.getSnapshot().toolCalls.filter((x) => x.status === 'pending')
        ).toHaveLength(3);
        expect(f.app.getSnapshot().approval?.kind).toBe('valid');
      }
      expect(
        await f.app.decide('approve', f.app.getSnapshot().decisionToken)
      ).toBe(true);
      if (scenario === 'protected-edit') {
        expect(f.app.getSnapshot().phase).toBe('paused');
        expect(f.app.getSnapshot().savedWorkspace.files[0]).toMatchObject({
          content: 'old old',
        });
        expect(
          await f.app.decide('approve', f.app.getSnapshot().decisionToken)
        ).toBe(true);
        expect(f.app.getSnapshot().savedWorkspace.files[0]).toMatchObject({
          content: 'new new',
        });
      }
      expect(f.app.getSnapshot().phase).toBe('saved');
    },
    30000
  );
it('later native read-only and unchanged turns retain exact saved files and canonical pre-human prefix', async () => {
  const f = await setup();
  expect(await f.app.submit('Initial files')).toBe(true);
  expect(await f.app.decide('approve', f.app.getSnapshot().decisionToken)).toBe(
    true
  );
  const saved = f.app.getSnapshot().savedWorkspace;
  const humans = f.app.getSnapshot().messages.filter((x) => x.role === 'user');
  for (const scenario of ['read-only', 'unchanged']) {
    await f.configure(scenario);
    expect(await f.app.submit('Keep files ' + scenario)).toBe(true);
    expect(f.app.getSnapshot().phase).toBe('saved');
    expect(f.app.getSnapshot().savedWorkspace).toEqual(saved);
  }
  expect(
    f.app
      .getSnapshot()
      .messages.filter((x) => x.role === 'user')
      .slice(0, 1)
  ).toEqual(humans);
  expect(
    f.app.getSnapshot().messages.filter((x) => x.role === 'user')
  ).toHaveLength(3);
}, 30000);
