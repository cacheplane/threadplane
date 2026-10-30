// Run via: npm run marketing:channels:linkedin:auth [-- --target=<preview|production>]
// LinkedIn access tokens last 60 days and self-serve apps get no refresh token,
// so re-run this when the adapter reports the token has expired.

import { runLinkedInOAuth } from '@threadplane-internal/marketing-channels/oauth';
import { prepareNeonWriter } from '../cli-write.ts';

function fail(msg: string): never {
  process.stderr.write(`✗ ${msg}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const writer = prepareNeonWriter(process.argv.slice(2), process.env);
  const auth = await runLinkedInOAuth();
  const expiresAt = auth.expiresAt.toISOString();

  if (writer) {
    const saved = await writer.write(
      'linkedin',
      { accessToken: auth.accessToken, authorUrn: auth.authorUrn },
      auth.expiresAt
    );
    if (!saved) fail('Aborted; nothing was written.');
    process.stdout.write(
      `\n✓ Stored LinkedIn token (sealed) in the ${writer.target} database. Expires ${expiresAt}.\n\n`
    );
    process.exit(0);
  }

  process.stdout.write(
    `\n✓ Authorized${auth.name ? ` as ${auth.name}` : ''}. Add these to .env:\n\n` +
      `LINKEDIN_ACCESS_TOKEN=${auth.accessToken}\n` +
      `LINKEDIN_AUTHOR_URN=${auth.authorUrn}\n` +
      `LINKEDIN_TOKEN_EXPIRES_AT=${expiresAt}\n\n`
  );
  process.exit(0);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
