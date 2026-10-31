import type { PostMetrics } from '@threadplane-internal/marketing-channels';
import { insertPostMetrics, listPosts } from '../../repository.ts';
import { requireWeek, type Args, type CommandDeps } from './shared.ts';

export type MetricsFetcher = (postId: string) => Promise<PostMetrics>;

export async function report(
  args: Args,
  deps: CommandDeps,
  fetchMetrics?: MetricsFetcher
): Promise<void> {
  const posts = await listPosts(deps.ex, { weekStart: requireWeek(args) });
  const posted = posts.filter((p) => p.status === 'posted');
  const failed = posts.filter((p) => p.status === 'failed');
  const stuck = posts.filter((p) => p.status === 'posting');

  deps.stdout(`posted (${posted.length})`);
  for (const p of posted) deps.stdout(`  ${p.channel} ${p.id} ${p.result?.url ?? '(no url)'}`);
  deps.stdout(`failed (${failed.length})`);
  for (const p of failed) deps.stdout(`  ${p.channel} ${p.id} ${p.error ?? '(no error)'}`);
  deps.stdout(`outcome unknown, stuck in posting (${stuck.length}); check the channel by hand`);
  for (const p of stuck) deps.stdout(`  ${p.channel} ${p.id} lease expires ${p.leaseExpiresAt ?? 'n/a'}`);

  if (!fetchMetrics) return;
  for (const p of posted) {
    const remoteId = p.channel === 'devto' ? p.result?.postId : undefined;
    if (!remoteId) continue;
    try {
      const metrics = await fetchMetrics(remoteId);
      await insertPostMetrics(deps.ex, p.id, new Date(metrics.fetchedAt), { ...metrics });
      deps.stdout(
        `metrics devto ${p.id}: views ${metrics.impressions ?? 0}, comments ${metrics.replies ?? 0}, reactions ${metrics.shares ?? 0}`
      );
    } catch (error) {
      deps.stdout(`metrics devto ${p.id}: unavailable (${error instanceof Error ? error.message : String(error)})`);
    }
  }
}
