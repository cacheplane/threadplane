import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { once } from 'node:events';
import { build } from 'vite';
import ts from 'typescript';
import { chromium, expect } from '@playwright/test';

export function lockedReactManifest(lock) {
  const entries = (names) => Object.fromEntries(names.map((name) => {
    const version = lock.packages?.[`node_modules/${name}`]?.version;
    if (!version) throw new Error(`Missing root lock version for ${name}`);
    return [name, version];
  }));
  return {
    private: true, type: 'module',
    dependencies: entries(['react', 'react-dom']),
    devDependencies: entries(['@types/react', '@types/react-dom', 'vite', 'typescript']),
  };
}

const catalog = [{ name: 'weather', description: 'Current weather' }, { name: 'count', description: 'Count values' }];
const toolCall = { type: 'ai', id: 'assistant-tool', content: '', tool_calls: [{ id: 'call-weather', name: 'weather', args: { city: 'Paris' }, type: 'tool_call' }] };
const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const textTrace = readFileSync(new URL('../../fixtures/react-parity/traces/langgraph-text-state.sse', import.meta.url), 'utf8');
const savedInterrupts = [
  { id: 'saved-approval', value: { question: 'Approve saved request?', choices: ['yes', 'no'] }, namespace: ['review', 'task-1'], when: 'during', resumable: true, ns: ['legacy-review'] },
  { id: 'saved-confirmation', value: 0, namespace: [], when: 'during', resumable: false, ns: [] },
];
const liveInterrupts = [
  { id: 'live-approval', value: { question: 'Approve action?', choices: ['yes', 'no'] }, namespace: ['review', 'live'], when: 'during', resumable: true, ns: ['legacy-live'] },
  { id: 'live-confirmation', value: false, namespace: [], when: 'during', resumable: false, ns: [] },
];
const savedHistory = [{
  values: { stage: 'saved', profile: { name: 'Saved user' }, messages: [
    { id: 'saved-human', type: 'human', content: 'Saved question' },
    { id: 'saved-tools', type: 'ai', content: 'Saved tool request', tool_calls: [
      { id: 'saved-weather', name: 'weather', args: { city: 'Paris' }, type: 'tool_call' },
      { id: 'saved-count', name: 'count', args: { values: ['saved'] }, type: 'tool_call' },
    ] },
    { id: 'saved-result', type: 'tool', tool_call_id: 'saved-weather', content: 'Raw historical weather result' },
    { id: 'saved-final', type: 'ai', content: [{ type: 'text', text: 'Saved final answer' }] },
  ] },
  next: ['review', 'confirmation'],
  tasks: savedInterrupts.map((interrupt, index) => ({ id: `saved-task-${index}`, name: index === 0 ? 'review' : 'confirmation', error: null, checkpoint: null, state: null, interrupts: [interrupt] })),
  metadata: {},
  checkpoint: { thread_id: 'fixture-thread', checkpoint_ns: '', checkpoint_id: 'saved-checkpoint', checkpoint_map: {} },
  parent_checkpoint: null,
  created_at: '2026-09-21T00:00:00Z',
}];

