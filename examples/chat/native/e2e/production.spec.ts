import { test } from '@playwright/test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('one retained production artifact and separate actual React lifecycle entry', async () => {
  test.setTimeout(300_000);
  const { buildConsumer } = await import('../tooling/consumer.mjs');
  const { captureVerification } = await import('../tooling/verify.mjs');
  const { runBrowserProofs } = await import('../tooling/browser-proof.mjs');
  const work = realpathSync(
    mkdtempSync(join(tmpdir(), 'native-production-e2e-'))
  );
  const directory = join(work, 'proof');
  try {
    await buildConsumer({
      root: resolve(__dirname, '../../../../'),
      assistantId: 'assistant',
      output: join(work, 'production'),
      capture: (context) => captureVerification(directory, context),
    });
    await runBrowserProofs(directory);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
