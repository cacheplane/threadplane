// Standalone smoke runner for channel adapters. NOT exported by the package.
//
// Usage:
//   npm run marketing:channels:x:auth                                    # one-time, fills .env (X only)
//   DRY_RUN=1 npm run marketing:channels:x:smoke
//   npm run marketing:channels:x:smoke
//   SMOKE_MEDIA=1 npm run marketing:channels:x:smoke
//   SMOKE_THREAD=1 npm run marketing:channels:x:smoke
//   DRY_RUN=1 npm run marketing:channels:devto:smoke
//   npm run marketing:channels:devto:smoke
//   npm run marketing:channels:linkedin:auth                             # every 60 days, fills .env
//   DRY_RUN=1 npm run marketing:channels:linkedin:smoke
//   SMOKE_MEDIA=1 npm run marketing:channels:linkedin:smoke
//
// The default channel is 'x'. Override with --channel=devto or --channel=linkedin.

import fs from 'node:fs';
import path from 'node:path';
import { getAdapter, type ChannelId, type Draft } from '../src';

const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=',
  'base64',
);

function parseChannel(): ChannelId {
  const arg = process.argv.find((a) => a.startsWith('--channel='));
  if (!arg) return 'x';
  const value = arg.split('=')[1];
  if (value !== 'x' && value !== 'devto' && value !== 'linkedin') {
    throw new Error(`smoke.ts: --channel=${value} not supported. Use x, devto, or linkedin.`);
  }
  return value;
}

function buildXDraft(): Draft {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  if (process.env.SMOKE_THREAD === '1') {
    return {
      channel: 'x',
      threadParts: [
        `Marketing pipeline smoke test — please ignore. (${stamp}) [1/2]`,
        'This is the second tweet of the smoke thread. [2/2]',
      ],
    };
  }
  if (process.env.SMOKE_MEDIA === '1') {
    return {
      channel: 'x',
      text: `Marketing pipeline smoke test with media — please ignore. (${stamp})`,
      media: [{ png: PIXEL_PNG, alt: 'A 1x1 transparent pixel — test image.' }],
    };
  }
  return {
    channel: 'x',
    text: `Marketing pipeline smoke test — please ignore. (${stamp})`,
  };
}

function buildDevToDraft(): Draft {
  const stamp = new Date().toISOString();
  return {
    channel: 'devto',
    text: [
      '# Marketing Pipeline Smoke Test',
      '',
      'This is an automated smoke test of the @threadplane-internal/marketing-channels Dev.to adapter.',
      '',
      `Posted at ${stamp}. Please ignore — this article will be deleted.`,
      '',
      '## Why this exists',
      '',
      'The Threadplane marketing pipeline syndicates blog content to Dev.to. This run verifies the live wire works end-to-end.',
    ].join('\n'),
    article: {
      title: `Marketing Pipeline Smoke Test — ${stamp}`,
      tags: ['test'],
      canonicalUrl: 'https://threadplane.ai',
      description: 'Automated smoke test of the Threadplane marketing pipeline Dev.to adapter.',
    },
  };
}

// LinkedIn has no unlisted posts: a live smoke is visible to your network until
// you delete it.
function buildLinkedInDraft(): Draft {
  const stamp = new Date().toISOString();
  const draft: Draft = {
    channel: 'linkedin',
    text: `Marketing pipeline smoke test (please ignore). Escaping check: (parens) [brackets] #hashtag. ${stamp}`,
  };
  if (process.env.LINKEDIN_PARTNER_COMMENTS === '1') {
    draft.firstComment = 'Smoke test first comment: https://threadplane.ai';
  }
  if (process.env.SMOKE_MEDIA === '1') {
    draft.media = [{ png: PIXEL_PNG, alt: 'A 1x1 transparent pixel — test image.' }];
  }
  return draft;
}

function buildDraft(channel: ChannelId): Draft {
  if (channel === 'devto') return buildDevToDraft();
  if (channel === 'linkedin') return buildLinkedInDraft();
  return buildXDraft();
}

async function main(): Promise<void> {
  const channel = parseChannel();
  const adapter = getAdapter(channel);
  const draft = buildDraft(channel);
  const result = await adapter.post(draft);
  console.log(JSON.stringify(result, null, 2));

  if (result.url.startsWith('https://dry-run.local')) {
    const outFile = path.join(
      process.cwd(),
      'marketing',
      'cowork',
      'outbox',
      'dry-runs',
      `${result.postId}.json`,
    );
    if (fs.existsSync(outFile)) console.log(`Dry-run file written: ${outFile}`);
  } else if (channel === 'devto' && process.env.SMOKE_METRICS !== '0') {
    // Brief wait so Dev.to has time to index the article before fetching metrics.
    console.log('Sleeping 5s before fetching metrics…');
    await new Promise((r) => setTimeout(r, 5000));
    const metrics = await adapter.metrics(result.postId);
    console.log('Metrics:', JSON.stringify(metrics, null, 2));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
