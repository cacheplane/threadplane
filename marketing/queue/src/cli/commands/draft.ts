import { validateDraft, type Draft } from '@threadplane-internal/marketing-channels';
import { convertMdxForDevto } from '../../devto-convert.ts';
import { lintPublicCopy, type LintFlag } from '../../lint.ts';
import {
  getPost,
  insertDraftPost,
  listBlogRowsBySlug,
  listSlotRows,
  updateDraftPost,
  upsertWeek,
} from '../../repository.ts';
import { defaultSlots, pacificWeekContaining } from '../../schedule.ts';
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

const BLOG_LINK_RE = /threadplane\.ai\/blog\/([^/?#\s)"'<>]+)/gu;

/** Slugs of threadplane.ai blog posts linked from the draft's text, thread, or link. */
function linkedBlogSlugs(payload: Record<string, unknown>): string[] {
  const link = payload['link'] as { url?: unknown } | undefined;
  const haystack = [
    payload['text'],
    ...((payload['threadParts'] as unknown[] | undefined) ?? []),
    link?.url,
  ]
    .filter((part): part is string => typeof part === 'string')
    .join('\n');
  // Sentence punctuation right after a bare URL is not part of the slug.
  return [
    ...new Set([...haystack.matchAll(BLOG_LINK_RE)].map((m) => m[1].replace(/[.,;:!]+$/u, ''))),
  ];
}

/**
 * A post linking a queued blog that has not gone live must depend on that
 * blog row, or it can publish a link that 404s. Links to blogs the queue does
 * not know (older posts) or has already posted pass.
 */
async function assertBlogDependency(
  deps: CommandDeps,
  payload: Record<string, unknown>,
  dependsOn: string | undefined
): Promise<void> {
  for (const slug of linkedBlogSlugs(payload)) {
    const rows = (await listBlogRowsBySlug(deps.ex, slug)).filter(
      (row) => row.status !== 'cancelled'
    );
    if (rows.length === 0 || rows.some((row) => row.status === 'posted')) continue;
    const ids = rows.map((row) => row.id);
    if (!dependsOn) {
      throw new Error(
        `This draft links /blog/${slug}, which is not live yet; add --depends-on=${ids[0]}`
      );
    }
    if (!ids.includes(dependsOn)) {
      throw new Error(
        `This draft links /blog/${slug}; --depends-on must be its blog row ${ids[0]}, not ${dependsOn}`
      );
    }
  }
}

function validate(channel: Channel, payload: Record<string, unknown>, media: Draft['media']): void {
  if (channel === 'blog') return;
  validateDraft({ channel, ...payload, ...(media ? { media } : {}) } as Draft);
}

export async function add(args: Args, deps: CommandDeps): Promise<void> {
  const channel = requireFlag(args, 'channel') as Channel;
  const at = args.flags['at'];
  if (at && args.flags['slot']) throw new Error('--at and --slot are mutually exclusive');
  if (!at && !args.flags['slot']) throw new Error('--slot or --at is required');
  const kind = requireFlag(args, 'kind') as PostKind;
  if (!CHANNELS.includes(channel) || channel === 'blog') {
    throw new Error('--channel must be x, linkedin or devto (use add-blog for the blog)');
  }
  if (!KINDS.includes(kind)) throw new Error(`--kind must be one of ${KINDS.join(', ')}`);
  let weekStart: string;
  let slotName: string;
  let publishAt: Date;
  let idempotencyKey: string;
  if (at) {
    publishAt = new Date(at);
    if (Number.isNaN(publishAt.getTime())) throw new Error('--at must be an ISO instant');
    weekStart = args.flags['week'] ? requireWeek(args) : pacificWeekContaining(publishAt);
    slotName = 'adhoc';
    idempotencyKey = `${channel}:${weekStart}:adhoc:${publishAt.toISOString()}`;
  } else {
    weekStart = requireWeek(args);
    slotName = requireFlag(args, 'slot');
    const slot = defaultSlots(weekStart).find((s) => s.channel === channel && s.slot === slotName);
    if (!slot) throw new Error(`No ${channel} slot named "${slotName}" in the default week`);
    publishAt = slot.publishAt;
    const baseKey = `${channel}:${weekStart}:${slotName}`;
    const existing = await listSlotRows(deps.ex, baseKey);
    if (existing.some((row) => row.status !== 'cancelled')) {
      throw new Error(`Slot ${slotName} already has a live row (${existing.find((row) => row.status !== 'cancelled')?.id}); cancel it first to refill`);
    }
    idempotencyKey = existing.length === 0 ? baseKey : `${baseKey}:r${existing.length}`;
    if (existing.length > 0) slotName = `${slotName}-r${existing.length}`;
  }

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
  await assertBlogDependency(deps, payload, args.flags['depends-on']);
  const flags = lintPublicCopy(lintText(payload), channel);

  const media: MediaRef[] = [];
  if (png) {
    media.push({ url: await deps.upload(png, `marketing/${weekStart}/${slotName}${at ? `-${publishAt.getTime()}` : ''}.png`), alt });
  }

  const post = await deps.ex.transaction(async (tx) => {
    const week = await upsertWeek(tx, { weekStart });
    return insertDraftPost(tx, {
      weekId: week.id,
      channel,
      kind,
      publishAt,
      payload: { ...payload, lintFlags: flags },
      media,
      dependsOn: args.flags['depends-on'] ?? null,
      utmCampaign: args.flags['campaign'] ?? null,
      idempotencyKey,
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
      utmCampaign: slug,
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

export async function relintBlog(args: Args, deps: CommandDeps): Promise<void> {
  const id = requireId(args);
  const post = await getPost(deps.ex, id);
  if (!post) throw new Error(`Marketing post ${id} not found`);
  if (post.channel !== 'blog') throw new Error(`${id} is a ${post.channel} row; relint-blog only handles blog rows`);
  const mdx = (await deps.readFile(requireFlag(args, 'mdx'))).toString('utf8');
  const { data, content } = matter(mdx);
  const raw: unknown = data['publishAt'];
  const publishAt = raw instanceof Date ? raw.toISOString() : raw ? String(raw) : '';
  if (!publishAt || new Date(publishAt).getTime() !== new Date(post.publishAt).getTime()) {
    throw new Error(`MDX publishAt ${publishAt || '(missing)'} does not match the row publish_at ${post.publishAt}`);
  }
  const flags = lintPublicCopy(`${String(data['title'] ?? '')}\n${String(data['description'] ?? '')}\n${content}`, 'blog');
  const updated = await updateDraftPost(deps.ex, id, { payload: { ...post.payload, lintFlags: flags } });
  deps.stdout(`relinted ${updated.id} (${updated.status}); earlier flag confirmations were cleared`);
  printFlags(deps, flags);
}

/** No database: lints a draft.json (social, dev.to) or an .mdx (blog) and prints the flags. */
export async function lintFile(
  args: Args,
  io: { readFile: (path: string) => Promise<Buffer>; stdout: (line: string) => void }
): Promise<void> {
  const channel = requireFlag(args, 'channel') as Channel;
  if (!CHANNELS.includes(channel)) throw new Error(`--channel must be one of ${CHANNELS.join(', ')}`);
  const path = requireFlag(args, 'file');
  const raw = (await io.readFile(path)).toString('utf8');
  let text: string;
  if (channel === 'blog') {
    const { data, content } = matter(raw);
    text = `${String(data['title'] ?? '')}\n${String(data['description'] ?? '')}\n${content}`;
  } else {
    text = lintText(pickDraftFields(JSON.parse(raw) as Record<string, unknown>));
  }
  printFlags({ stdout: io.stdout } as CommandDeps, lintPublicCopy(text, channel));
}