/** A strict wire fixture: malformed/extra operations fail the browser run. */
export function runtimeResponse(body) {
  assert.deepEqual(body.input?.client_tools, catalog, 'exact client tool catalog');
  assert.equal(body.assistant_id, 'fixture-assistant');
  assert.deepEqual(body.stream_mode, ['values', 'messages-tuple', 'updates', 'custom']);
  assert.equal(body.stream_subgraphs, true);
  assert.equal(body.input.messages.length, 1);
  const message = body.input.messages[0];
  assert.deepEqual(body, { assistant_id: 'fixture-assistant', input: { messages: [message], client_tools: catalog }, stream_mode: ['values', 'messages-tuple', 'updates', 'custom'], stream_subgraphs: true }, 'unexpected run fields');
  if (message.type === 'tool') {
    assert.deepEqual(message, { id: 'client-tool-result-call-weather', type: 'tool', role: 'tool', tool_call_id: 'call-weather', content: '{"city":"Paris","temperature":20}' }, 'actual handler result continuation');
    return sse('values', { messages: [toolCall, message, { type: 'ai', id: 'answer', content: '20 degrees' }] });
  }
  assert.equal(message.type, 'human');
  assert.equal(typeof message.id, 'string');
  assert.deepEqual(message, { id: message.id, type: 'human', content: message.content }, 'exact user message fields');
  if (message.content === 'Send') return textTrace.replaceAll('message-parity', `answer-${message.id}`)
    + sse('values|child', { type: 'values', namespace: [], stage: 'child' })
    + sse('updates', { writer: { stage: 'node-update' } })
    + sse('custom', { __interrupt__: [], stage: 'custom' })
    + sse('values|child', { __interrupt__: [], stage: 'child-control' });
  if (message.content === 'Pause') return sse('values', { stage: 'approval', messages: [message, { type: 'ai', id: `pause-${message.id}`, content: 'Waiting for approvals' }] })
    + sse('values', { __interrupt__: [liveInterrupts[0]], stage: 'control-envelope' })
    + sse('updates', { __interrupt__: [liveInterrupts[1]] });
  if (message.content === 'Tool') return sse('values', { messages: [message, toolCall] });
  if (message.content === 'Error') return sse('error', { error: 'FixtureFailure', message: 'PRIVATE backend diagnostic' });
  if (message.content === 'Hold') return null;
  throw new Error(`Unexpected input ${message.content}`);
}

export function installedTypeSource(template, kind) {
  if (kind === 'core') return template;
  const binding = kind === 'react' ? 'useAgent' : 'observeAgent';
  const entry = kind === 'angular' ? './src/runtime-entry.js' : './runtime-entry.js';
  return template.replace('/* BINDING_IMPORT */', `import { ${binding} } from '@threadplane/${kind}';\nimport type { createFixtureSession } from '${entry}';`)
    .replace('export function assertSnapshot(snapshot: AgentSnapshot<FixtureTools>) {', `export function assertSnapshot(session: ReturnType<typeof createFixtureSession>) {\n  const snapshot = ${binding}(session)${kind === 'angular' ? '()' : ''};\n  const exact: AgentSnapshot<FixtureTools> = snapshot;\n  void exact;`)
    .replace('/* BACKEND_VALUES */', `const direct = session.getSnapshot();
  const directValues: Readonly<Record<string, PlainValue>> | undefined = direct.values;
  const values: Readonly<Record<string, PlainValue>> | undefined = snapshot.values;
  // @ts-expect-error No application schema is inferred from the broad values map.
  const assumedCounter: number = snapshot.values?.['counter'];
  // @ts-expect-error Concrete backend fields remain readonly.
  snapshot.values = {};
  if (snapshot.values) {
    // @ts-expect-error Application records remain readonly.
    snapshot.values['counter'] = 2;
    const nested = snapshot.values['profile'];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      // @ts-expect-error Nested application records remain readonly.
      nested['name'] = 'mutable';
    }
  }
  const directInterrupts: readonly { readonly value?: PlainValue }[] = direct.interrupts;
  const interrupts = snapshot.interrupts;
  const payload = interrupts[0]?.value;
  const plainPayload: PlainValue = payload;
  const id: string | undefined = interrupts[0]?.id;
  const namespace: readonly string[] | undefined = interrupts[0]?.namespace;
  const legacyNamespace: readonly string[] | undefined = interrupts[0]?.ns;
  const when: string | undefined = interrupts[0]?.when;
  const resumable: boolean | undefined = interrupts[0]?.resumable;
  // @ts-expect-error The concrete interrupt field remains readonly.
  snapshot.interrupts = [];
  // @ts-expect-error The batch remains readonly.
  interrupts.push({ value: false });
  // @ts-expect-error SDK namespace metadata remains readonly.
  interrupts[0].namespace?.push('changed');
  // @ts-expect-error Broad interrupt data does not infer an application schema.
  const assumedApproval: { approved: boolean } = payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    // @ts-expect-error Nested interrupt payloads remain readonly.
    payload['approved'] = true;
  }
  void [directValues, values, assumedCounter, directInterrupts, plainPayload, id, namespace, legacyNamespace, when, resumable, assumedApproval];`)
    .replace('  assertSnapshot(snapshot);', '  void snapshot;');
}

