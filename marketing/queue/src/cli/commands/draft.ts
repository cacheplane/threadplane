import { validateDraft, type Draft } from '@threadplane-internal/marketing-channels';
import { convertMdxForDevto } from '../../devto-convert.ts';
import { lintPublicCopy, type LintFlag } from '../../lint.ts';
import { getPost, insertDraftPost, updateDraftPost, upsertWeek } from '../../repository.ts';
import { defaultSlots } from '../../schedule.ts';
import type { Channel, MediaRef, PostKind } from '../../types.ts';
import { requireFlag, requireId, requireWeek, type Args, type CommandDeps } from './shared.ts';
import matter from 'gray-matter';

const CHANNELS: readonly Channel[] = ['x', 'linkedin', 'devto', 'blog'];
const KINDS: readonly PostKind[] = ['release', 'qa', 'news', 'guide', 'take'];
const DRAFT_FIELDS = ['text', 'threadParts', 'link', 'article'] as const;

function pickDraftFields(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of DRAFT_FIELDS) if (raw[field] !== undefined) out[field] = raw[field];
  return out;
}

function lintText(payload: Record<string, unknown>): string {
  const article = (payload['article'] ?? {}) as { title?: string; description?: string };
  return [
    payload['text'],
    ...((payload['threadParts'] as string[] | undefined) ?? []),
    article.title,
    article.description,
  ]
    .filter((part): part is string => typeof part === 'string')
    .join('\n');
}

function printFlags(deps: CommandDeps, flags: LintFlag[]): void {
  if (flags.length === 0) return deps.stdout('lint: clean');
  for (const f of flags) {
    deps.stdout(`lint: ${f.code} (${f.blocking ? 'blocking' : 'warning'}) "${f.match}"`);
  }
}

