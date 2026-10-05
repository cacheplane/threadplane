/**
 * Writes each deployed demo's social card PNG into that demo's public/.
 *
 * The demos are static Angular apps on their own Vercel projects, so their
 * og:image cannot be a route on threadplane.ai that renders at request time
 * — it has to be a file the demo itself serves. The PNGs are committed so the
 * bytes a share preview will show are reviewable in a diff, and so a brand
 * change produces a visible diff rather than a silent one.
 *
 * Usage:
 *   node scripts/export-demo-cards.mjs
 *   node scripts/export-demo-cards.mjs --origin http://localhost:3000
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ORIGIN = 'https://threadplane.ai';

/**
 * Kept in sync BY HAND with SOCIAL_CARD_SIZE in
 * apps/website/src/lib/demo-meta.ts — this is a .mjs script and cannot import
 * from the Next app's TypeScript module graph. Change one, change the other.
 */
const EXPECTED = { width: 1200, height: 630 };

const CARDS = [
  { route: '/demo-card/langgraph', output: join('examples', 'chat', 'angular', 'public', 'social-card.png') },
  { route: '/demo-card/ag-ui', output: join('examples', 'ag-ui', 'angular', 'public', 'social-card.png') },
];

function parseOrigin(argv) {
  const at = argv.indexOf('--origin');
  if (at === -1) return DEFAULT_ORIGIN;
  const value = argv[at + 1];
  if (value === undefined || value.startsWith('--')) {
    console.error('--origin needs a value, e.g. --origin http://localhost:3000');
    process.exit(1);
  }
  return value;
}

/** PNG IHDR is always the first chunk: 8-byte signature, 4 length, 4 type, then two BE32 dimensions. */
function readPngSize(buffer) {
  const isPng = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isPng) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function exportCard(origin, { route, output }) {
  const url = new URL(route, origin).toString();
  let response;
  try {
    response = await fetch(url);
  } catch (cause) {
    console.error(`Could not reach ${url}: ${cause.message}`);
    process.exit(1);
  }
  if (!response.ok) {
    console.error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    process.exit(1);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const size = readPngSize(buffer);
  if (!size) {
    console.error(`${url} did not return a PNG. Got content-type: ${response.headers.get('content-type')}`);
    process.exit(1);
  }
  if (size.width !== EXPECTED.width || size.height !== EXPECTED.height) {
    console.error(`${url} returned ${size.width}x${size.height}, expected ${EXPECTED.width}x${EXPECTED.height}.`);
    process.exit(1);
  }
  const target = join(REPO_ROOT, output);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, buffer);
  console.log(`Wrote ${output} (${size.width}x${size.height}, ${buffer.length} bytes) from ${url}`);
}

const origin = parseOrigin(process.argv.slice(2));
for (const card of CARDS) {
  await exportCard(origin, card);
}
console.log('');
console.log('Look at both PNGs before committing: a missing bundled font still renders a valid PNG in the fallback face.');
