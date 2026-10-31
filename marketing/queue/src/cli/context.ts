import { loadCredentialKey } from '../crypto.ts';
import { createSqlExecutor } from '../sql.ts';
import type { SqlExecutor } from '../sql.ts';
import { databaseHost, parseTargetArg, resolveTarget } from '../target.ts';

type Env = Record<string, string | undefined>;

export interface CliContext {
  ex: SqlExecutor;
  target: string;
  host: string;
  databaseUrl: string;
  close(): Promise<void>;
}

/** Resolves --target, prints the database host (host only), and opens the executor. */
export function openContext(
  argv: readonly string[],
  env: Env,
  stdout: (line: string) => void
): CliContext {
  const raw = parseTargetArg(argv);
  if (raw === undefined) throw new Error('--target=preview|production is required');
  const { target, databaseUrl } = resolveTarget(raw, env);
  const host = databaseHost(databaseUrl);
  stdout(`target: ${target} (${host})`);
  const ex = createSqlExecutor(databaseUrl);
  return { ex, target, host, databaseUrl, close: () => ex.close() };
}

export { loadCredentialKey };
