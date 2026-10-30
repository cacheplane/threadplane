import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { deployedSurfaceSpecs } from '../e2e-suites';

type Suite = {
  suites?: Suite[];
  specs?: {
    file: string;
    line: number;
    column: number;
    title: string;
    tests: { projectName: string }[];
  }[];
};

function cases(suite: Suite): { key: string; file: string }[] {
  return [
    ...(suite.specs ?? []).flatMap(spec => spec.tests.map(test => ({
      key: JSON.stringify([spec.file, spec.line, spec.column, spec.title, test.projectName]),
      file: spec.file,
    }))),
    ...(suite.suites ?? []).flatMap(cases),
  ];
}

it('keeps every real control-plane case covered by local or deployed selection', () => {
  const root = resolve(import.meta.dirname, '../../..');
  const work = mkdtempSync(join(tmpdir(), 'website-ownership-'));
  const list = (name: string, deployed: boolean, owned: boolean) => {
    const report = join(work, `${name}.json`);
    execFileSync(process.execPath, [
      join(root, 'node_modules/playwright/cli.js'), 'test',
      `--config=apps/website/${deployed ? 'deployed' : 'e2e-control-plane'}.playwright.config.ts`,
      '--list', '--reporter=json',
    ], {
      cwd: root,
      env: {
        ...process.env,
        BASE_URL: deployed ? 'https://preview.invalid' : '',
        WEBSITE_E2E_DEPLOYED_OWNER: owned ? 'true' : '',
        WEBSITE_E2E_MODE: '', PRODUCTION_SMOKE: '', CUSTOM_RUNTIME_BFCACHE: '',
        WEBSITE_E2E_REACT_TOPIC: '', RUNTIME_BYPASS_ORIGIN: '',
        VERCEL_AUTOMATION_BYPASS_SECRET: '',
        VERCEL_EXAMPLES_AUTOMATION_BYPASS_SECRET: '',
        PLAYWRIGHT_JSON_OUTPUT_FILE: report,
      },
      timeout: 20_000,
      stdio: 'pipe',
    });
    const data = JSON.parse(readFileSync(report, 'utf8'));
    expect(data.errors).toEqual([]);
    return cases(data);
  };
  try {
    const full = list('full', false, false);
    const local = list('local', false, true);
    const deployed = list('deployed', true, false);
    const localKeys = new Set(local.map(test => test.key));
    const deployedKeys = new Set(deployed.map(test => test.key));
    const removed = full.filter(test => !localKeys.has(test.key));
    expect(removed.length).toBeGreaterThan(0);
    expect([...new Set(removed.map(test => test.file))].sort()).toEqual([...deployedSurfaceSpecs].sort());
    for (const test of full) {
      expect(localKeys.has(test.key) || deployedKeys.has(test.key), test.key).toBe(true);
      if (deployedSurfaceSpecs.some(file => file === test.file)) {
        expect(localKeys.has(test.key), test.key).toBe(false);
        expect(deployedKeys.has(test.key), test.key).toBe(true);
      } else expect(localKeys.has(test.key), test.key).toBe(true);
    }
    // Listing cannot evaluate test-body skips. Delegated files must not hide
    // local-only cases or environment branches inside an apparently full list.
    for (const file of deployedSurfaceSpecs) {
      const source = readFileSync(join(root, 'apps/website/e2e', file), 'utf8');
      expect(source, file).not.toMatch(/test\.(?:describe\.)?(?:skip|fixme)\s*\(|process\.env|localhost:|127\.0\.0\.1/);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 60_000);
