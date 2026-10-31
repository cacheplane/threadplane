/** Verify source identity around one browser pass, preserving evidence on every failure. */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  redactDiagnostic,
  requireDocsOrigin,
  verifyDocsDeployment,
  type DocsIdentity,
} from './docs-deployment';

async function main() {
  const root = resolve(__dirname, '../../..');
  const output = resolve(
    root,
    process.env['DOCS_DEPLOYMENT_OUTPUT'] ?? 'dist/docs-audit/deployment'
  );
  const revision = process.env['DOCS_DEPLOYMENT_REVISION'] ?? '';
  const secret = process.env['VERCEL_AUTOMATION_BYPASS_SECRET'] ?? '';
  const clean = (value: unknown) =>
    redactDiagnostic(value instanceof Error ? value.message : String(value), [
      secret,
    ]);
  const observations: { phase: 'before' | 'after'; identity: DocsIdentity }[] =
    [];
  const startedAt = new Date().toISOString();
  let passed = false;
  let fatalError: string | undefined;
  let browserLog = '';
  let immutableOrigin: string | undefined;
  let auditOrigin: string | undefined;
  await mkdir(output, { recursive: true });
  await writeFile(
    join(output, 'verification.json'),
    JSON.stringify(
      { passed: false, startedAt, status: 'started', observations: [] },
      null,
      2
    )
  );
  try {
    immutableOrigin = requireDocsOrigin(
      process.env['DOCS_DEPLOYMENT_URL'] ?? ''
    );
    const phase = process.env['DOCS_DEPLOYMENT_PHASE'];
    if (phase !== 'immutable' && phase !== 'production')
      throw new Error('DOCS_DEPLOYMENT_PHASE must be immutable or production');
    auditOrigin =
      phase === 'immutable'
        ? immutableOrigin
        : requireDocsOrigin(
            process.env['DOCS_PRODUCTION_ORIGIN'] ?? 'https://threadplane.ai'
          );
    await verifyDocsDeployment({
      origins: [immutableOrigin, auditOrigin],
      auditOrigin,
      revision,
      bypassOrigin: immutableOrigin,
      bypassSecret: secret,
      onIdentity: (phase, identity) => observations.push({ phase, identity }),
      audit: (origin) =>
        new Promise<void>((done, fail) => {
          const child = spawn(
            process.execPath,
            [
              '--import',
              'tsx',
              join(root, 'apps/website/scripts/run-docs-audit.ts'),
            ],
            {
              cwd: root,
              env: {
                ...process.env,
                DOCS_AUDIT_ORIGIN: origin,
                DOCS_AUDIT_BYPASS_ORIGIN: immutableOrigin,
                DOCS_AUDIT_OUTPUT: join(output, 'browser'),
              },
              stdio: ['ignore', 'pipe', 'pipe'],
            }
          );
          for (const stream of [child.stdout, child.stderr])
            stream?.on('data', (data) => {
              const text = clean(String(data));
              browserLog = (browserLog + text).slice(-50000);
              process.stdout.write(text);
            });
          const timer = setTimeout(() => {
            child.kill('SIGTERM');
            fail(new Error('Documentation browser audit timed out'));
          }, 6 * 60 * 1000);
          child.once('error', (error) => {
            clearTimeout(timer);
            fail(error);
          });
          child.once('exit', (code, signal) => {
            clearTimeout(timer);
            if (code === 0) done();
            else
              fail(
                new Error(
                  `Documentation browser audit failed (${
                    signal ?? code
                  }); inspect browser/report.json`
                )
              );
          });
        }),
    });
    passed = true;
  } catch (error) {
    fatalError = clean(error);
    console.error(fatalError);
    process.exitCode = 1;
  } finally {
    await writeFile(join(output, 'browser.log'), browserLog);
    await writeFile(
      join(output, 'verification.json'),
      JSON.stringify(
        {
          passed,
          revision,
          immutableOrigin,
          auditOrigin,
          startedAt,
          finishedAt: new Date().toISOString(),
          observations,
          fatalError,
        },
        null,
        2
      )
    );
  }
}

void main().catch((error) => {
  console.error(
    redactDiagnostic(String(error), [
      process.env['VERCEL_AUTOMATION_BYPASS_SECRET'] ?? '',
    ])
  );
  process.exitCode = 1;
});
