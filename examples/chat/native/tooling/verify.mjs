import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildConsumer } from './consumer.mjs';
import {
  captureRetainedBuild,
  readRetainedBuild,
  inventory,
  noLinks,
  file,
} from './retained-build.mjs';
import { preparationEnvironment, selectedFramework } from './commands.mjs';
import { readViewProof } from './view-proof.mjs';
import { assertVerification } from './verification-checks.mjs';

export function parseArguments(args) {
  const flags = args.filter((arg) => arg.startsWith('--framework='));
  assert.ok(flags.length <= 1, 'Duplicate framework selection');
  const framework = flags.length
    ? selectedFramework(flags[0].slice('--framework='.length))
    : undefined;
  args = args.filter((arg) => !arg.startsWith('--framework='));
  assert.ok(
    !(args.includes('--review') && framework),
    'Review infers its framework from verified evidence'
  );
  const selection = framework ? { framework } : {};
  if (!args.length) return { mode: 'verify', ...selection };
  assert.ok(
    args.length === 2 &&
      ['--retain', '--review'].includes(args[0]) &&
      args[1] &&
      !args[1].startsWith('--'),
    'Usage: verify.mjs [--framework=react|angular] [--retain NEW_DIRECTORY] | --review RETAINED_DIRECTORY'
  );
  const requested = resolve(args[1]);
  const directory = join(realpathSync(dirname(requested)), basename(requested));
  noLinks(dirname(directory));
  if (args[0] === '--retain')
    assert.ok(!existsSync(directory), 'Retain target must not exist');
  else noLinks(directory);
  return args[0] === '--review'
    ? { mode: 'review', directory }
    : { mode: 'verify', directory, retain: true, ...selection };
}

export async function captureVerification(directory, context, operations = {}) {
  noLinks(dirname(directory));
  mkdirSync(directory);
  const discard = () => rmSync(directory, { recursive: true, force: true });
  try {
    await (operations.captureApp ?? captureRetainedBuild)(
      join(directory, 'app'),
      context
    );
    const captureView =
      operations.captureView ??
      (await import('./view-proof.mjs')).captureViewProof;
    await captureView(join(directory, 'view-proof'), context);
    return { directory, discard };
  } catch (error) {
    discard();
    throw error;
  }
}

export function sealVerification(directory, results) {
  checkedArtifacts(directory, results);
  writeFileSync(
    join(directory, 'results.json'),
    JSON.stringify(results, null, 2) + '\n'
  );
  writeFileSync(
    join(directory, 'verification.json'),
    JSON.stringify({ version: 2, files: inventory(directory) }, null, 2) + '\n'
  );
}

function checkedArtifacts(directory, results) {
  const app = readRetainedBuild(join(directory, 'app'));
  const view = readViewProof(join(directory, 'view-proof'));
  const framework = assertVerification(
    JSON.parse(file(directory, 'app/retained.json')),
    JSON.parse(file(directory, 'view-proof/view.json')),
    results
  );
  return Object.freeze({ framework, app, view, results });
}

export function readVerification(directory) {
  const record = JSON.parse(file(directory, 'verification.json'));
  assert.equal(record.version, 2);
  const actual = inventory(directory);
  delete actual['verification.json'];
  assert.deepEqual(
    actual,
    record.files,
    'Complete verification inventory must match'
  );
  assert.ok(Object.keys(actual).some((path) => path.startsWith('app/')));
  assert.ok(Object.keys(actual).some((path) => path.startsWith('view-proof/')));
  return checkedArtifacts(
    directory,
    JSON.parse(file(directory, 'results.json'))
  );
}

export async function verify({
  root,
  directory,
  retain = false,
  framework = 'react',
  operations = {},
}) {
  selectedFramework(framework);
  if (directory)
    assert.ok(!existsSync(directory), 'Retain target must not exist');
  const work = realpathSync(
    mkdtempSync(join(tmpdir(), 'native-verification-'))
  );
  directory ??= join(work, 'retained');
  let captured;
  try {
    await (operations.build ?? buildConsumer)({
      root,
      framework,
      assistantId: 'assistant',
      output: join(work, 'production'),
      capture: async (context) => {
        captured = await captureVerification(directory, context, operations);
        return captured;
      },
    });
    const installed =
      operations.installed ??
      (() => {
        const result = spawnSync(
          process.execPath,
          [
            join(root, 'node_modules/nx/bin/nx.js'),
            'test',
            'native-conversation-' + framework,
            '--skip-nx-cache',
            '--outputStyle=stream',
          ],
          { cwd: root, env: preparationEnvironment(), stdio: 'inherit' }
        );
        assert.equal(result.status, 0, 'Installed owner tests must pass');
        return {
          target: 'native-conversation-' + framework + ':test',
          passed: true,
        };
      });
    const installedResult = await installed(framework);
    const browser =
      operations.browser ??
      (await import('./browser-proof.mjs')).runBrowserProofs;
    const results = {
      framework,
      installed: installedResult,
      browser: await browser(directory),
    };
    sealVerification(directory, results);
    readVerification(directory);
    console.log(
      `Verified installed owner tests, production browser cases and ${framework} view lifecycle.`
    );
    if (retain) console.log(`Verified artifact: ${directory}`);
    return { directory, results };
  } catch (error) {
    captured?.discard();
    throw error;
  } finally {
    if (!retain) captured?.discard();
    rmSync(work, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.mode === 'review') {
      const { startReview } = await import('./browser-proof.mjs');
      const review = await startReview(readVerification(options.directory));
      console.log(
        `Review: ${review.url}\n${review.instructions}\nPress Ctrl+C to close this owned review.`
      );
      const stop = async () => {
        const result = await review.close();
        console.log(
          `Review fixture ${
            result.verified ? 'verified' : 'incomplete or rejected'
          }: ${result.received}/${result.expected} requests`
        );
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    } else
      await verify({
        root: fileURLToPath(new URL('../../../../', import.meta.url)),
        ...options,
      });
  } catch (error) {
    console.error(error.stack);
    process.exitCode = 1;
  }
}
