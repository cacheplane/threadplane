import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const downloadConfig = 'Acquire::Retries "2";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\n';

// The runner image's package sources are left exactly as GitHub ships them: the
// Azure mirror first, then the public archive. Pinning either host makes it a
// single point of failure, and each unreachable fetch costs a full timeout.
// Only the download limits below are managed, so a stalled mirror gives way to
// the next one instead of holding the job.
// The filesystem boundary is injectable for tests; the CLI always uses /etc/apt.
export async function configureCiApt(aptRoot) {
  await mkdir(join(aptRoot, 'apt.conf.d'), { recursive: true });
  // Hosted Ubuntu runners already have zz-retries; NN-prefixed files load first.
  await writeFile(join(aptRoot, 'apt.conf.d/zz-threadplane-ci-downloads'), downloadConfig, { mode: 0o644 });
}

export function validateEffectiveAptConfig(output) {
  const values = ['CI_RETRIES', 'CI_HTTP_TIMEOUT', 'CI_HTTPS_TIMEOUT'].map((key) => {
    const line = output.split('\n').find((entry) => entry.startsWith(`${key}=`));
    if (line === undefined) return 'missing';
    const match = line.match(/^[A-Z_]+='([0-9]{1,10})'$/);
    return match ? match[1] : 'nonnumeric';
  });
  if (values.join('/') !== '2/30/30') {
    throw new Error(`Unexpected effective APT download limits: retries=${values[0]}, http=${values[1]}, https=${values[2]}`);
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