async function readJson(deps: CommandDeps, path: string): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse((await deps.readFile(path)).toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function validate(channel: Channel, payload: Record<string, unknown>, media: Draft['media']): void {
  if (channel === 'blog') return;
  validateDraft({ channel, ...payload, ...(media ? { media } : {}) } as Draft);
}

export async function add(args: Args, deps: CommandDeps): Promise<void> {
  const weekStart = requireWeek(args);
  const channel = requireFlag(args, 'channel') as Channel;
  const slotName = requireFlag(args, 'slot');
  const kind = requireFlag(args, 'kind') as PostKind;
  if (!CHANNELS.includes(channel) || channel === 'blog') {
    throw new Error('--channel must be x, linkedin or devto (use add-blog for the blog)');
  }
  if (!KINDS.includes(kind)) throw new Error(`--kind must be one of ${KINDS.join(', ')}`);
  const slot = defaultSlots(weekStart).find((s) => s.channel === channel && s.slot === slotName);
  if (!slot) throw new Error(`No ${channel} slot named "${slotName}" in the default week`);

  const raw = await readJson(deps, requireFlag(args, 'file'));
  const payload = pickDraftFields(raw);
  const mediaPath = args.flags['media'];
  let png: Buffer | undefined;
  let alt = '';
  if (mediaPath) {
    alt = requireFlag(args, 'alt');
    png = await deps.readFile(mediaPath);
  }

  // Refuse before any upload or write.
  validate(channel, payload, png ? [{ png, alt }] : undefined);
  const flags = lintPublicCopy(lintText(payload), channel);

  const media: MediaRef[] = [];
  if (png) {
    media.push({ url: await deps.upload(png, `marketing/${weekStart}/${slotName}.png`), alt });
  }

  const post = await deps.ex.transaction(async (tx) => {
    const week = await upsertWeek(tx, { weekStart });
    return insertDraftPost(tx, {
      weekId: week.id,
      channel,
      kind,
      publishAt: slot.publishAt,
      payload: { ...payload, lintFlags: flags },
      media,
      dependsOn: args.flags['depends-on'] ?? null,
      utmCampaign: args.flags['campaign'] ?? null,
      idempotencyKey: `${channel}:${weekStart}:${slotName}`,
    });
  });
  deps.stdout(`added ${post.id} ${channel} ${slotName} ${post.publishAt}`);
  printFlags(deps, flags);
}

export async function addBlog(args: Args, deps: CommandDeps): Promise<void> {
  const weekStart = requireWeek(args);
  const mdxPath = requireFlag(args, 'mdx');
  const kind = (args.flags['kind'] ?? 'guide') as PostKind;
  if (!KINDS.includes(kind)) throw new Error(`--kind must be one of ${KINDS.join(', ')}`);

  // Same rule as apps/website/src/lib/blog.ts: YYYY-MM-DD-<slug>.mdx.
  const filename = mdxPath.split('/').pop() ?? mdxPath;
  const slug = /^\d{4}-\d{2}-\d{2}-(.+)\.mdx$/u.exec(filename)?.[1];
  if (!slug) throw new Error(`${filename} must be named YYYY-MM-DD-<slug>.mdx`);
  const canonicalUrl = `https://threadplane.ai/blog/${slug}`;

  const blogSlot = defaultSlots(weekStart).find((s) => s.slot === 'blog');
  const devtoSlot = defaultSlots(weekStart).find((s) => s.slot === 'devto');
  if (!blogSlot || !devtoSlot) throw new Error('Default week has no blog or devto slot');

  const mdx = (await deps.readFile(mdxPath)).toString('utf8');
  const rawPublishAt: unknown = matter(mdx).data['publishAt'];
  const publishAt =
    rawPublishAt instanceof Date ? rawPublishAt.toISOString() : rawPublishAt ? String(rawPublishAt) : '';
  if (!publishAt) {
    throw new Error(
      `${filename} frontmatter needs publishAt: ${blogSlot.publishAt.toISOString()} (the site hides the post until then)`
    );
  }
  if (new Date(publishAt).getTime() !== blogSlot.publishAt.getTime()) {
    throw new Error(
      `${filename} publishAt ${publishAt} does not match the blog slot ${blogSlot.publishAt.toISOString()}`
    );
  }

  const converted = convertMdxForDevto(mdx, { siteOrigin: 'https://threadplane.ai', slug });
  const devtoPayload = {
    text: converted.body,
    article: {
      title: converted.title,
      description: converted.description,
      tags: converted.tags,
      canonicalUrl,
    },
  };
  validate('devto', devtoPayload, undefined);
  const flags = lintPublicCopy(`${converted.title}\n${converted.description}\n${converted.body}`, 'blog');

  const { blog, devto } = await deps.ex.transaction(async (tx) => {
    const week = await upsertWeek(tx, { weekStart });
    const blogRow = await insertDraftPost(tx, {
      weekId: week.id,
      channel: 'blog',
      kind,
      publishAt: blogSlot.publishAt,
      payload: { slug, canonicalUrl, lintFlags: flags },
      idempotencyKey: `blog:${weekStart}:blog`,
    });
    const devtoRow = await insertDraftPost(tx, {
      weekId: week.id,
      channel: 'devto',
      kind,
      publishAt: devtoSlot.publishAt,
      payload: { ...devtoPayload, lintFlags: flags },
      dependsOn: blogRow.id,
      idempotencyKey: `devto:${weekStart}:devto`,
    });
    return { blog: blogRow, devto: devtoRow };
  });
  deps.stdout(`added blog ${blog.id} ${blog.publishAt}`);
  deps.stdout(`added devto ${devto.id} ${devto.publishAt} (depends on ${blog.id})`);
  printFlags(deps, flags);
}

export async function edit(args: Args, deps: CommandDeps): Promise<void> {
  const id = requireId(args);
  const post = await getPost(deps.ex, id);
  if (!post) throw new Error(`Marketing post ${id} not found`);
  if (post.channel === 'blog') throw new Error('Blog rows are edited in the MDX file, not here');
  const payload = pickDraftFields(await readJson(deps, requireFlag(args, 'file')));
  // Existing media is already uploaded; validation only needs its alt text.
  const media = post.media.map((m) => ({ png: Buffer.alloc(0), alt: m.alt }));
  validate(post.channel, payload, media.length > 0 ? media : undefined);
  const flags = lintPublicCopy(lintText(payload), post.channel);
  const updated = await updateDraftPost(deps.ex, id, {
    payload: { ...payload, lintFlags: flags },
  });
  deps.stdout(`edited ${updated.id} (${updated.status}); earlier flag confirmations were cleared`);
  printFlags(deps, flags);
}
