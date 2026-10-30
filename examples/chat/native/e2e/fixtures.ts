import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test as base } from '@playwright/test';
export type RetainedConsumer = ReturnType<
  typeof import('../tooling/retained-build.mjs').readRetainedBuild
>;
type PreparedConsumer = {
  retained: RetainedConsumer;
  inputs: Record<string, string>;
};
const root = resolve(__dirname, '../../../..');

// Every spec uses this pool, including cases that need their own fresh build.
// Only immutable checked output bytes are shared; servers and browser state
// remain owned by each test. Nothing is reused across worker processes or runs.
export const test = base.extend<
  { retainedConsumer: RetainedConsumer },
  { preparedConsumer: PreparedConsumer }
>({
  preparedConsumer: [
    async ({}, use, workerInfo) => {
      const work = realpathSync(mkdtempSync(join(tmpdir(), 'native-e2e-worker-')));
      const started = performance.now();
      try {
        const { buildConsumer } = await import('../tooling/consumer.mjs');
        const { captureRetainedBuild, readRetainedBuild } =
          await import('../tooling/retained-build.mjs');
        const built = await buildConsumer({
          root,
          framework: 'react',
          assistantId: 'assistant',
          output: join(work, 'production'),
          capture: (context) =>
            captureRetainedBuild(join(work, 'retained'), context),
        });
        const retained = readRetainedBuild(join(work, 'retained'));
        console.log(
          `Native consumer worker ${workerInfo.workerIndex}: prepared and verified in ${Math.round(performance.now() - started)}ms`
        );
        await use({ retained, inputs: built.provenance.inputs });
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    },
    { scope: 'worker', timeout: 300_000 },
  ],
  retainedConsumer: async ({ preparedConsumer }, use) => {
    const { inputFingerprint, buildInputRoots } =
      await import('../tooling/consumer.mjs');
    assert.deepEqual(
      inputFingerprint(root, buildInputRoots(root, 'react')),
      preparedConsumer.inputs,
      'Native consumer inputs changed after worker preparation'
    );
    await use(preparedConsumer.retained);
  },
});
