import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertConsumerFiles,
  lockedMiddlewareManifest,
  runMiddlewareConsumer,
} from './verify-middleware-package.mjs';

/** Compile separate packed core/middleware declarations in an isolated consumer. */
export async function verifyMiddlewareConformance(root = process.cwd()) {
  root = realpathSync(resolve(root));
  const temporary = realpathSync(
    mkdtempSync(join(tmpdir(), 'threadplane-middleware-conformance-'))
  );
  try {
    if (temporary.startsWith(root + sep))
      throw new Error('Consumer must be outside workspace');
    for (let ancestor = dirname(temporary); ; ancestor = dirname(ancestor)) {
      if (existsSync(join(ancestor, 'node_modules')))
        throw new Error(`Consumer has ancestor node_modules: ${ancestor}`);
      if (ancestor === dirname(ancestor)) break;
    }
    const middlewareManifest = JSON.parse(
      readFileSync(join(root, 'dist/libs/middleware/package.json'), 'utf8')
    );
    const manifest = lockedMiddlewareManifest(
      middlewareManifest,
      JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
    );
    for (const name of ['core', 'middleware']) {
      const packed = JSON.parse(
        runMiddlewareConsumer(
          'npm',
          [
            'pack',
            join(root, `dist/libs/${name}`),
            '--ignore-scripts',
            '--json',
            '--pack-destination',
            temporary,
          ],
          temporary
        )
      );
      manifest.dependencies[`@threadplane/${name}`] = `file:${join(
        temporary,
        packed[0].filename
      )}`;
    }
    const consumer = join(temporary, 'consumer');
    mkdirSync(consumer);
    cpSync(
      join(root, 'fixtures/react-parity/consumers/middleware-core'),
      consumer,
      { recursive: true }
    );
    writeFileSync(
      join(consumer, 'package.json'),
      JSON.stringify(manifest, null, 2)
    );
    console.log(
      runMiddlewareConsumer(
        'npm',
        ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
        consumer
      )
    );
    for (const name of ['core', 'middleware']) {
      if (
        lstatSync(
          join(consumer, `node_modules/@threadplane/${name}`)
        ).isSymbolicLink()
      )
        throw new Error(`Linked package ${name}`);
    }
    const installedLock = JSON.parse(
      readFileSync(join(consumer, 'package-lock.json'), 'utf8')
    );
    for (const [path, dependency] of Object.entries(installedLock.packages)) {
      if (dependency.link) throw new Error(`Linked dependency ${path}`);
      const name = path.split('node_modules/').at(-1);
      if (
        name.startsWith('@threadplane/') &&
        (!['@threadplane/core', '@threadplane/middleware'].includes(name) ||
          !dependency.resolved?.endsWith('.tgz'))
      )
        throw new Error(`Unexpected private dependency ${path}`);
    }
    const config = JSON.parse(
      readFileSync(join(consumer, 'tsconfig.json'), 'utf8')
    );
    if (
      config.compilerOptions.skipLibCheck !== false ||
      config.compilerOptions.paths ||
      config.extends
    )
      throw new Error(
        'Conformance must check installed declarations without source paths'
      );
    const compiler = join(consumer, 'node_modules/typescript/bin/tsc');
    const files = runMiddlewareConsumer(
      process.execPath,
      [compiler, '-p', 'tsconfig.json', '--listFilesOnly'],
      consumer
    )
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    assertConsumerFiles(consumer, files);
    console.log(
      runMiddlewareConsumer(
        process.execPath,
        [compiler, '-p', 'tsconfig.json'],
        consumer
      )
    );
    console.log(
      'Verified installed core/middleware bidirectional key, acquisition, settlement and store assignments. Standalone core-free middleware verification remains separate.'
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await verifyMiddlewareConformance();
