// @vitest-environment node
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { packageWebsiteContent } from './package-website-content.mjs';

const directories: string[] = [];
afterEach(() =>
  directories
    .splice(0)
    .forEach((directory) => rmSync(directory, { recursive: true, force: true }))
);

it('packages runtime API and docs data into the runnable build and prunes retired artifacts', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'website-content-'));
  directories.push(root);
  const source = path.join(root, 'source');
  const output = path.join(root, 'output');
  mkdirSync(path.join(source, 'api'), { recursive: true });
  mkdirSync(path.join(source, 'docs'), { recursive: true });
  mkdirSync(output);
  writeFileSync(path.join(output, 'retired.json'), '{}');
  writeFileSync(path.join(source, 'api', 'index.json'), '{"schemaVersion":1}');
  writeFileSync(path.join(source, 'docs', 'guide.mdx'), '# A guide');
  packageWebsiteContent(source, output);
  expect(
    readFileSync(path.join(output, 'api', 'index.json'), 'utf8')
  ).toContain('schemaVersion');
  expect(readFileSync(path.join(output, 'docs', 'guide.mdx'), 'utf8')).toBe(
    '# A guide'
  );
  expect(existsSync(path.join(output, 'retired.json'))).toBe(false);
  expect(readFileSync(path.join(source, 'docs', 'guide.mdx'), 'utf8')).toBe(
    '# A guide'
  );
});

it('leaves prior packaged content intact when generation has not produced an index', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'website-content-'));
  directories.push(root);
  const source = path.join(root, 'source');
  const output = path.join(root, 'output');
  mkdirSync(source);
  mkdirSync(output);
  writeFileSync(path.join(output, 'keep.json'), '{}');
  expect(() => packageWebsiteContent(source, output)).toThrow(/index/);
  expect(existsSync(path.join(output, 'keep.json'))).toBe(true);
});
