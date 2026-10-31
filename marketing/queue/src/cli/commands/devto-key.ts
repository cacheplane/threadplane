import { saveCredentials } from '../../credentials.ts';
import type { CommandDeps } from './shared.ts';

/** The key comes from stdin so it never lands in argv or shell history. */
export async function setDevtoKey(
  deps: CommandDeps,
  credentialKey: Buffer,
  readStdin: () => Promise<string>,
  opts: { target: string; yes: boolean } = { target: 'preview', yes: false }
): Promise<void> {
  // stdin carries the key, so production cannot prompt; it needs an explicit flag.
  if (opts.target === 'production' && !opts.yes) {
    throw new Error('set-devto-key --target=production writes the production key; re-run with --yes to confirm');
  }
  const apiKey = (await readStdin()).trim();
  if (!apiKey) throw new Error('Pipe the dev.to API key on stdin, e.g. pbpaste | npm run marketing:queue -- set-devto-key --target=preview');
  await saveCredentials(deps.ex, credentialKey, 'devto', { apiKey });
  deps.stdout('stored dev.to API key (sealed)');
}
