import { parseArgs } from 'node:util';
import {
  createDatabaseExecutor,
  createInboxRuntime,
  loadInboxConfig,
  recoverInbox,
  readReceivingHealth,
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
    console.log(JSON.stringify(await readReceivingHealth(db, new Date())));
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
