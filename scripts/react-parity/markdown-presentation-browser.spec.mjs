import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('presentation browser proof is import-safe and independent of the orchestrator', async () => {
  const url = new URL('./markdown-presentation-browser.mjs', import.meta.url);
  assert.ok(existsSync(url), 'Native presentation browser proof required');
  assert.doesNotMatch(readFileSync(url, 'utf8'), /from ['"].*verify-markdown/);
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { Server } from 'node:http';
    Server.prototype.listen = () => { throw new Error('Unexpected server'); };
    const proof = await import(${JSON.stringify(url.href)});
    if (typeof proof.verifyPresentationBrowser !== 'function') throw new Error('Browser proof required');
  `,
    ],
    { timeout: 5000 }
  );
});
