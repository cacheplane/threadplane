// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { nextConfig } from './next.config';

const temporary: string[] = [];
afterEach(() =>
  temporary
    .splice(0)
    .forEach((root) => fs.rmSync(root, { recursive: true, force: true }))
);

function fixture(localOutput = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'website-traces-'));
  temporary.push(root);
  const projectDir = path.join(root, 'apps/website');
  const distDir = localOutput
    ? path.join(projectDir, '.next')
    : path.join(root, 'dist/apps/website/.next');
  const trace = path.join(
    distDir,
    'server/app/api/docs-search/route.js.nft.json'
  );
  const relative = (file: string) => path.relative(path.dirname(trace), file);
  const canonical = path.join(projectDir, 'content/api/chat/Component.json');
  const cache = path.join(
    root,
    '.nx/cache/old/apps/website/content/api/chat/Component.json'
  );
  const packaged = path.join(
    root,
    'dist/apps/website/content/api/chat/Component.json'
  );
  const compiled = path.join(distDir, 'server/app/api/docs-search/route.js');
  for (const file of [canonical, cache, packaged, compiled]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      file === canonical ? 'current content' : 'old or compiled content'
    );
  }
  const run = async () => {
    const hook = nextConfig.compiler?.runAfterProductionCompile;
    expect(hook).toBeTypeOf('function');
    await hook?.({ projectDir, distDir });
  };
  return {
    root,
    projectDir,
    distDir,
    trace,
    relative,
    canonical,
    cache,
    packaged,
    compiled,
    run,
  };
}

it('finalizes emitted traces using canonical content while preserving compiled routes and runnable content', async () => {
  const f = fixture();
  const files = [f.canonical, f.cache, f.packaged, f.compiled].map(f.relative);
  fs.writeFileSync(
    f.trace,
    JSON.stringify({ version: 1, files, metadata: 'preserved' })
  );
  await f.run();
  expect(JSON.parse(fs.readFileSync(f.trace, 'utf8'))).toEqual({
    version: 1,
    files: [f.canonical, f.compiled].map(f.relative),
    metadata: 'preserved',
  });
  expect(fs.readFileSync(f.canonical, 'utf8')).toBe('current content');
  expect(fs.existsSync(f.cache)).toBe(true);
  expect(fs.existsSync(f.packaged)).toBe(true);
});

it('rejects a trace with no canonical replacement before changing it', async () => {
  const f = fixture();
  const original = JSON.stringify({
    version: 1,
    files: [f.cache, f.compiled].map(f.relative),
  });
  fs.writeFileSync(f.trace, original);
  await expect(f.run()).rejects.toThrow('canonical content');
  expect(fs.readFileSync(f.trace, 'utf8')).toBe(original);
});

it('preserves cache artifacts outside the website content tree', async () => {
  const f = fixture();
  const other = path.join(f.root, '.nx/cache/other/library.js');
  const original = JSON.stringify({
    version: 1,
    files: [other, f.compiled].map(f.relative),
  });
  fs.writeFileSync(f.trace, original);
  await f.run();
  expect(fs.readFileSync(f.trace, 'utf8')).toBe(original);
});

it('preserves canonical content when a direct Next build uses the app-local output directory', async () => {
  const f = fixture(true);
  const original = JSON.stringify({
    version: 1,
    files: [f.canonical, f.compiled].map(f.relative),
  });
  fs.writeFileSync(f.trace, original);
  await f.run();
  expect(fs.readFileSync(f.trace, 'utf8')).toBe(original);
});
