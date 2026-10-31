import { loadCredentialKey } from './crypto.ts';
import { saveCredentials } from './credentials.ts';
import { createSqlExecutor } from './sql.ts';
import {
  confirmWrite,
  databaseHost,
  parseTargetArg,
  resolveTarget,
} from './target.ts';

export interface NeonWriter {
  target: string;
  host: string;
  /** Prompts y/N on stdin, then writes. Returns false when declined. */
  write(
    channel: 'x' | 'linkedin' | 'devto',
    value: object,
    expiresAt?: Date
  ): Promise<boolean>;
}

/**
 * Validates --target, the target database URL, and the sealing key up front
 * so an auth CLI fails before the OAuth round trip. Returns null without
 * --target (the CLI then keeps printing tokens to the terminal).
 */
export function prepareNeonWriter(
  argv: readonly string[],
  env: Record<string, string | undefined>
): NeonWriter | null {
  const raw = parseTargetArg(argv);
  if (raw === undefined) return null;
  const { target, databaseUrl } = resolveTarget(raw, env);
  const key = loadCredentialKey(env);
  const host = databaseHost(databaseUrl);
  return {
    target,
    host,
    async write(channel, value, expiresAt) {
      if (!(await confirmWrite(host, target))) return false;
      const ex = createSqlExecutor(databaseUrl);
      try {
        await saveCredentials(ex, key, channel, value, expiresAt);
      } finally {
        await ex.close();
      }
      return true;
    },
  };
}
