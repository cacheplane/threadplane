import { readFileSync, readdirSync } from 'node:fs';
import { join, posix } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');

interface NgPackageAsset { input: string; glob: string; output: string }

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(join(root, path), 'utf8')) as T;
}

/** Package-relative paths the build copies into the published package. */
function packagedAssets(): Set<string> {
  const { assets } = readJson<{ assets: NgPackageAsset[] }>('ng-package.json');
  const out = new Set<string>();
  for (const asset of assets) {
    const pattern = new RegExp(`^${asset.glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`);
    for (const file of readdirSync(join(root, asset.input))) {
      if (pattern.test(file)) out.add(posix.join(asset.output, file));
    }
  }
  return out;
}

describe('published stylesheet exports', () => {
  it('ships a file behind every stylesheet the package exports', () => {
    const { exports } = readJson<{ exports: Record<string, unknown> }>('package.json');
    const stylesheets = Object.entries(exports)
      .filter(([subpath]) => subpath.endsWith('.css'))
      .map(([, target]) => posix.normalize(String(target)));
    expect(stylesheets).toContain('chat.css');
    const assets = packagedAssets();
    expect(stylesheets.filter(path => !assets.has(path))).toEqual([]);
  });
});
