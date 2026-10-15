import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deriveCockpitCaps, isCapAffected, selectCockpitCaps } from './cockpit-matrix.mjs';

describe('Theming fixture files through actual Nx attribution', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const project = 'cockpit-chat-theming-react';
  for (const file of [
    'scripts/react-cockpit/chat-theming-fixture.mjs',
    'scripts/react-cockpit/chat-theming-wire.py',
    'scripts/react-cockpit/chat-theming-fixture.spec.mjs',
    'scripts/cockpit-matrix.spec.mjs',
  ]) test(`attributes ${file} without forcing the fleet`, () => {
    const affected = new Set(JSON.parse(execFileSync(process.execPath, [
      'node_modules/nx/bin/nx.js', 'show', 'projects', '--affected', `--files=${file}`, '--json',
    ], { cwd: root, encoding: 'utf8', timeout: 45000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, NX_DAEMON: 'false', NX_ISOLATE_PLUGINS: 'false' } })));
    const caps = deriveCockpitCaps(root);
    const fullFleet = !caps.some(cap => isCapAffected(cap, affected));
    assert.equal(fullFleet, false, 'Other actually affected cockpit owners prevent fleet fallback');
    const selected = selectCockpitCaps(caps, affected, { fullFleet });
    const expected = file.startsWith('scripts/react-cockpit/');
    assert.equal(affected.has(project), expected, `Nx attribution for ${file}`);
    assert.equal(selected.filter(cap => cap.angular === project).length, expected ? 1 : 0, `Native ownership lane for ${file}`);
    assert.ok(selected.length < caps.length, 'The fix must not force the full fleet');
  });
});

test('actual Theming source selects exactly its frontend and Python sibling lanes', () => {
  const caps = deriveCockpitCaps();
  const react = caps.filter(cap => cap.angular === 'cockpit-chat-theming-react');
  assert.deepEqual(react, [{ angular: 'cockpit-chat-theming-react', python: 'cockpit/chat/theming/python', pythonName: 'cockpit-chat-theming-python' }]);
  assert.deepEqual(selectCockpitCaps(caps, new Set(['cockpit-chat-theming-react']), { fullFleet: false }), react);
  assert.deepEqual(selectCockpitCaps(caps, new Set(['cockpit-chat-theming-python']), { fullFleet: false }).map(cap => cap.angular), ['cockpit-chat-theming-angular', 'cockpit-chat-theming-react']);
});

const ALL_CAPS = [
  {
    angular: 'cockpit-chat-messages-angular',
    python: 'cockpit/chat/messages/python',
    pythonName: 'cockpit-chat-messages-python',
  },
  {
    angular: 'cockpit-chat-input-angular',
    python: 'cockpit/chat/input/python',
    pythonName: 'cockpit-chat-input-python',
  },
  {
    angular: 'cockpit-langgraph-streaming-angular',
    python: 'cockpit/langgraph/streaming/python',
    pythonName: 'cockpit-langgraph-streaming-python',
  },
  // Node-hosted backend: no python sibling on disk.
  { angular: 'cockpit-runtimes-mastra-angular', python: '', pythonName: '' },
];

describe('selectCockpitCaps', () => {
  test('returns only affected caps when fullFleet=false', () => {
    const result = selectCockpitCaps(
      ALL_CAPS,
      new Set(['cockpit-chat-messages-angular']),
      { fullFleet: false },
    );
    assert.deepEqual(result, [ALL_CAPS[0]]);
  });

  test('returns multiple affected caps preserving input order', () => {
    const result = selectCockpitCaps(
      ALL_CAPS,
      new Set(['cockpit-langgraph-streaming-angular', 'cockpit-chat-messages-angular']),
      { fullFleet: false },
    );
    assert.deepEqual(result, [ALL_CAPS[0], ALL_CAPS[2]]);
  });

  test('returns all caps when fullFleet=true regardless of affected', () => {
    const result = selectCockpitCaps(ALL_CAPS, new Set(), { fullFleet: true });
    assert.deepEqual(result, ALL_CAPS);
  });

  test('returns all caps when fullFleet=true even with subset affected', () => {
    const result = selectCockpitCaps(
      ALL_CAPS,
      new Set(['cockpit-chat-input-angular']),
      { fullFleet: true },
    );
    assert.deepEqual(result, ALL_CAPS);
  });

  test('returns empty array when fullFleet=false and no affected caps', () => {
    const result = selectCockpitCaps(ALL_CAPS, new Set(), { fullFleet: false });
    assert.deepEqual(result, []);
  });

  test('ignores non-cockpit affected entries (no false matches)', () => {
    const result = selectCockpitCaps(
      ALL_CAPS,
      new Set(['chat', 'langgraph', 'examples-chat-angular']),
      { fullFleet: false },
    );
    assert.deepEqual(result, []);
  });

  test('output round-trips through JSON.stringify/parse', () => {
    const result = selectCockpitCaps(
      ALL_CAPS,
      new Set(['cockpit-chat-input-angular']),
      { fullFleet: false },
    );
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  });
});

describe('selectCockpitCaps — python sibling attribution', () => {
  // A cap's python project is a separate nx project from its Angular app, and
  // the two are not linked in the project graph. Matching only on `cap.angular`
  // meant a python-only cap change produced an empty selection, which
  // cockpit-matrix's main() reads as "nx attributed nothing" and answers with
  // the full fleet — ~40 lanes to cover a one-cap change.
  test('selects the cap when only its python project is affected', () => {
    const result = selectCockpitCaps(
      ALL_CAPS,
      new Set(['cockpit-chat-messages-python']),
      { fullFleet: false },
    );
    assert.deepEqual(result, [ALL_CAPS[0]]);
  });

  test('does not double-select when both siblings are affected', () => {
    const result = selectCockpitCaps(
      ALL_CAPS,
      new Set(['cockpit-chat-messages-python', 'cockpit-chat-messages-angular']),
      { fullFleet: false },
    );
    assert.deepEqual(result, [ALL_CAPS[0]]);
  });

  test('mixes angular- and python-attributed caps', () => {
    const result = selectCockpitCaps(
      ALL_CAPS,
      new Set(['cockpit-langgraph-streaming-python', 'cockpit-chat-input-angular']),
      { fullFleet: false },
    );
    assert.deepEqual(result, [ALL_CAPS[1], ALL_CAPS[2]]);
  });
});

describe('isCapAffected', () => {
  test('matches on the angular project name', () => {
    assert.equal(
      isCapAffected(ALL_CAPS[0], new Set(['cockpit-chat-messages-angular'])),
      true,
    );
  });

  test('matches on the python project name', () => {
    assert.equal(
      isCapAffected(ALL_CAPS[0], new Set(['cockpit-chat-messages-python'])),
      true,
    );
  });

  test('an empty pythonName never matches an empty-string entry', () => {
    // cockpit-runtimes-mastra has no python sibling; a falsy pythonName must
    // not turn `affectedNames.has('')` into a match.
    assert.equal(isCapAffected(ALL_CAPS[3], new Set([''])), false);
  });

  test('unrelated affected names do not match', () => {
    assert.equal(isCapAffected(ALL_CAPS[0], new Set(['chat', 'website'])), false);
  });
});
