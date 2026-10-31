// Run via: npm run marketing:channels:x:auth -- --target=<preview|production>
// Neon is the only holder of X tokens (X rotates the refresh token on every
// refresh), so this CLI never prints them and refuses to run without --target.

import { runXOAuth } from '@threadplane-internal/marketing-channels';
import { prepareNeonWriter } from '../cli-write.ts';

function fail(msg: string): never {
  process.stderr.write(`✗ ${msg}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const writer = prepareNeonWriter(process.argv.slice(2), process.env);
  if (!writer) {
    fail(
      'Neon is the only holder of X tokens, so they are not printed.\n' +
        'Re-run with --target=preview or --target=production.'
    );
  }
  const tokens = await runXOAuth();
  const saved = await writer.write('x', {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  });
  if (!saved) fail('Aborted; nothing was written.');
  process.stdout.write(
    `\n✓ Stored X tokens (sealed) in the ${writer.target} database.\n` +
      `Set X_USER_HANDLE=${tokens.userHandle} wherever the dispatcher runs.\n\n`
  );
  process.exit(0);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
