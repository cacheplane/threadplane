import { createResendFetchClient } from './resend-client.js';
import type { SqlExecutor } from './growth.js';

// Keep the runtime dependency relative so Dawn's native Vercel bundler
// includes the workspace libraries in the closed function artifact.
// eslint-disable-next-line @nx/enforce-module-boundaries -- the relative edge is required in the emitted Vercel function
import {
  claimAlert,
  createAlertSender,
  dispatchMarketingPosts,
  loadAdapterOptions,
  loadCredentialKey,
  releaseAlertClaim,
  type MarketingDispatchDependencies,
  type MarketingDispatchResult,
} from '../../../marketing/queue/src/index.ts';
// eslint-disable-next-line @nx/enforce-module-boundaries -- the relative edge is required in the emitted Vercel function
import { createAdapter } from '../../../marketing/channels/src/index.ts';

export type { MarketingDispatchResult };

type Environment = Record<string, string | undefined>;

const MARKETING_POST_LIMIT = 5;
const LIVE_CHECK_TIMEOUT_MS = 10_000;

function requiredText(env: Environment, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/** Builds the dispatcher's real dependencies over the root executor `ex`. */
export function createMarketingDependencies(
  ex: SqlExecutor,
  env: Environment,
  options: { fetch?: typeof globalThis.fetch } = {}
): MarketingDispatchDependencies {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  // The key is read per call so a missing key surfaces as the dispatcher's
  // credentials_unavailable hold instead of crashing the tick.
  const loadOptions = async () =>
    loadAdapterOptions(ex, loadCredentialKey(env), env);
  return {
    now: () => new Date(),
    createAdapter,
    loadAdapterOptions: loadOptions,
    async fetchMedia(url) {
      const response = await fetchImpl(url);
      if (!response.ok) {
        throw new Error(`Media fetch answered ${response.status}`);
      }
      return Buffer.from(await response.arrayBuffer());
    },
    async checkLive(url) {
      const response = await fetchImpl(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(LIVE_CHECK_TIMEOUT_MS),
      });
      await response.body?.cancel().catch(() => undefined);
      return response.status === 200;
    },
    async devtoHasCanonical(canonicalUrl) {
      const apiKey = (await loadOptions()).devto?.credentials.apiKey;
      if (!apiKey) throw new Error('dev.to credentials are unavailable');
      const response = await fetchImpl(
        'https://dev.to/api/articles/me/all?per_page=1000',
        { headers: { 'api-key': apiKey, Accept: 'application/json' } }
      );
      if (!response.ok) {
        throw new Error(`dev.to article lookup answered ${response.status}`);
      }
      const articles = (await response.json()) as {
        canonical_url?: string;
        url?: string;
      }[];
      const match = articles.find(
        (article) => article.canonical_url === canonicalUrl
      );
      return match?.url ?? null;
    },
    async triggerDeploy() {
      const hook = requiredText(env, 'MARKETING_WEBSITE_DEPLOY_HOOK_URL');
      const response = await fetchImpl(hook, { method: 'POST' });
      if (!response.ok) {
        throw new Error(`Deploy hook answered ${response.status}`);
      }
    },
    // Built on first use so posting never needs alert configuration unless
    // something actually has to be reported.
    alert: (key, subject, body) =>
      createAlertSender({
        resend: {
          send: (message) =>
            createResendFetchClient({
              apiKey: requiredText(env, 'RESEND_API_KEY'),
              fetch: fetchImpl,
            }).emails.send(message, {
              idempotencyKey: `marketing-alert:${key}`,
            }),
        },
        from: requiredText(env, 'MARKETING_ALERT_FROM'),
        to: requiredText(env, 'FOUNDER_NOTIFICATION_EMAIL'),
        claim: (claimKey) => claimAlert(ex, claimKey),
        release: (claimKey) => releaseAlertClaim(ex, claimKey),
      })(key, subject, body),
  };
}

/**
 * The tick's marketing step. Nothing is read from `env` until the step runs,
 * so a disabled switch never needs marketing configuration.
 */
export function createMarketingDispatch(
  env: Environment
): (ex: SqlExecutor, signal: AbortSignal) => Promise<MarketingDispatchResult> {
  return (ex, signal) =>
    dispatchMarketingPosts(
      ex,
      { limit: MARKETING_POST_LIMIT, signal },
      createMarketingDependencies(ex, env)
    );
}
