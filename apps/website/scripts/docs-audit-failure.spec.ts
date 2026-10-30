// @vitest-environment node
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';

test('termination preserves completed checks, active target, and sanitized trace checkpoints', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'threadplane-docs-checkpoint-'));
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      '--eval',
      `
    const { writeDocsAuditEvidence } = require('./apps/website/scripts/docs-audit-evidence.ts');
    (async () => {
      await writeDocsAuditEvidence(process.env.CHECKPOINT_DIRECTORY, {
        passed: false,
        results: [{ route: '/docs/completed', width: 1440, passed: true }],
        activeTarget: { route: '/docs/in-progress', width: 320 },
      }, [{ event: 'navigate', value: '/docs/in-progress' }], 'owned server ready');
      process.stdout.write('checkpoint-ready');
      setInterval(() => {}, 1000);
    })().catch((error) => { console.error(error); process.exit(1); });
  `,
    ],
    {
      cwd: resolve(import.meta.dirname, '../../..'),
      env: { ...process.env, CHECKPOINT_DIRECTORY: directory },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Checkpoint startup timed out')),
        10000
      );
      child.stdout.on('data', (data) => {
        if (String(data).includes('checkpoint-ready')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.once('exit', () => {
        clearTimeout(timeout);
        reject(new Error('Checkpoint process exited before ready'));
      });
    });
    const stopped = new Promise<void>((resolve) =>
      child.once('exit', () => resolve())
    );
    child.kill('SIGTERM');
    await stopped;
    const report = JSON.parse(
      readFileSync(join(directory, 'report.json'), 'utf8')
    );
    expect(report.passed).toBe(false);
    expect(report.results).toEqual([
      { route: '/docs/completed', width: 1440, passed: true },
    ]);
    expect(report.activeTarget).toEqual({
      route: '/docs/in-progress',
      width: 320,
    });
    expect(
      JSON.parse(readFileSync(join(directory, 'trace.json'), 'utf8'))
    ).toEqual([{ event: 'navigate', value: '/docs/in-progress' }]);
    expect(readFileSync(join(directory, 'server.log'), 'utf8')).toBe(
      'owned server ready'
    );
  } finally {
    child.kill('SIGKILL');
    rmSync(directory, { recursive: true, force: true });
  }
}, 20000);

test('invalid startup produces a failed, sanitized report before browser launch', () => {
  const directory = mkdtempSync(join(tmpdir(), 'threadplane-docs-audit-'));
  try {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'apps/website/scripts/run-docs-audit.ts'],
      {
        cwd: resolve(import.meta.dirname, '../../..'),
        env: {
          ...process.env,
          DOCS_AUDIT_ORIGIN:
            'https://name:private@invalid.test/path?key=private',
          DOCS_AUDIT_OUTPUT: directory,
        },
        encoding: 'utf8',
        timeout: 15000,
      }
    );
    expect(result.status, result.stderr).toBe(1);
    const source = readFileSync(join(directory, 'report.json'), 'utf8');
    const report = JSON.parse(source);
    expect(report.passed).toBe(false);
    expect(report.fatalError).toMatch(/origin/);
    expect(source).not.toContain('private');
    expect(
      JSON.parse(readFileSync(join(directory, 'trace.json'), 'utf8'))
    ).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 20000);

test('deployment wrapper preserves a failed report when configuration is invalid', () => {
  const directory = mkdtempSync(join(tmpdir(), 'threadplane-docs-deployment-'));
  try {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'apps/website/scripts/verify-docs-deployment.ts'],
      {
        cwd: resolve(import.meta.dirname, '../../..'),
        env: {
          ...process.env,
          DOCS_DEPLOYMENT_URL: 'file:///private',
          DOCS_DEPLOYMENT_OUTPUT: directory,
        },
        encoding: 'utf8',
        timeout: 15000,
      }
    );
    expect(result.status, result.stderr).toBe(1);
    const report = JSON.parse(
      readFileSync(join(directory, 'verification.json'), 'utf8')
    );
    expect(report.passed).toBe(false);
    expect(report.observations).toEqual([]);
    expect(report.fatalError).toMatch(/origin/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 20000);
