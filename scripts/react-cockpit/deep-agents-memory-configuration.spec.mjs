import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from '@langchain/langgraph-sdk';
async function vacant(port) {
  const listener = createServer();
  listener.listen(port, '127.0.0.1');
  await once(listener, 'listening');
  await new Promise((r) => listener.close(r));
}
async function running(t, selection) {
  const { port } = reactCockpitConfiguration(selection);
  await vacant(port);
  const child = spawn(
    process.execPath,
    ['scripts/react-cockpit/serve.mjs', selection, '--no-parent'],
    {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let error = '';
  child.stderr.on('data', (b) => (error += b));
  const exited = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGTERM');
    await exited;
  });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw Error(error);
    try {
      await fetch(base + '/__lifetime');
      return { child, exited, base, port };
    } catch {
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  throw Error('Serve listener did not start: ' + error);
}
test(
  'serve dispatch keeps original LangGraph Memory separate and awaits actual Memory worker shutdown',
  { timeout: 30000 },
  async (t) => {
    const deep = await running(t, 'deep-agents-memory');
    const original = await running(t, 'memory');
    const sdk = new Client({
      apiUrl: deep.base + '/api',
      callerOptions: { maxRetries: 0 },
    });
    const thread = (await sdk.threads.create()).thread_id;
    const events = [];
    for await (const e of sdk.runs.stream(thread, 'da-memory', {
      input: {
        messages: [{ type: 'human', id: randomUUID(), content: 'offline' }],
      },
      context: { memory_scope: randomUUID() },
      streamMode: ['values', 'custom'],
    }))
      events.push(e);
    assert(
      events.some(
        (e) => e.event === 'custom' && e.data.name === 'deep_agents.memory'
      )
    );
    const originalSdk = new Client({
      apiUrl: original.base + '/api',
      callerOptions: { maxRetries: 0 },
    });
    const originalThread = randomUUID();
    await originalSdk.threads.create({ threadId: originalThread });
    const originalEvents = [];
    for await (const e of originalSdk.runs.stream(originalThread, 'memory', {
      input: {
        messages: [{ type: 'human', id: randomUUID(), content: 'Recall' }],
      },
      streamMode: ['values'],
    }))
      originalEvents.push(e);
    assert(
      originalEvents.some(
        (e) => e.event === 'values' && Object.hasOwn(e.data, 'memory')
      )
    );
    assert.equal(
      (await fetch(deep.base + '/__hold-extraction', { method: 'POST' }))
        .status,
      404
    );
    const deepLife = await (await fetch(deep.base + '/__lifetime')).json();
    assert.equal(deepLife.workers, 1);
    assert.deepEqual(
      await (await fetch(original.base + '/__lifetime')).json(),
      { active: false }
    );
    deep.child.kill('SIGTERM');
    await deep.exited;
    assert.throws(() => process.kill(deepLife.workerPid, 0), { code: 'ESRCH' });
    assert.throws(() => process.kill(deepLife.pythonPid, 0), { code: 'ESRCH' });
    await vacant(deep.port);
    original.child.kill('SIGTERM');
    await original.exited;
    await vacant(original.port);
  }
);
import { test } from 'node:test';
import { reactCockpitConfiguration } from './configuration.mjs';
test('Memory browser target runs the actual compiled fixture after installed builds', () => {
  const project = JSON.parse(readFileSync(new URL('../../cockpit/deep-agents/memory/react/project.json', import.meta.url)));
  assert.ok(project.tags.includes('scope:cockpit-e2e'));
  assert.equal(project.targets.e2e.executor, '@nx/playwright:playwright');
  assert.equal(project.targets.e2e.options.config, 'cockpit/deep-agents/memory/react/e2e/playwright.config.ts');
  assert.ok(existsSync(new URL('../../' + project.targets.e2e.options.config, import.meta.url)));
  assert.ok(project.targets.e2e.dependsOn.some(d => d.target === 'build'));
  assert.ok(project.targets.e2e.dependsOn.some(d => d.target === 'fixture-test'));
});
test('Deep Agents Memory is an exact frozen closed native selection', () => {
  const config = reactCockpitConfiguration('deep-agents-memory');
  assert.deepEqual(config, {
    topic: 'memory',
    library: 'deep-agents',
    adapter: 'langgraph',
    appPath: 'cockpit/deep-agents/memory/react',
    base: '/deep-agents/memory/react/',
    port: 4632,
    project: 'cockpit-deep-agents-memory-react',
  });
  assert.ok(Object.isFrozen(config));
  for (const invalid of [
    'deep-agents/../../foreign',
    'deep-agents-memory/../../foreign',
    '/deep-agents/memory/react/',
  ])
    assert.throws(() => reactCockpitConfiguration(invalid));
});
test('original LangGraph Memory mapping is unchanged', () => {
  assert.deepEqual(reactCockpitConfiguration('memory'), {
    topic: 'memory',
    appPath: 'cockpit/langgraph/memory/react',
    base: '/langgraph/memory/react/',
    port: 4602,
    project: 'cockpit-langgraph-memory-react',
  });
});
