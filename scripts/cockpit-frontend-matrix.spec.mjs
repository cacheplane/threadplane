import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { deriveCockpitCaps, selectCockpitCaps } from './cockpit-matrix.mjs';

test('React cockpit configuration accepts only the two authored topics', async () => {
  const { reactCockpitConfiguration } = await import(
    './react-cockpit/configuration.mjs'
  );
  assert.equal(reactCockpitConfiguration().topic, 'streaming');
  assert.equal(reactCockpitConfiguration().port, 4600);
  assert.deepEqual(reactCockpitConfiguration('interrupts'), {
    topic: 'interrupts',
    appPath: 'cockpit/langgraph/interrupts/react',
    base: '/langgraph/interrupts/react/',
    port: 4601,
    project: 'cockpit-langgraph-interrupts-react',
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

test('CI discovers both React topics with their existing Python backends', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cockpit-react-topics-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const topic of ['streaming', 'interrupts']) {
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
  assert.equal(caps.length, 4);
  for (const topic of ['streaming', 'interrupts']) {
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
