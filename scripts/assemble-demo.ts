#!/usr/bin/env npx tsx
// scripts/assemble-demo.ts
/**
 * Build the canonical-demo Angular app and assemble it into the Vercel
 * deploy directory at deploy/demo/.
 *
 * Output structure:
 *   deploy/demo/                          (Angular SPA static files)
 *   deploy/demo/.vercel/output/
 *     ├── config.json                     (route table: /api/* → function, else SPA fallback)
 *     ├── static/                         (mirrors the SPA files)
 *     └── functions/api/[[...path]].func/
 *         ├── index.js                    (bundled scripts/demo-middleware.ts)
 *         └── .vc-config.json
 *
 * Usage:
 *   npx tsx scripts/assemble-demo.ts
 *   npx tsx scripts/assemble-demo.ts --skip-build
 */
import { execSync } from 'child_process';
import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { demoRoutes } from './demo-routes';

const root = resolve(__dirname, '..');
const deployDir = resolve(root, 'deploy/demo');
const skipBuild = process.argv.includes('--skip-build');

function resolveBuildSha(): string {
  return process.env['GITHUB_SHA'] ?? execSync('git rev-parse HEAD', {
    cwd: root,
    encoding: 'utf8',
  }).trim();
}

const buildMetadata = {
  sha: resolveBuildSha(),
  runId: process.env['GITHUB_RUN_ID'] ?? null,
  runAttempt: process.env['GITHUB_RUN_ATTEMPT'] ?? null,
  builtAt: new Date().toISOString(),
};

function writeBuildMetadata(outDir: string): void {
  writeFileSync(resolve(outDir, '__build.json'), JSON.stringify(buildMetadata, null, 2) + '\n');
}

if (!skipBuild) {
  console.log('Building examples-chat-angular (production)...');
  execSync('npx nx build examples-chat-angular --configuration=production --skip-nx-cache', {
    cwd: root,
    stdio: 'inherit',
  });
}

if (existsSync(deployDir)) rmSync(deployDir, { recursive: true });

const src = resolve(root, 'dist/examples/chat/angular');
if (!existsSync(src)) {
  console.error(`❌ Missing build output: ${src}`);
  process.exit(1);
}

mkdirSync(deployDir, { recursive: true });
cpSync(src, deployDir, { recursive: true });
writeBuildMetadata(deployDir);
console.log(`✅ Copied SPA to ${deployDir}`);

const outputDir = resolve(deployDir, '.vercel/output');
const staticDir = resolve(outputDir, 'static');
const funcDir = resolve(outputDir, 'functions/api/[[...path]].func');

mkdirSync(staticDir, { recursive: true });
// Copy from the original dist (not deployDir) — Node's cpSync rejects
// copying a directory to a subdirectory of itself, filter or no filter.
cpSync(src, staticDir, { recursive: true });
writeBuildMetadata(staticDir);

mkdirSync(funcDir, { recursive: true });
execSync(`npx esbuild scripts/demo-middleware.ts --bundle --format=cjs --platform=node --outfile=${funcDir}/index.js`, {
  cwd: root,
  stdio: 'inherit',
});

writeFileSync(resolve(funcDir, '.vc-config.json'), JSON.stringify({
  runtime: 'nodejs22.x',
  handler: 'index.js',
  launcherType: 'Nodejs',
  shouldAddHelpers: true,
}, null, 2));

writeFileSync(resolve(outputDir, 'config.json'), JSON.stringify({
  version: 3,
  routes: demoRoutes('^/api/(.*)'),
}, null, 2));

console.log('✅ .vercel/output/ (Build Output API with serverless proxy)');
console.log(`\nAssembled canonical demo to ${deployDir}`);
