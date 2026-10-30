import type {
  AdapterOptions,
  ChannelAdapter,
  createAdapter,
  Draft,
  DraftMedia,
} from '@threadplane-internal/marketing-channels';
import { reauthHint } from './credentials.ts';
import {
  getPost,
  leaseDuePosts,
  listExpiredPostingLeases,
  markDeployRequested,
  markFailed,
  markPosted,
  releaseToScheduled,
} from './repository.ts';
import type { SqlExecutor } from './sql.ts';
import type { MarketingPost, PostResult } from './types.ts';

export interface MarketingDispatchDependencies {
  now: () => Date;
  createAdapter: typeof createAdapter;
  /** Bound to the root executor (never a transaction) so X token rotation commits on its own. */
  loadAdapterOptions: () => Promise<AdapterOptions>;
  fetchMedia: (url: string) => Promise<Buffer>;
  /** GET, follow redirects, 200 → true. */
  checkLive: (url: string) => Promise<boolean>;
  /** URL of an existing dev.to article with this canonical URL, or null. */
  devtoHasCanonical: (canonicalUrl: string) => Promise<string | null>;
  /** POST MARKETING_WEBSITE_DEPLOY_HOOK_URL. */
  triggerDeploy: () => Promise<void>;
  alert: (key: string, subject: string, body: string) => Promise<void>;
}

export interface MarketingDispatchResult {
  posted: number;
  waiting: number;
  failed: number;
  alerts: string[];
}

/** Long enough to cover a whole tick; an expired `posting` lease is only ever alerted on. */
export const MARKETING_LEASE_MS = 15 * 60_000;
const NOT_LIVE_ALERT_MS = 3 * 60 * 60_000;
const LINKEDIN_EXPIRY_WARNING_MS = 7 * 24 * 60 * 60_000;

type AdapterChannel = 'x' | 'linkedin' | 'devto';
type Outcome = 'posted' | 'waiting' | 'failed';

/**
 * Raised before any adapter `post()` call: nothing was sent, so the row is
 * released back to `scheduled` and the alert explains why it is waiting.
 */
class HoldError extends Error {
  constructor(
    readonly alertKey: string,
    readonly subject: string,
    message: string
  ) {
    super(message);
    this.name = 'HoldError';
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function collectSecrets(options: AdapterOptions): string[] {
  return [
    options.x?.credentials.accessToken,
    options.x?.credentials.refreshToken,
    options.x?.credentials.clientSecret,
    options.linkedin?.credentials.accessToken,
    options.devto?.credentials.apiKey,
  ].filter((value): value is string => !!value && value.length >= 8);
}

function describe(post: MarketingPost, detail: string): string {
  return [
    `Post: ${post.id}`,
    `Channel: ${post.channel}`,
    `Kind: ${post.kind}`,
    `Publish at: ${post.publishAt}`,
    '',
    detail,
  ].join('\n');
}

/** R3: only Draft fields cross into the adapter; lint flags and notes never do. */
function draftFields(post: MarketingPost): Omit<Draft, 'media'> {
  const payload = post.payload;
  const draft: Omit<Draft, 'media'> = { channel: post.channel as AdapterChannel };
  if (payload['text'] !== undefined) draft.text = payload['text'] as string;
  if (payload['threadParts'] !== undefined) {
    draft.threadParts = payload['threadParts'] as string[];
  }
  if (payload['link'] !== undefined) draft.link = payload['link'] as Draft['link'];
  if (payload['article'] !== undefined) {
    draft.article = payload['article'] as Draft['article'];
  }
  return draft;
}

function requireUrl(value: unknown, field: string, post: MarketingPost): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new HoldError(
      `dispatch_error:${post.id}`,
      `Marketing post ${post.id} is missing ${field}`,
      `${field} is required to dispatch a ${post.channel} post.`
    );
  }
  return value;
}

