import { parseArgs } from 'node:util';
import {
  createDatabaseExecutor,
  createInboxRuntime,
  loadInboxConfig,
  recoverInbox,
  retireGoogleMailbox,
  reviewInboxReceipt,
} from '../libs/growth/src/index.ts';
import { validateGrowthDatabaseEnvironment } from './growth-database-preflight.mts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    actor: { type: 'string' },
    evidence: { type: 'string' },
    'receipt-id': { type: 'string' },
  },
});
const command = positionals[0];
if (
  positionals.length !== 1 ||
  !['status', 'recover', 'review-ignore', 'retire-google'].includes(
    command ?? ''
  )
) {
  throw new Error(
    'Usage: growth:receiving status|recover|review-ignore|retire-google [evidence options]'
  );
}
validateGrowthDatabaseEnvironment({
  mode: 'migration',
  environment: process.env,
  nodeVersion: process.versions.node,
});
const config = loadInboxConfig();
if (!config.enabled) throw new Error('Resend receiving is disabled');
const db = createDatabaseExecutor();
try {
  if (command === 'recover') {
    console.log(
      JSON.stringify(await recoverInbox(db, config, createInboxRuntime()))
    );
  } else if (command === 'status') {
    const health = await db.execute(
      `select address, enabled, started_at, healthy_through,
      recovery_id is not null as recovering, google_retired_at from growth_reply_mailboxes where address = $1`,
      [config.address]
    );
    const receipts = await db.execute(
      `select status, last_error_code, count(*)::integer as count,
      count(*) filter (where forward_provider_id is null)::integer as unforwarded
      from growth_reply_receipts where recipient = $1 group by status, last_error_code order by status, last_error_code`,
      [config.address]
    );
    console.log(
      JSON.stringify({ mailboxes: health.rows, receipts: receipts.rows })
    );
  } else {
    const evidence = {
      actor: values.actor ?? '',
      evidence: values.evidence ?? '',
      occurredAt: new Date(),
    };
    if (command === 'review-ignore') {
      await reviewInboxReceipt(db, {
        ...evidence,
        receiptId: values['receipt-id'] ?? '',
      });
    } else {
      await retireGoogleMailbox(db, evidence);
    }
    console.log(JSON.stringify({ applied: true, operation: command }));
  }
} finally {
  await db.close?.();
}
