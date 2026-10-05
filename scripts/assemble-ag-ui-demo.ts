#!/usr/bin/env npx tsx
// scripts/assemble-ag-ui-demo.ts
/**
 * Build the examples/ag-ui Angular app and assemble it into the Vercel
 * deploy directory at deploy/ag-ui-demo/.
 *
 * Output structure:
 *   deploy/ag-ui-demo/                     (Angular SPA static files)
 *   deploy/ag-ui-demo/.vercel/output/
 *     ├── config.json                     (route table: /agent* → function, else SPA fallback)
 *     ├── static/                         (mirrors the SPA files)
 *     └── functions/api/[[...path]].func/
 *         ├── index.js                    (bundled scripts/ag-ui-demo-middleware.ts)
 *         └── .vc-config.json
 *
 * Usage:
 *   npx tsx scripts/assemble-ag-ui-demo.ts
 *   npx tsx scripts/assemble-ag-ui-demo.ts --skip-build
 */
import { execSync } from 'child_process';
import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { demoRoutes } from './demo-routes';

const root = resolve(__dirname, '..');
const deployDir = resolve(root, 'deploy/ag-ui-demo');
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
  console.log('Building examples-ag-ui-angular (production)...');
  execSync('npx nx build examples-ag-ui-angular --configuration=production --skip-nx-cache', {
    cwd: root,
    stdio: 'inherit',
  });
}

if (existsSync(deployDir)) rmSync(deployDir, { recursive: true });

const src = resolve(root, 'dist/examples/ag-ui/angular');
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
execSync(`npx esbuild scripts/ag-ui-demo-middleware.ts --bundle --format=cjs --platform=node --outfile=${funcDir}/index.js`, {
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
  routes: demoRoutes('^/agent(/.*)?$'),
}, null, 2));

console.log('✅ .vercel/output/ (Build Output API with serverless proxy)');
console.log(`\nAssembled AG-UI demo to ${deployDir}`);
