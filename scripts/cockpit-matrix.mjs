#!/usr/bin/env node

/**
 * Does this cap own one of the nx-affected projects?
 *
 * A cap is two independent nx projects — the Angular app that owns the `e2e`
 * target and the python backend it talks to — with no edge between them in the
 * project graph. Matching only on the Angular name made a python-only change
 * look unattributed, which main() answers with the full fleet.
 *
 * @param {{angular: string, pythonName?: string}} cap
 * @param {Set<string>} affectedNames
 * @returns {boolean}
 */
export function isCapAffected(cap, affectedNames) {
  if (affectedNames.has(cap.angular)) return true;
  // Guard the falsy case: caps with a Node-hosted backend carry '' here, and
  // `affectedNames` must never be probed with an empty key.
  return Boolean(cap.pythonName) && affectedNames.has(cap.pythonName);
}

/**
 * Pure-function classifier for the cockpit-e2e matrix.
 *
 * @param {Array<{angular: string, python: string, pythonName: string}>} allCockpitCaps
 *        All cockpit angular projects with an e2e target, paired with
 *        their python sibling path and project name. Derived from the
 *        project graph by the CLI wrapper (or hard-coded in tests).
 * @param {Set<string>} affectedNames
 *        Set of project names nx-affected returned for this diff.
 * @param {{fullFleet: boolean}} opts
 *        fullFleet=true forces all caps regardless of affected. Set by
 *        the CLI on push events and on the empty-affected fallback.
 * @returns {Array<{angular: string, python: string}>}
 *        Caps to dispatch as matrix entries, preserving the order of
 *        `allCockpitCaps`.
 */
export function selectCockpitCaps(allCockpitCaps, affectedNames, { fullFleet }) {
  if (fullFleet) return allCockpitCaps;
  return allCockpitCaps.filter((cap) => isCapAffected(cap, affectedNames));
}

// ── CLI wrapper ────────────────────────────────────────────────────────────
// Only runs when invoked as a script (not when imported by tests).
import { execFileSync } from 'node:child_process';
import { appendFileSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

function parseArgs(argv) {
  const out = { base: null, head: null, fullFleet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') out.base = argv[++i];
    else if (a === '--head') out.head = argv[++i];
    else if (a === '--full-fleet') out.fullFleet = argv[++i] === 'true';
  }
  return out;
}

function nxJson(args) {
  const stdout = execFileSync('npx', ['nx', ...args, '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return JSON.parse(stdout);
}

// Walk cockpit/ directly, finding Angular and React frontend projects. Reading
// project.json from disk is ~100x faster than `nx show project <name> --json`
// per project (no nx CLI overhead, no project graph compute).
//
// Each candidate is kept iff its project.json has a targets.e2e key.
// The python sibling path is derived by replacing /angular or /react with /python in
// the directory path (convention: cockpit/<topic>/<cap>/{angular,react,python}).
export function deriveCockpitCaps(
  repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..')
) {
  const cockpitDir = path.join(repoRoot, 'cockpit');
  const caps = [];

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = path.join(dir, name);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (!s.isDirectory()) continue;
      if (name === 'node_modules' || name.startsWith('.')) continue;

      // If this dir is an Angular or React frontend project, check
      // for project.json; otherwise recurse.
      if (['angular', 'react'].includes(path.basename(full))) {
        const projectJsonPath = path.join(full, 'project.json');
        try {
          const meta = JSON.parse(readFileSync(projectJsonPath, 'utf8'));
          if (!meta.targets?.e2e) continue;
          const angularName = meta.name;
          if (typeof angularName !== 'string') continue;
          // Derive python sibling: same parent dir, swap angular -> python.
          // A cap without a python sibling on disk (Node-hosted backend,
          // e.g. rt-mastra) gets python: '' — ci.yml guards the uv/venv
          // steps on that being non-empty.
          const relAngular = path.relative(repoRoot, full); // e.g. cockpit/chat/messages/angular
          const relPython = relAngular.replace(/\/(?:angular|react)$/, '/python');
          const hasPython = (() => {
            try {
              return statSync(path.join(repoRoot, relPython)).isDirectory();
            } catch {
              return false;
            }
          })();
          // Read the python sibling's own project.json for its nx name rather
          // than deriving one from the path — the name is what nx-affected
          // reports, and a convention-derived guess would fail open (no match
          // → full fleet) without ever saying so.
          const pythonName = (() => {
            if (!hasPython) return '';
            try {
              const sibling = JSON.parse(
                readFileSync(
                  path.join(repoRoot, relPython, 'project.json'),
                  'utf8',
                ),
              );
              return typeof sibling.name === 'string' ? sibling.name : '';
            } catch {
              return '';
            }
          })();
          // Preserve the CI matrix field name; it now holds either frontend.
          caps.push({
            angular: angularName,
            python: hasPython ? relPython : '',
            pythonName,
          });
        } catch {
          // No project.json or invalid JSON — skip silently.
        }
        continue;
      }

      walk(full);
    }
  }

  walk(cockpitDir);
  caps.sort((a, b) => a.angular.localeCompare(b.angular));
  return caps;
}

function loadAffectedNames(base, head) {
  return new Set(
    nxJson(['show', 'projects', '--affected', `--base=${base}`, `--head=${head}`]),
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const allCaps = deriveCockpitCaps();

  let affected;
  if (args.fullFleet) {
    affected = new Set();
  } else {
    affected = loadAffectedNames(args.base, args.head);
  }

  // Empty-affected fallback: when scope says e2e is required but nx
  // didn't attribute any cap (lib fanout), run all caps.
  const haveAnyCockpitAffected = allCaps.some((c) => isCapAffected(c, affected));
  const effectiveFullFleet = args.fullFleet || !haveAnyCockpitAffected;

  const selected = selectCockpitCaps(allCaps, affected, {
    fullFleet: effectiveFullFleet,
  });

  // ci.yml reads matrix.cap.angular / matrix.cap.python; pythonName is an
  // internal attribution detail, so keep it out of the emitted matrix.
  const json = JSON.stringify(
    selected.map(({ angular, python }) => ({ angular, python })),
  );

  const ghOutput = process.env.GITHUB_OUTPUT;
  if (ghOutput) {
    appendFileSync(ghOutput, `caps=${json}\n`);
  } else {
    // Local-debug mode: print to stdout.
    process.stdout.write(`caps=${json}\n`);
  }
}

// Only invoke main when run directly, not when imported.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
