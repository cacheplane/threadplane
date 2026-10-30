import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Draft, PostResult } from './types.ts';

function serializeDraft(draft: Draft): unknown {
  if (!draft.media || draft.media.length === 0) return draft;
  return {
    ...draft,
    media: draft.media.map((m) => ({
      png: m.png.toString('base64'),
      alt: m.alt,
    })),
  };
}

export async function writeDryRunResult(draft: Draft): Promise<PostResult> {
  const id = `dry-${crypto.randomUUID()}`;
  const outDir = path.resolve(
    process.cwd(),
    process.env.MARKETING_DRY_RUN_DIR || path.join('tmp', 'marketing', 'dry-runs'),
  );
  await fs.mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `${id}.json`);
  await fs.writeFile(
    file,
    JSON.stringify(
      { draft: serializeDraft(draft), simulatedAt: new Date().toISOString() },
      null,
      2,
    ),
  );
  return {
    channel: draft.channel,
    postId: id,
    url: `https://dry-run.local/${draft.channel}/${id}`,
    postedAt: new Date().toISOString(),
  };
}
