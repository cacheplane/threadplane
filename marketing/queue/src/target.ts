import { createInterface } from 'node:readline/promises';

type Env = Record<string, string | undefined>;

export type MarketingTarget = 'preview' | 'production';

const TARGET_ENV: Record<MarketingTarget, string> = {
  preview: 'MARKETING_DATABASE_URL_PREVIEW',
  production: 'MARKETING_DATABASE_URL_PRODUCTION',
};

export function resolveTarget(
  value: string,
  env: Env
): { target: MarketingTarget; envVar: string; databaseUrl: string } {
  if (value !== 'preview' && value !== 'production') {
    throw new Error(`--target must be preview or production, got "${value}"`);
  }
  const envVar = TARGET_ENV[value];
  const databaseUrl = env[envVar];
  if (!databaseUrl) throw new Error(`${envVar} must be set for --target=${value}`);
  return { target: value, envVar, databaseUrl };
}

/** Hostname only; never credentials, path, or the raw string. */
export function databaseHost(databaseUrl: string): string {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    return '(unparseable URL)';
  }
}

export function parseTargetArg(argv: readonly string[]): string | undefined {
  return argv.find((a) => a.startsWith('--target='))?.slice('--target='.length);
}

export async function confirmWrite(host: string, target: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      `Write credentials to ${target} database at ${host}? [y/N] `
    );
    return /^y(es)?$/iu.test(answer.trim());
  } finally {
    rl.close();
  }
}