export function prepareInstalledTypes(root, consumer, kind) {
  const fixture = join(root, 'fixtures/react-parity/runtime');
  cpSync(join(fixture, 'scenarios.ts'), join(consumer, 'scenarios.ts'));
  writeFileSync(join(consumer, 'installed-types.ts'), installedTypeSource(readFileSync(join(fixture, 'installed-types.ts'), 'utf8'), kind));
  writeFileSync(join(consumer, 'tsconfig.contracts.json'), JSON.stringify({ compilerOptions: {
    target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['ES2022', 'DOM'], types: [], strict: true, skipLibCheck: false, noEmit: true,
  }, files: ['installed-types.ts'] }, null, 2));
}

/** Typecheck the private source against the *installed* public core declarations,
 * emit to temporary storage, and copy only the narrow entry declaration. This
 * resolution override is confined to checking private source; neither installed
 * consumer config has paths/aliases, and no core implementation is bundled. */
function emitRuntimeDeclaration(root, consumer, output) {
  const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ['lib.es2022.d.ts', 'lib.esnext.disposable.d.ts', 'lib.dom.d.ts'], types: [], strict: true, skipLibCheck: false, declaration: true, emitDeclarationOnly: true, rootDir: root, outDir: output };
  const host = ts.createCompilerHost(options);
  host.resolveModuleNames = (names, containingFile) => names.map((name) => ts.resolveModuleName(name,
    name === '@threadplane/core' || name === '@threadplane/core/tools' ? join(consumer, 'installed-types.ts') : containingFile, options, ts.sys).resolvedModule);
  const program = ts.createProgram([join(root, 'fixtures/react-parity/runtime/runtime-entry.ts')], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: (name) => name, getNewLine: () => '\n' }));
  const result = program.emit();
  assert.equal(result.emitSkipped, false, 'runtime fixture declaration emitted');
}

