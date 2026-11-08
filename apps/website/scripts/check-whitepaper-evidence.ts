import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewEvidence } from './whitepapers/evidence';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const read = (file: string) => readFileSync(resolve(root, file), 'utf8');
const manifest: unknown = JSON.parse(
  read('apps/website/scripts/whitepapers/evidence.json')
);
const today = new Date().toISOString().slice(0, 10);
const issues = reviewEvidence(manifest, read, today);
const revision =
  manifest && typeof manifest === 'object' && 'baselineRevision' in manifest
    ? String(manifest.baselineRevision)
    : '(missing)';
console.log(
  `Whitepaper evidence review (${today}); recorded revision ${revision}`
);
console.log(
  'Offline drift check only. External sources have not been fetched or re-verified.'
);
for (const issue of issues) console.log(`- ${issue}`);
if (issues.length) process.exitCode = 1;
else
  console.log(
    'No recorded content/package drift or overdue reviews. Follow README.md for external-source review.'
  );
