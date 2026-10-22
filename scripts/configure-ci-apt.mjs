import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const downloadConfig = 'Acquire::Retries "2";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\n';

async function optionalRead(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function rewriteSources(source) {
  return source.split('\n').map((line) => {
    // Comments and mirror metadata survive byte-for-byte. Match entire URI
    // tokens, so lookalike domains and custom repository paths stay untouched.
    const comment = line.indexOf('#');
    const active = comment === -1 ? line : line.slice(0, comment);
    const suffix = comment === -1 ? '' : line.slice(comment);
    return active.replace(/(^|\s)https?:\/\/(azure\.archive|archive|security)\.ubuntu\.com\/ubuntu(\/?)(?=\s|$)/g,
      (_, prefix, host, slash) => `${prefix}https://${host === 'security' ? 'security' : 'archive'}.ubuntu.com/ubuntu${slash}`) + suffix;
  }).join('\n');
}

// The filesystem boundary is injectable for tests; the CLI always uses /etc/apt.
export async function configureCiApt(aptRoot) {
  const paths = ['apt-mirrors.txt', 'apt-mirrors-security.txt', 'sources.list'];
  try {
    const entries = await readdir(join(aptRoot, 'sources.list.d'));
    paths.push(...entries.filter((name) => /\.(list|sources)$/.test(name)).map((name) => join('sources.list.d', name)));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const path of paths) {
    const fullPath = join(aptRoot, path);
    const before = await optionalRead(fullPath);
    if (before === null) continue;
    const after = rewriteSources(before);
    if (after !== before) await writeFile(fullPath, after);
  }
  await mkdir(join(aptRoot, 'apt.conf.d'), { recursive: true });
  await writeFile(join(aptRoot, 'apt.conf.d/99zz-threadplane-ci-downloads'), downloadConfig, { mode: 0o644 });
}

export function validateEffectiveAptConfig(output) {
  for (const [key, expected] of [['CI_RETRIES', '2'], ['CI_HTTP_TIMEOUT', '30'], ['CI_HTTPS_TIMEOUT', '30']]) {
    if (!output.split('\n').includes(`${key}='${expected}'`)) throw new Error('Unexpected effective APT download limits');
  }
}

async function main() {
  if (process.argv.length !== 2) throw new Error('This helper accepts no arguments');
  if (process.platform !== 'linux' || !/^ID=ubuntu$/m.test(await readFile('/etc/os-release', 'utf8'))) {
    throw new Error('CI APT configuration requires Ubuntu Linux');
  }
  await configureCiApt('/etc/apt');
  // Query only these keys: unrelated APT configuration can contain credentials.
  const result = spawnSync('apt-config', ['shell', 'CI_RETRIES', 'Acquire::Retries', 'CI_HTTP_TIMEOUT', 'Acquire::http::Timeout', 'CI_HTTPS_TIMEOUT', 'Acquire::https::Timeout'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error('Could not verify effective APT download limits');
  validateEffectiveAptConfig(result.stdout);
  console.log('APT download limits verified: retries=2, HTTP/HTTPS timeout=30 seconds');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
