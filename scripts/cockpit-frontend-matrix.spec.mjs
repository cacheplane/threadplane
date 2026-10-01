import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { deriveCockpitCaps, selectCockpitCaps } from './cockpit-matrix.mjs';

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
