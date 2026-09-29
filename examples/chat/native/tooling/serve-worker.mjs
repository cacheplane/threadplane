import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareConsumer } from './consumer.mjs';
import { frozenInputFingerprint } from './source-mirror.mjs';
import { isDeepStrictEqual } from 'node:util';

export async function prepareDevelopment({ root, temporary, ...options }) {
  const initialFrozen = JSON.parse(
    readFileSync(join(temporary, 'frozen.json'), 'utf8')
  );
  const unchanged = () =>
    assert.ok(
      isDeepStrictEqual(
        initialFrozen,
        frozenInputFingerprint(root, options.framework)
      ),
      'Frozen development inputs changed; restart the native example to rebuild and reinstall'
    );
  unchanged();
  return prepareConsumer({ root, temporary, ...options, unchanged });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    assert.equal(process.argv[2], '--prepare');
    assert.equal(process.argv.length, 6);
    assert.equal(
      process.env.NATIVE_LANGGRAPH_API_KEY,
      '',
      'Use the sanitized serve launcher'
    );
    const root = resolve(process.argv[3]);
    const temporary = resolve(process.argv[4]);
    const { initialFiles } = await prepareDevelopment({
      root,
      temporary,
      ...JSON.parse(process.argv[5]),
    });
    writeFileSync(
      join(temporary, 'prepared.json'),
      JSON.stringify({ initialFiles })
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
