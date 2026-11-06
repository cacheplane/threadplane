import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveWebsiteDir } from './website-dir';

const SUPPORTED_ANGULAR_COPY = 'Supported Angular majors: 20, 21, and 22.';
const SUPPORTED_ANGULAR_PEER_RANGE = '^20.0.0 || ^21.0.0 || ^22.0.0';

function walkFiles(dir: string, extensions: ReadonlySet<string>): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath, extensions));
    } else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function publicCopyFiles(): string[] {
  const websiteDir = resolveWebsiteDir();
  const workspaceDir = path.resolve(websiteDir, '..', '..');
  const libraryReadmes = fs
    .readdirSync(path.join(workspaceDir, 'libs'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(workspaceDir, 'libs', entry.name, 'README.md'))
    .filter((file) => fs.existsSync(file));

  return [
    path.join(workspaceDir, 'README.md'),
    ...libraryReadmes,
    ...walkFiles(path.join(websiteDir, 'content'), new Set(['.md', '.mdx'])),
    ...walkFiles(path.join(websiteDir, 'src', 'app'), new Set(['.ts', '.tsx'])),
  ];
}

describe('Angular support copy', () => {
  it('does not publish stale or open-ended Angular and Node support claims', () => {
    const staleClaims = [
      /Angular 20\+/g,
      /Angular 20 or later/g,
      /Angular 20 and 21(?!,? and 22)/g,
      /Node\.js 18\+/g,
      /Node\.js 22\+/g,
      /Node\.js 22 or later/g,
    ];
    const workspaceDir = path.resolve(resolveWebsiteDir(), '..', '..');
    const offenders: string[] = [];

    for (const file of publicCopyFiles()) {
      const source = fs.readFileSync(file, 'utf8');
      for (const staleClaim of staleClaims) {
        if (staleClaim.test(source)) {
          offenders.push(`${path.relative(workspaceDir, file)}: ${staleClaim.source}`);
        }
        staleClaim.lastIndex = 0;
      }
    }

    expect(offenders).toEqual([]);
  });

  it('teaches adapter authors the complete supported Angular peer range', () => {
    const guide = fs.readFileSync(
      path.join(resolveWebsiteDir(), 'content', 'docs', 'angular', 'chat', 'guides', 'writing-an-adapter.mdx'),
      'utf8'
    );

    expect(guide).toContain(`"@angular/core": "${SUPPORTED_ANGULAR_PEER_RANGE}"`);
  });

  it('keeps generated agent guidance on the current release and support range', () => {
    const websiteDir = resolveWebsiteDir();
    const workspaceDir = path.resolve(websiteDir, '..', '..');
    const packageVersion = JSON.parse(
      fs.readFileSync(path.join(workspaceDir, 'libs', 'langgraph', 'package.json'), 'utf8')
    ) as { version: string };

    for (const file of ['AGENTS.md.template', 'CLAUDE.md.template']) {
      const source = fs.readFileSync(path.join(websiteDir, 'content', file), 'utf8');
      expect(source).toContain(SUPPORTED_ANGULAR_COPY);
    }

    for (const file of ['AGENTS.md', 'CLAUDE.md']) {
      const source = fs.readFileSync(path.join(websiteDir, 'public', file), 'utf8');
      expect(source).toContain(`# Threadplane v${packageVersion.version}`);
      expect(source).toContain(SUPPORTED_ANGULAR_COPY);
    }
  });
});
