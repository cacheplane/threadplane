/**
 * Writes the GitHub Social Preview PNG that a maintainer uploads by hand.
 *
 * GitHub exposes no API for the social preview — not REST, not GraphQL — so
 * this is as far as automation reaches. The PNG is committed so the exact
 * bytes destined for the repository settings are reviewable in a diff, and so
 * regenerating after a brand change produces a visible change rather than a
 * silent one.
 *
 * Usage:
 *   node scripts/export-github-card.mjs
 *   node scripts/export-github-card.mjs --origin http://localhost:3000
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(REPO_ROOT, 'docs', 'brand', 'github-social-preview.png');
const DEFAULT_ORIGIN = 'https://threadplane.ai';

/**
 * GitHub's documented size. Kept in sync BY HAND with GITHUB_CARD_SIZE in
 * apps/website/src/app/github-card/route.tsx — this is a .mjs script and
 * cannot import from the Next app's TypeScript module graph. Change one,
 * change the other.
 */
const EXPECTED = { width: 1280, height: 640 };

function parseOrigin(argv) {
  const at = argv.indexOf('--origin');
  return at === -1 ? DEFAULT_ORIGIN : argv[at + 1];
}

/**
 * Reads width and height out of the PNG's IHDR chunk, which is always the
 * first chunk: 8 bytes of signature, 4 of length, 4 of type, then the two
 * big-endian 32-bit dimensions. Guards against committing a card the route
 * silently resized, and against writing an HTML error page as a .png.
 */
function readPngSize(buffer) {
  const isPng = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isPng) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const origin = parseOrigin(process.argv.slice(2));
const url = new URL('/github-card', origin).toString();

// fetch resolves with a response object for HTTP-level failures (404, 500)
// but rejects outright when the connection itself never happens — no server
// listening, DNS failure, refused TLS. For a person running this by hand
// from a runbook, that is the single most likely failure (the dev server
// was never started, or the route is not deployed yet), so it gets the same
// one-line treatment as a non-ok response instead of a raw stack trace.
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
  console.error(
    `${url} returned ${size.width}x${size.height}, expected ${EXPECTED.width}x${EXPECTED.height}.`,
  );
  process.exit(1);
}

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, buffer);

console.log(`Wrote ${OUTPUT} (${size.width}x${size.height}, ${buffer.length} bytes) from ${url}`);
console.log('');
console.log('GitHub has no API for this. Upload it by hand:');
console.log('  1. https://github.com/cacheplane/threadplane/settings');
console.log('  2. General -> Social preview -> Edit -> Upload an image');
console.log('  3. Select docs/brand/github-social-preview.png');
console.log('');
console.log('Then confirm with:');
console.log('  curl -sL https://github.com/cacheplane/threadplane | grep \'og:image\"\'');
console.log('Expect a repository-images.githubusercontent.com URL, not opengraph.githubassets.com.');