export async function prepareRuntimeConsumer(root, consumer, kind) {
  const fixture = join(root, 'fixtures/react-parity/runtime');
  const temporary = mkdtempSync(join(tmpdir(), 'threadplane-runtime-bundle-'));
  try {
    emitRuntimeDeclaration(root, consumer, join(temporary, 'types'));
    const result = await build({ configFile: false, root, logLevel: 'warn', build: {
      outDir: join(temporary, 'bundle'), emptyOutDir: true, minify: false,
      lib: { entry: join(fixture, 'runtime-entry.ts'), formats: ['es'], fileName: () => 'runtime-entry.js' },
      rollupOptions: { external: ['@threadplane/core', '@threadplane/core/tools'] },
    } });
    const chunks = (Array.isArray(result) ? result : [result]).flatMap((entry) => entry.output);
    const modules = chunks.flatMap((chunk) => Object.keys(chunk.modules ?? {}));
    assert.ok(modules.some((path) => path.includes('/@langchain/langgraph-sdk/')), 'real SDK must be in private fixture bundle');
    assert.ok(modules.some((path) => path.endsWith('/transport/fetch-stream.transport.ts')), 'production transport must be in private fixture bundle');
    assert.ok(!modules.some((path) => /\/libs\/(?:core|react|angular)\//.test(path) || /\/node_modules\/(?:@angular|react|react-dom)\//.test(path)), 'fixture must externalize public core and exclude framework implementations');
    const destination = kind === 'angular' ? join(consumer, 'src') : consumer;
    cpSync(join(temporary, 'bundle/runtime-entry.js'), join(destination, 'runtime-entry.js'));
    cpSync(join(temporary, 'types/fixtures/react-parity/runtime/runtime-entry.d.ts'), join(destination, 'runtime-entry.d.ts'));
    cpSync(join(fixture, 'scenarios.ts'), join(destination, 'scenarios.ts'));
    cpSync(join(fixture, 'review.css'), join(destination, 'review.css'));
    cpSync(join(fixture, `${kind}-app.${kind === 'react' ? 'tsx' : 'ts'}`), join(destination, kind === 'react' ? 'main.tsx' : 'main.ts'));
    if (kind === 'angular') {
      const configPath = join(consumer, 'angular.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      config.projects.consumer.architect.build.options.styles = ['src/review.css'];
      writeFileSync(configPath, JSON.stringify(config));
      const index = join(destination, 'index.html');
      writeFileSync(index, readFileSync(index, 'utf8').replace('<head>', '<head><meta name="viewport" content="width=device-width, initial-scale=1">'));
    }
    if (kind === 'react') {
      cpSync(join(fixture, 'vite.config.mts'), join(consumer, 'vite.config.mts'));
      writeFileSync(join(consumer, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>React installed consumer</title></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>');
      writeFileSync(join(consumer, 'tsconfig.app.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['ES2022', 'DOM'], types: [], strict: true, skipLibCheck: false, jsx: 'react-jsx', noEmit: true }, files: ['main.tsx'] }));
    }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

/** Bounded fixture server: built files and deterministic history/run routes. */
export async function serveRuntimeConsumer(directory) {
  const requests = [];
  const historyRequests = [];
  const errors = [];
  const held = new Set();
  let notifyHeld;
  let notifyAborted;
  const holdStarted = new Promise((resolve) => { notifyHeld = resolve; });
  const holdAborted = new Promise((resolve) => { notifyAborted = resolve; });
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://fixture').pathname;
      if (pathname.startsWith('/api/')) {
        assert.equal(request.method, 'POST');
        assert.ok(['/api/threads/fixture-thread/history', '/api/threads/fixture-thread/runs/stream'].includes(pathname), 'only expected history/run endpoint');
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        if (pathname === '/api/threads/fixture-thread/history') {
          assert.deepEqual(body, { limit: 10 }, 'exact SDK history body');
          assert.ok(historyRequests.length < 3, 'only three explicit history reads');
          historyRequests.push(body);
          response.writeHead(200, { 'content-type': 'application/json' });
          return response.end(JSON.stringify(historyRequests.length < 3 ? savedHistory : []));
        }
        requests.push(body);
        const trace = runtimeResponse(body);
        response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        if (trace !== null) return response.end(trace);
        held.add(response);
        response.once('close', () => { held.delete(response); notifyAborted(); });
        // Actual incremental network bytes, not a whole-response route.fulfill.
        response.write(sse('values', { stage: 'held', transient: true }) + sse('messages', [{ type: 'AIMessageChunk', id: 'held-answer', content: 'Held partial' }, { langgraph_node: 'assistant' }]));
        notifyHeld();
        return;
      }
      assert.equal(request.method, 'GET');
      if (pathname === '/favicon.ico') { response.writeHead(204); return response.end(); }
      const file = resolve(directory, `.${pathname === '/' ? '/index.html' : pathname}`);
      assert.ok(file.startsWith(resolve(directory) + sep) && existsSync(file), `Unexpected request ${pathname}`);
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ico': 'image/x-icon' }[extname(file)] ?? 'application/octet-stream';
      response.writeHead(200, { 'content-type': type });
      response.end(readFileSync(file));
    } catch (error) {
      errors.push(error);
      response.writeHead(500);
      response.end('Fixture request rejected');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${server.address().port}`, requests, historyRequests, errors, holdStarted, holdAborted,
    async close() {
      for (const response of held) response.destroy();
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}

function handshake(promise, label) {
  let timeout;
  return Promise.race([promise, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`Timed out awaiting ${label}`)), 10_000); })]).finally(() => clearTimeout(timeout));
}

export async function runRuntimeScenarios(directory, kind) {
  const server = await serveRuntimeConsumer(directory);
  let browser;
  let context;
  const pageErrors = [];
  const unexpected = [];
  const completed = [];
  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    const page = await context.newPage();
    const expectValues = (value) => expect(page.getByTestId('values')).toHaveText(value === undefined ? 'unobserved' : JSON.stringify(value));
    const expectInterrupts = (interrupts) => expect(page.getByTestId('interrupts')).toHaveText(JSON.stringify(interrupts));
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => {
      if (!request.url().startsWith(`${server.url}/`)) unexpected.push(request.url());
    });
    await page.goto(server.url);
    await expect(page.getByTestId('status')).toHaveText('idle');
    await expect(page.getByTestId('owner')).toHaveText('mounted');
    await expect(page.getByTestId('handler-calls')).toHaveText('0');
    await expect(page.getByTestId('submissions')).toHaveText('0');
    await expectValues(undefined);
    await expectInterrupts([]);
    assert.equal(server.requests.length, 0, 'mount/observation performs no I/O');
    assert.equal(server.historyRequests.length, 0, 'mount/observation performs no history reads');
    completed.push('inert mount');

    await page.getByRole('button', { name: 'Load', exact: true }).click();
    await expect(page.getByTestId('loads-finished')).toHaveText('1');
    await expect(page.getByTestId('load-error')).toHaveText('');
    await expectValues({ stage: 'saved', profile: { name: 'Saved user' } });
    await expectInterrupts(savedInterrupts);
    await expect(page.getByTestId('text')).toHaveText('Saved tool request\nSaved final answer');
    await expect(page.getByTestId('transcript')).toContainText('Saved question');
    await expect(page.getByTestId('transcript')).toContainText('Raw historical weather result');
    await expect(page.getByTestId('delivery')).toHaveText('complete:paused');
    await expect(page.getByTestId('status')).toHaveText('idle');
    assert.deepEqual(JSON.parse(await page.getByTestId('tool').innerText()), [{ id: 'saved-count', name: 'count', args: { values: ['saved'] }, status: 'pending' }]);
    assert.equal(server.historyRequests.length, 1);
    assert.equal(server.requests.length, 0);
    await expect(page.getByTestId('handler-calls')).toHaveText('0');
    completed.push('explicit history load');

    await page.getByRole('button', { name: 'Load', exact: true }).click();
    await expect(page.getByTestId('loads-finished')).toHaveText('2');
    await expect(page.getByTestId('load-error')).toHaveText('');
    await expectValues({ stage: 'saved', profile: { name: 'Saved user' } });
    await expectInterrupts(savedInterrupts);
    await expect(page.getByTestId('delivery')).toHaveText('complete:paused');
    await expect(page.getByTestId('text')).toHaveText('Saved tool request\nSaved final answer');
    await expect(page.getByTestId('handler-calls')).toHaveText('0');
    assert.equal(server.historyRequests.length, 2);
    assert.equal(server.requests.length, 0);
    completed.push('equal history refresh');

    await page.getByRole('button', { name: 'Load', exact: true }).click();
    await expect(page.getByTestId('loads-finished')).toHaveText('3');
    await expect(page.getByTestId('load-error')).toHaveText('');
    await expectValues(undefined);
    await expectInterrupts([]);
    await expect(page.getByTestId('text')).toHaveText('');
    await expect(page.getByTestId('transcript')).toHaveText('');
    await expect(page.getByTestId('tool')).toHaveText('[]');
    await expect(page.getByTestId('handler-calls')).toHaveText('0');
    assert.equal(server.historyRequests.length, 3);
    assert.equal(server.requests.length, 0);
    completed.push('empty history replacement');

    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByTestId('text')).toHaveText('Hello 🌍.');
    await expect(page.getByTestId('delivery')).toHaveText('complete:success');
    await expect(page.getByTestId('status')).toHaveText('idle');
    assert.equal(server.requests.length, 1);
    await expectValues({ stage: 'complete' });
    await expectInterrupts([]);
    completed.push('text success');

    const beforeTool = server.requests.length;
    await page.getByRole('button', { name: 'Tool', exact: true }).click();
    await expect(page.getByTestId('text')).toContainText('20 degrees');
    await expect(page.getByTestId('handler-calls')).toHaveText('1');
    await expect(page.getByTestId('status')).toHaveText('idle');
    assert.deepEqual(JSON.parse(await page.getByTestId('tool').innerText()), [{ id: 'call-weather', name: 'weather', args: { city: 'Paris' }, status: 'complete', result: { city: 'Paris', temperature: 20 } }]);
    assert.equal(server.requests.length - beforeTool, 2, 'tool has exactly one run and one result continuation');
    await expectValues({});
    completed.push('tool roundtrip');

    await page.getByRole('button', { name: 'Error', exact: true }).click();
    await expect(page.getByTestId('status')).toHaveText('error');
    await expect(page.getByTestId('error')).not.toHaveText('');
    await expect(page.getByTestId('error')).not.toContainText('PRIVATE');
    assert.equal(server.requests.length, 4, 'failed run is not retried');
    await expectValues({});
    completed.push('visible protected error');

    await page.getByRole('button', { name: 'Hold', exact: true }).click();
    await handshake(server.holdStarted, 'held request');
    await expect(page.getByTestId('text')).toContainText('Held partial');
    await expect(page.getByTestId('delivery')).toHaveText('streaming');
    await expect(page.getByTestId('status')).toHaveText('running');
    await expectValues({ stage: 'held', transient: true });
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await handshake(server.holdAborted, 'native request abort');
    await expect(page.getByTestId('status')).toHaveText('idle');
    await expect(page.getByTestId('delivery')).toHaveText('complete:aborted');
    assert.equal(server.requests.length, 5);
    await expectValues({ stage: 'held', transient: true });
    completed.push('incremental DOM update and stop abort');

    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByTestId('delivery')).toHaveText('complete:paused');
    await expect(page.getByTestId('status')).toHaveText('idle');
    await expect(page.getByTestId('text')).toContainText('Waiting for approvals');
    await expectValues({ stage: 'approval' });
    await expectInterrupts(liveInterrupts);
    await expect(page.getByTestId('handler-calls')).toHaveText('1');
    assert.equal(server.requests.length, 6, 'pause creates exactly one run with no tool continuation');
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expectInterrupts(liveInterrupts);
    await expect(page.getByTestId('delivery')).toHaveText('complete:paused');
    assert.equal(server.requests.length, 6, 'stop after completed pause does not create backend I/O');
    completed.push('full interrupt batch and retained pause after stop');

    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByTestId('delivery')).toHaveText('complete:success');
    await expect(page.getByTestId('status')).toHaveText('idle');
    await expect(page.getByTestId('text')).toContainText('Hello 🌍.');
    await expect(page.getByTestId('handler-calls')).toHaveText('1');
    assert.equal(server.requests.length, 7);
    await expectValues({ stage: 'complete' });
    await expectInterrupts([]);
    await expect(page.getByTestId('submissions')).toHaveText('6');
    completed.push('reuse after stop');

    await page.getByRole('button', { name: 'Unmount', exact: true }).click();
    await expect(page.getByTestId('owner')).toHaveText('unmounted');
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Dispose', exact: true }).click();
    await expect(page.getByTestId('owner')).toHaveText('disposed');
    await page.getByRole('button', { name: 'Send after dispose', exact: true }).click();
    await expect(page.getByTestId('owner')).toHaveText('aborted');
    assert.equal(server.requests.length, 7, 'cleanup/disposal/post-disposal submit creates no extra runs');
    assert.deepEqual(server.historyRequests, [{ limit: 10 }, { limit: 10 }, { limit: 10 }], 'only explicit loads read history');
    completed.push('unmount and explicit disposal');
    assert.deepEqual(server.errors.map(String), []);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(unexpected, []);
    console.log(`${kind}: ${completed.length} browser scenarios passed (${completed.join('; ')}); 3 exact history reads, 7 exact run requests, one tool handler, 6 component submissions, no page errors/unexpected requests.`);
    return completed;
  } finally {
    try { await context?.close(); }
    finally {
      try { await browser?.close(); }
      finally { await server.close(); }
    }
  }
}
