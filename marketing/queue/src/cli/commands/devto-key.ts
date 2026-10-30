import { saveCredentials } from '../../credentials.ts';
import type { CommandDeps } from './shared.ts';

/** The key comes from stdin so it never lands in argv or shell history. */
export async function setDevtoKey(
  deps: CommandDeps,
  credentialKey: Buffer,
  readStdin: () => Promise<string>
): Promise<void> {
  const apiKey = (await readStdin()).trim();
  if (!apiKey) throw new Error('Pipe the dev.to API key on stdin, e.g. pbpaste | npm run marketing:queue -- set-devto-key --target=preview');
  await saveCredentials(deps.ex, credentialKey, 'devto', { apiKey });
  deps.stdout('stored dev.to API key (sealed)');
}
