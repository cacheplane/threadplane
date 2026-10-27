import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORTS } from '../cockpit/ports.mjs';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const cockpitDir = join(repoRoot, 'cockpit');

function findCockpitAngularProjects() {
  const out = [];
  function walk(dir) {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      const full = join(dir, name);
      if (name === 'node_modules' || name.startsWith('.')) continue;
      let stat;
      try { stat = readFileSync(join(full, 'project.json'), 'utf8'); }
      catch { walk(full); continue; }
      try {
        const meta = JSON.parse(stat);
        if (typeof meta.name === 'string' && meta.name.endsWith('-angular') && meta.name.startsWith('cockpit-')) {
          out.push({ name: meta.name, dir: full, meta });
        }
      } catch {}
      walk(full);
    }
  }
  walk(cockpitDir);
  return out;
}

const projects = findCockpitAngularProjects();

test('Debug preserves canonical ports and its separate native React port', async () => {
  const { reactCockpitConfiguration } = await import('./react-cockpit/configuration.mjs');
  assert.deepEqual(PORTS['cockpit-chat-debug-angular'], { angular: 4509, langgraph: 5509 });
  const config = reactCockpitConfiguration('chat-debug');
  assert.equal(config.port, 4645);
  assert.equal(config.base, '/chat/debug/react/');
  assert.equal(config.project, 'cockpit-chat-debug-react');
  const python = JSON.parse(readFileSync(join(repoRoot, 'cockpit/chat/debug/python/project.json'), 'utf8'));
  assert.match(python.targets.serve.options.command, /--port 5509/);
});

describe('cockpit/ports.mjs registry', () => {
  test('covers every cockpit-*-angular project on disk', () => {
    const onDisk = projects.map((p) => p.name);
    const missing = onDisk.filter((n) => !(n in PORTS));
    assert.deepEqual(missing, [], `missing from PORTS: ${missing.join(', ')}`);
  });

  test('has no orphan entries (each PORTS key has a project on disk)', () => {
    const diskNames = new Set(projects.map((p) => p.name));
    const orphans = Object.keys(PORTS).filter((n) => !diskNames.has(n));
    assert.deepEqual(orphans, [], `orphan PORTS entries: ${orphans.join(', ')}`);
  });

  test('every entry has angular + langgraph as positive integers', () => {
    for (const [name, p] of Object.entries(PORTS)) {
      assert.equal(typeof p.angular, 'number', `${name}.angular not number`);
      assert.equal(typeof p.langgraph, 'number', `${name}.langgraph not number`);
      assert.ok(p.angular > 0 && p.langgraph > 0, `${name} has non-positive port`);
    }
  });

  test('port ranges: angular ∈ [4000, 5000), langgraph ∈ [5000, 6000), langgraph = angular + 1000', () => {
    for (const [name, p] of Object.entries(PORTS)) {
      assert.ok(p.angular >= 4000 && p.angular < 5000, `${name}.angular out of range: ${p.angular}`);
      assert.ok(p.langgraph >= 5000 && p.langgraph < 6000, `${name}.langgraph out of range: ${p.langgraph}`);
      assert.equal(p.langgraph, p.angular + 1000, `${name}: langgraph (${p.langgraph}) != angular (${p.angular}) + 1000`);
    }
  });

  test('no duplicate ports', () => {
    const seen = new Set();
    for (const [name, p] of Object.entries(PORTS)) {
      for (const port of [p.angular, p.langgraph]) {
        assert.ok(!seen.has(port), `duplicate port ${port} (${name})`);
        seen.add(port);
      }
    }
  });

  test('each cap python/project.json --port matches PORTS[name].langgraph', () => {
    const mismatches = [];
    for (const { name, dir } of projects) {
      const pyDir = join(dir, '..', 'python');
      if (!existsSync(pyDir)) {
        // No python sibling at all: the cap's backend is not Python (e.g.
        // rt-mastra, whose backend is the deployments/ag-ui-mastra Node
        // service). Nothing to cross-check here — but a python/ dir WITHOUT
        // a project.json is still an error below.
        continue;
      }
      const pyProjectJson = join(pyDir, 'project.json');
      if (!existsSync(pyProjectJson)) {
        mismatches.push(`${name}: missing python/project.json at ${pyProjectJson}`);
        continue;
      }
      const meta = JSON.parse(readFileSync(pyProjectJson, 'utf8'));
      const cmd = String(meta?.targets?.serve?.options?.command ?? '');
      const m = cmd.match(/--port[= ](\d+)/);
      // Skip caps without an explicit --port (e.g. langgraph/deep-agents/render
      // caps that don't expose nx serve port; e2e harness spawns langgraph
      // with explicit --port from global-setup-impl.ts instead).
      if (!m) continue;
      const literal = Number(m[1]);
      const expected = PORTS[name]?.langgraph;
      if (literal !== expected) {
        mismatches.push(`${name}: python --port ${literal} != registry ${expected}`);
      }
    }
    assert.deepEqual(mismatches, []);
  });

  test('each active-e2e cap playwright.config.ts baseURL port matches PORTS[name].angular', () => {
    const mismatches = [];
    for (const { name, dir } of projects) {
      const pwConfig = join(dir, 'e2e', 'playwright.config.ts');
      if (!existsSync(pwConfig)) continue;
      const text = readFileSync(pwConfig, 'utf8');
      const m = text.match(/baseURL:\s*[`'"]http:\/\/localhost:(\d+)[`'"/]/);
      if (!m) continue;
      const literal = Number(m[1]);
      const expected = PORTS[name]?.angular;
      if (literal !== expected) {
        mismatches.push(`${name}: playwright baseURL :${literal} != registry :${expected}`);
      }
    }
    assert.deepEqual(mismatches, []);
  });

  test('render cockpit examples have target-backed e2e suites', () => {
    const missing = [];
    for (const { name, dir, meta } of projects.filter((p) => p.name.startsWith('cockpit-render-'))) {
      const e2eDir = join(dir, 'e2e');
      const config = join(e2eDir, 'playwright.config.ts');
      const setup = join(e2eDir, 'global-setup-impl.ts');
      const spec = join(e2eDir, `${name.replace(/^cockpit-render-/, 'r-').replace(/-angular$/, '')}.spec.ts`);

      if (!meta.targets?.e2e) missing.push(`${name}: missing e2e target`);
      if (!existsSync(config)) missing.push(`${name}: missing e2e/playwright.config.ts`);
      if (!existsSync(setup)) missing.push(`${name}: missing e2e/global-setup-impl.ts`);
      if (!existsSync(spec)) missing.push(`${name}: missing ${spec}`);
    }

    assert.deepEqual(missing, []);
  });
});
