import { test } from '@playwright/test';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

test('one selected production artifact and separate actual view lifecycle entry', async ({}, testInfo) => {
  test.setTimeout(300_000);
  const { buildConsumer } = await import('../tooling/consumer.mjs');
  const { captureVerification } = await import('../tooling/verify.mjs');
  const { runBrowserProofs } = await import('../tooling/browser-proof.mjs');
  const { selectedFramework } = await import('../tooling/commands.mjs');
  const framework = selectedFramework(testInfo.project.metadata.framework);
  const work = realpathSync(
    mkdtempSync(join(tmpdir(), 'native-production-e2e-'))
  );
  const requested = testInfo.outputPath('retained');
  mkdirSync(dirname(requested), { recursive: true });
  const directory = join(realpathSync(dirname(requested)), 'retained');
  try {
    await buildConsumer({
      root: resolve(__dirname, '../../../../'),
      framework,
      assistantId: 'assistant',
      output: join(work, 'production'),
      capture: (context) => captureVerification(directory, context),
    });
    const results = await runBrowserProofs(directory);
    writeFileSync(
      testInfo.outputPath('browser-results.json'),
      JSON.stringify(results, null, 2) + '\n'
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
