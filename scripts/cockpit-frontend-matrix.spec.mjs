import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { deriveCockpitCaps, selectCockpitCaps } from './cockpit-matrix.mjs';

test('React cockpit configuration accepts only the nine authored topics', async () => {
  const { reactCockpitConfiguration } = await import(
    './react-cockpit/configuration.mjs'
  );
  assert.equal(reactCockpitConfiguration().topic, 'streaming');
  assert.equal(reactCockpitConfiguration().port, 4600);
  assert.deepEqual(reactCockpitConfiguration('deployment-runtime'), {
    topic: 'deployment-runtime',
    appPath: 'cockpit/langgraph/deployment-runtime/react',
    base: '/langgraph/deployment-runtime/react/',
    port: 4608,
    project: 'cockpit-langgraph-deployment-runtime-react',
  });
  assert.deepEqual(reactCockpitConfiguration('time-travel'), {
    topic: 'time-travel',
    appPath: 'cockpit/langgraph/time-travel/react',
    base: '/langgraph/time-travel/react/',
    port: 4607,
    project: 'cockpit-langgraph-time-travel-react',
  });
  assert.deepEqual(reactCockpitConfiguration('subgraphs'), {
    topic: 'subgraphs',
    appPath: 'cockpit/langgraph/subgraphs/react',
    base: '/langgraph/subgraphs/react/',
    port: 4606,
    project: 'cockpit-langgraph-subgraphs-react',
  });
  assert.deepEqual(reactCockpitConfiguration('durable-execution'), {
    topic: 'durable-execution',
    appPath: 'cockpit/langgraph/durable-execution/react',
    base: '/langgraph/durable-execution/react/',
    port: 4605,
    project: 'cockpit-langgraph-durable-execution-react',
  });
  assert.deepEqual(reactCockpitConfiguration('persistence'), {
    topic: 'persistence',
    appPath: 'cockpit/langgraph/persistence/react',
    base: '/langgraph/persistence/react/',
    port: 4604,
    project: 'cockpit-langgraph-persistence-react',
  });
  assert.deepEqual(reactCockpitConfiguration('interrupts'), {
    topic: 'interrupts',
    appPath: 'cockpit/langgraph/interrupts/react',
    base: '/langgraph/interrupts/react/',
    port: 4601,
    project: 'cockpit-langgraph-interrupts-react',
  });
  assert.deepEqual(reactCockpitConfiguration('memory'), {
    topic: 'memory',
    appPath: 'cockpit/langgraph/memory/react',
    base: '/langgraph/memory/react/',
    port: 4602,
    project: 'cockpit-langgraph-memory-react',
  });
  assert.deepEqual(reactCockpitConfiguration('client-tools'), {
    topic: 'client-tools',
    appPath: 'cockpit/langgraph/client-tools/react',
    base: '/langgraph/client-tools/react/',
    port: 4603,
    project: 'cockpit-langgraph-client-tools-react',
  });
  for (const topic of [
    'unknown',
    '../streaming',
    '/tmp',
    '',
    'streaming/react',
  ])
    assert.throws(
      () => reactCockpitConfiguration(topic),
      /Unsupported React cockpit topic/
    );
});

test('CI discovers all nine React topics with their existing Python backends', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cockpit-react-topics-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const topic of [
    'streaming',
    'interrupts',
    'memory',
    'client-tools',
    'persistence',
    'durable-execution',
    'subgraphs',
    'time-travel',
    'deployment-runtime',
  ]) {
    for (const frontend of ['angular', 'react', 'python']) {
      const directory = join(root, 'cockpit/langgraph', topic, frontend);
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, 'project.json'),
        JSON.stringify({
          name: `cockpit-langgraph-${topic}-${frontend}`,
          targets: frontend === 'python' ? {} : { e2e: {} },
        })
      );
    }
  }
  const caps = deriveCockpitCaps(root);
  assert.equal(caps.length, 18);
  for (const topic of [
    'streaming',
    'interrupts',
    'memory',
    'client-tools',
    'persistence',
    'durable-execution',
    'subgraphs',
    'time-travel',
    'deployment-runtime',
  ]) {
    const selected = selectCockpitCaps(
      caps,
      new Set([`cockpit-langgraph-${topic}-python`]),
      { fullFleet: false }
    );
    assert.equal(selected.length, 2);
    assert.ok(
      selected.every(
        (cap) => cap.python === `cockpit/langgraph/${topic}/python`
      )
    );
    assert.ok(
      selected.some((cap) => cap.angular === `cockpit-langgraph-${topic}-react`)
    );
  }
});

test('CI discovers both streaming frontends and attributes their shared backend', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cockpit-frontends-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const frontend of ['angular', 'react', 'python']) {
    const directory = join(root, 'cockpit/langgraph/streaming', frontend);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'project.json'),
      JSON.stringify({
        name: `cockpit-langgraph-streaming-${frontend}`,
        targets: frontend === 'python' ? {} : { e2e: {} },
      })
    );
  }
  const caps = deriveCockpitCaps(root);
  assert.deepEqual(
    caps.map((cap) => cap.angular),
    ['cockpit-langgraph-streaming-angular', 'cockpit-langgraph-streaming-react']
  );
  assert.ok(
    caps.every((cap) => cap.python === 'cockpit/langgraph/streaming/python')
  );
  assert.deepEqual(
    selectCockpitCaps(caps, new Set(['cockpit-langgraph-streaming-python']), {
      fullFleet: false,
    }),
    caps
  );
  assert.deepEqual(
    selectCockpitCaps(caps, new Set(['cockpit-langgraph-streaming-react']), {
      fullFleet: false,
    }),
    [caps[1]]
  );
});
