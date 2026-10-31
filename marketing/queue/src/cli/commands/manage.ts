import {
  approvePost,
  approveWeek,
  cancelPost,
  confirmFlags,
  findWeek,
  getPost,
  listPosts,
  listRecentRevisions,
  reschedulePost,
  resolvePost,
} from '../../repository.ts';
import type { MarketingPost } from '../../types.ts';
import { requireFlag, requireId, requireWeek, type Args, type CommandDeps } from './shared.ts';

function unconfirmed(post: MarketingPost): string[] {
  const flags = (post.payload['lintFlags'] as { code: string; blocking: boolean }[] | undefined) ?? [];
  return flags.filter((f) => f.blocking && !post.confirmedFlags.includes(f.code)).map((f) => f.code);
}

export async function list(args: Args, deps: CommandDeps): Promise<void> {
  const posts = await listPosts(deps.ex, { weekStart: requireWeek(args) });
  if (posts.length === 0) return deps.stdout('no posts');
  for (const post of posts) {
    const blocking = unconfirmed(post);
    deps.stdout(
      `${post.id} ${post.status.padEnd(9)} ${post.channel.padEnd(8)} ${post.publishAt}` +
        (blocking.length > 0 ? ` NEEDS CONFIRM: ${blocking.join(',')}` : '')
    );
  }
}

export async function confirm(args: Args, deps: CommandDeps): Promise<void> {
  const id = requireId(args);
  const codes = requireFlag(args, 'codes').split(',').map((c) => c.trim()).filter(Boolean);
  const post = await getPost(deps.ex, id);
  if (!post) throw new Error(`Marketing post ${id} not found`);
  const present = ((post.payload['lintFlags'] as { code: string }[] | undefined) ?? []).map((f) => f.code);
  const unknown = codes.filter((c) => !present.includes(c));
  if (unknown.length > 0) throw new Error(`${id} has no flag(s): ${unknown.join(', ')}`);
  await confirmFlags(deps.ex, id, codes);
  deps.stdout(`confirmed ${codes.join(', ')} on ${id}`);
}

export async function cancel(args: Args, deps: CommandDeps): Promise<void> {
  const post = await cancelPost(deps.ex, requireId(args));
  deps.stdout(`cancelled ${post.id}`);
}

/** Records the operator's outcome for a failed or stuck posting row. */
export async function resolve(args: Args, deps: CommandDeps): Promise<void> {
  const id = requireId(args);
  const as = requireFlag(args, 'as');
  if (as !== 'posted' && as !== 'cancelled') throw new Error('--as must be posted or cancelled');
  let url: string | undefined;
  if (as === 'posted') {
    url = requireFlag(args, 'url');
    if (!/^https:\/\/\S+$/u.test(url)) throw new Error('--url must be the live https URL');
  } else if (args.flags['url']) {
    throw new Error('--url only applies with --as=posted');
  }
  const post = await resolvePost(deps.ex, id, { as, url, now: deps.now });
  deps.stdout(`resolved ${post.id} as ${post.status}${url ? ` (${url})` : ''}`);
}

export async function reschedule(args: Args, deps: CommandDeps): Promise<void> {
  const at = new Date(requireFlag(args, 'at'));
  if (Number.isNaN(at.getTime())) throw new Error('--at must be an ISO instant');
  const post = await reschedulePost(deps.ex, requireId(args), at);
  deps.stdout(`rescheduled ${post.id} to ${post.publishAt}`);
}

export async function approve(args: Args, deps: CommandDeps): Promise<void> {
  let result;
  if (args.flags['id']) {
    result = await approvePost(deps.ex, requireFlag(args, 'id'), deps.now);
  } else {
    const weekStart = requireWeek(args);
    const week = await findWeek(deps.ex, weekStart);
    if (!week) throw new Error(`No week ${weekStart}; add posts first`);
    result = await approveWeek(deps.ex, week.id, deps.now);
  }
  deps.stdout(`scheduled: ${result.scheduled.length}`);
  for (const id of result.scheduled) deps.stdout(`  ${id}`);
  deps.stdout(`blocked (confirm the flags, then approve again): ${result.blocked.length}`);
  for (const b of result.blocked) deps.stdout(`  ${b.id} ${b.codes.join(',')}`);
  deps.stdout(`past (left as draft; reschedule or cancel): ${result.past.length}`);
  for (const id of result.past) deps.stdout(`  ${id}`);
}

function textOf(payload: Record<string, unknown>): string {
  if (typeof payload['text'] === 'string') return payload['text'];
  if (Array.isArray(payload['threadParts'])) return (payload['threadParts'] as string[]).join(' | ');
  return '(no text)';
}

export async function revisions(args: Args, deps: CommandDeps): Promise<void> {
  const limit = Number(args.flags['limit'] ?? '10');
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer');
  const rows = await listRecentRevisions(deps.ex, limit);
  if (rows.length === 0) return deps.stdout('no revisions');
  for (const r of rows) {
    deps.stdout(`${r.createdAt} ${r.postId} ${r.channel}`);
    deps.stdout(`  before: ${textOf(r.before)}`);
    deps.stdout(`  after:  ${textOf(r.after)}`);
  }
}