export async function dispatchMarketingPosts(
  ex: SqlExecutor,
  input: { limit: number; signal: AbortSignal },
  deps: MarketingDispatchDependencies
): Promise<MarketingDispatchResult> {
  const now = deps.now();
  const result: MarketingDispatchResult = {
    posted: 0,
    waiting: 0,
    failed: 0,
    alerts: [],
  };
  let secrets: string[] = [];

  const raise = async (key: string, subject: string, body: string) => {
    if (result.alerts.includes(key)) return;
    result.alerts.push(key);
    let text = body;
    for (const secret of secrets) text = text.split(secret).join('[redacted]');
    try {
      await deps.alert(key, `[threadplane marketing] ${subject}`, text);
    } catch {
      // An alert transport failure must not stop the remaining rows.
    }
  };

  if (input.signal.aborted) return result;

  for (const post of await listExpiredPostingLeases(ex, now)) {
    await raise(
      `post_outcome_unknown:${post.id}`,
      `Post outcome unknown: ${post.channel} ${post.id}`,
      describe(
        post,
        `The posting lease expired at ${post.leaseExpiresAt} without a recorded outcome. ` +
          'Check the channel by hand before requeueing; the dispatcher will not retry it.'
      )
    );
  }

  let optionsLoad: Promise<AdapterOptions> | undefined;
  const adapterOptions = (): Promise<AdapterOptions> =>
    (optionsLoad ??= deps.loadAdapterOptions().then(async (options) => {
      secrets = collectSecrets(options);
      const expiresAt = options.linkedin?.credentials.expiresAt;
      if (
        expiresAt &&
        expiresAt.getTime() - now.getTime() < LINKEDIN_EXPIRY_WARNING_MS
      ) {
        const day = expiresAt.toISOString().slice(0, 10);
        await raise(
          `linkedin_expiring:${day}`,
          `LinkedIn token expires ${day}`,
          `The stored LinkedIn access token expires at ${expiresAt.toISOString()}.\n` +
            `Reauthorize with: npm run marketing:channels:linkedin:auth -- --target=<preview|production>`
        );
      }
      return options;
    }));

  const isLive = async (url: string): Promise<boolean> => {
    try {
      return await deps.checkLive(url);
    } catch {
      return false;
    }
  };

  async function prepareAdapterPost(
    post: MarketingPost
  ): Promise<{ adapter: ChannelAdapter; draft: Draft }> {
    const channel = post.channel as AdapterChannel;
    const media: DraftMedia[] = [];
    for (const ref of post.media) {
      try {
        media.push({ png: await deps.fetchMedia(ref.url), alt: ref.alt });
      } catch (error) {
        throw new HoldError(
          `media_unavailable:${post.id}`,
          `Media unavailable for ${post.channel} ${post.id}`,
          `Could not fetch ${ref.url}: ${messageOf(error)}`
        );
      }
    }

    let options: AdapterOptions;
    try {
      options = await adapterOptions();
    } catch (error) {
      throw new HoldError(
        `credentials_unavailable:${channel}`,
        `${channel} credentials unavailable`,
        `Loading channel credentials failed: ${messageOf(error)}`
      );
    }
    if (!options[channel]) {
      throw new HoldError(
        `credentials_unavailable:${channel}`,
        `${channel} credentials unavailable`,
        reauthHint(channel)
      );
    }
    const expiresAt = options.linkedin?.credentials.expiresAt;
    if (channel === 'linkedin' && expiresAt && expiresAt <= now) {
      throw new HoldError(
        `credentials_unavailable:${channel}`,
        `${channel} credentials unavailable`,
        `The LinkedIn access token expired at ${expiresAt.toISOString()}. ${reauthHint(channel)}`
      );
    }

    const draft: Draft = { ...draftFields(post) };
    if (media.length > 0) draft.media = media;
    return { adapter: deps.createAdapter(channel, options), draft };
  }

  async function processRow(post: MarketingPost): Promise<Outcome> {
    const token = post.leaseToken as string;
    const overdue =
      now.getTime() - new Date(post.publishAt).getTime() > NOT_LIVE_ALERT_MS;
    const release = async (): Promise<Outcome> => {
      await releaseToScheduled(ex, post.id, token);
      return 'waiting';
    };
    const notLive = async (detail: string): Promise<Outcome> => {
      await release();
      if (overdue) {
        await raise(
          `dependency_not_live:${post.id}`,
          `Dependency not live for ${post.channel} ${post.id}`,
          describe(post, detail)
        );
      }
      return 'waiting';
    };

    let prepared: { adapter: ChannelAdapter; draft: Draft };
    try {
      if (post.dependsOn) {
        const dependency = await getPost(ex, post.dependsOn);
        if (dependency?.status !== 'posted') {
          return await notLive(
            `Waiting on ${post.dependsOn}, which is ${dependency?.status ?? 'missing'}.`
          );
        }
      }

      if (post.channel === 'blog') {
        const canonical = requireUrl(
          post.payload['canonicalUrl'],
          'payload.canonicalUrl',
          post
        );
        if (!post.deployRequestedAt) {
          try {
            await deps.triggerDeploy();
          } catch (error) {
            throw new HoldError(
              `deploy_failed:${post.id}`,
              `Website deploy hook failed for blog ${post.id}`,
              messageOf(error)
            );
          }
          await markDeployRequested(ex, post.id, token, now);
          return await release();
        }
        if (await isLive(canonical)) {
          await markPosted(ex, post.id, token, { url: canonical });
          return 'posted';
        }
        await release();
        if (overdue) {
          await raise(
            `blog_not_live:${post.id}`,
            `Blog not live: ${post.id}`,
            describe(post, `${canonical} has not returned 200 since the deploy was requested at ${post.deployRequestedAt}.`)
          );
        }
        return 'waiting';
      }

      if (post.channel === 'devto') {
        const article = post.payload['article'] as
          | { canonicalUrl?: unknown }
          | undefined;
        const canonical = requireUrl(
          article?.canonicalUrl,
          'payload.article.canonicalUrl',
          post
        );
        if (!(await isLive(canonical))) {
          return await notLive(`${canonical} does not return 200 yet.`);
        }
        const existing = await deps.devtoHasCanonical(canonical);
        if (existing) {
          await markPosted(ex, post.id, token, { url: existing });
          return 'posted';
        }
      }

      prepared = await prepareAdapterPost(post);
    } catch (error) {
      // Nothing has been sent yet, so returning the row to `scheduled` is safe.
      await release();
      if (error instanceof HoldError) {
        await raise(error.alertKey, error.subject, describe(post, error.message));
      } else {
        await raise(
          `dispatch_error:${post.id}`,
          `Dispatch error for ${post.channel} ${post.id}`,
          describe(post, messageOf(error))
        );
      }
      return 'waiting';
    }

    // Point of no return: post() is called exactly once. Any throw is an
    // ambiguous outcome and is never retried automatically.
    let sent: Awaited<ReturnType<ChannelAdapter['post']>>;
    try {
      sent = await prepared.adapter.post(prepared.draft);
    } catch (error) {
      let detail = messageOf(error);
      try {
        await markFailed(ex, post.id, token, detail);
      } catch (recordError) {
        detail += `\n\nRecording the failure also failed: ${messageOf(recordError)}`;
      }
      await raise(
        `post_failed:${post.id}`,
        `Post failed: ${post.channel} ${post.id}`,
        describe(post, `${detail}\n\nThe post may or may not be live. Check the channel before requeueing.`)
      );
      return 'failed';
    }

    const recorded: PostResult = {
      postId: sent.postId,
      url: sent.url,
      postedAt: sent.postedAt,
      ...(sent.warnings?.length ? { warnings: sent.warnings } : {}),
    };
    try {
      await markPosted(ex, post.id, token, recorded);
    } catch (error) {
      await raise(
        `post_outcome_unknown:${post.id}`,
        `Posted but not recorded: ${post.channel} ${post.id}`,
        describe(post, `Live at ${sent.url}, but recording it failed: ${messageOf(error)}. The row stays in posting and will not be retried.`)
      );
      return 'posted';
    }
    if (sent.warnings?.length) {
      await raise(
        `post_warnings:${post.id}`,
        `Posted with warnings: ${post.channel} ${post.id}`,
        describe(post, `Live at ${sent.url}.\n\n${sent.warnings.join('\n')}`)
      );
    }
    return 'posted';
  }

  const leased = await leaseDuePosts(ex, {
    now,
    limit: input.limit,
    leaseMs: MARKETING_LEASE_MS,
  });
  for (const [index, post] of leased.entries()) {
    if (input.signal.aborted) {
      // Unstarted rows go back to `scheduled`; nothing was sent for them.
      for (const rest of leased.slice(index)) {
        try {
          await releaseToScheduled(ex, rest.id, rest.leaseToken as string);
        } catch {
          // Left in `posting`; the expired-lease alert will surface it.
        }
      }
      break;
    }
    try {
      result[await processRow(post)] += 1;
    } catch (error) {
      await raise(
        `dispatch_error:${post.id}`,
        `Dispatch error for ${post.channel} ${post.id}`,
        describe(post, messageOf(error))
      );
    }
  }
  return result;
}
