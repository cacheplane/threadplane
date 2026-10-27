#!/usr/bin/env npx tsx
/**
 * Verify that the deployed ag-ui Railway runtime actually serves every topic
 * in the capability registry.
 *
 * Why this exists: `deploy-ag-ui.yml` ships with `railway up --detach`, which
 * returns as soon as the upload is accepted — long before Railway builds or
 * starts the image. A build that fails afterwards leaves the PREVIOUS image
 * running while the workflow reports success, so a topic can be missing from
 * production for months with every check green. That is exactly how
 * `/agent/subagents` went missing: three successful uploads carried the route,
 * but the live instance kept serving the pre-subagents route table.
 *
 * `/ok` cannot catch this — a stale image answers it happily. The only signal
 * that distinguishes image vintage is whether each topic's route is registered.
 *
 * The `microsoft-agent-framework` topic is served by the separate `ag-ui-maf`
 * service through the same proxy (`AG_UI_MAF_URL`), not by the deployed Railway
 * image, so a MAF probe failing right after a deploy can mean the examples
 * promote carrying the new proxy route has not landed yet.
 *
 * Probing goes through the public Vercel proxy rather than Railway directly:
 * the FastAPI middleware requires X-Internal-Token, which lives on Railway and
 * Vercel but is deliberately not a CI secret. The proxy injects it.
 *
 * An empty POST body is a deliberate, token-free canary — the request model
 * rejects it before any graph or LLM call runs:
 *   422 → healthy (proxy routed, token accepted, topic registered)
 *   404 → topic missing from the deployed image, or no Vercel proxy route
 *   401 → AG_UI_INTERNAL_TOKEN mismatch between the proxy and Railway
 *
 * Usage:
 *   npx tsx scripts/verify-ag-ui-runtime.ts
 *   EXAMPLES_URL=https://examples.threadplane.ai npx tsx scripts/verify-ag-ui-runtime.ts
 */
import { pathToFileURL } from 'url';
import { capabilities } from '@threadplane/cockpit-registry';

const EXAMPLES_URL = process.env['EXAMPLES_URL'] ?? 'https://examples.threadplane.ai';
const RAILWAY_URL =
  process.env['AG_UI_RAILWAY_URL'] ?? 'https://ag-ui-dev-production.up.railway.app';

/** How long to keep polling while Railway builds and rolls out the new image. */
const DEADLINE_MS = Number(process.env['AG_UI_VERIFY_TIMEOUT_MS'] ?? 15 * 60 * 1000);
const POLL_INTERVAL_MS = Number(process.env['AG_UI_VERIFY_INTERVAL_MS'] ?? 20_000);

export type TopicVerdict =
  | { ok: true; status: number }
  | { ok: false; status: number; reason: string };

/**
 * Classify an agent-endpoint response. Anything that is not a routing or auth
 * failure means the topic is registered and reachable — which is all this
 * check claims.
 */
export function classifyStatus(status: number): TopicVerdict {
  if (status === 404) {
    return {
      ok: false,
      status,
      reason:
        'route not found — the deployed Railway image has no handler for this topic, or the Vercel proxy route is missing',
    };
  }
  if (status === 401) {
    return {
      ok: false,
      status,
      reason:
        'unauthorized — AG_UI_INTERNAL_TOKEN differs between the Vercel proxy and Railway',
    };
  }
  if (status >= 500) {
    return { ok: false, status, reason: 'upstream error from the Railway runtime' };
  }
  return { ok: true, status };
}

export interface DeployedTopic {
  /** URL segment the examples site serves this capability under. */
  product: 'ag-ui' | 'runtimes';
  topic: string;
}

/**
 * Mirrors collectTopics() in scripts/generate-ag-ui-deployment-config.ts: the
 * 'ag-ui' and 'runtimes' products are both AG-UI-served FastAPI backends
 * aggregated into the single ag-ui-dev deployment, and a capability without a
 * pythonDir is hosted elsewhere (mastra is Node-hosted). Deriving the list the
 * same way the generator does keeps this check honest — it asserts exactly
 * what the deployment was generated to mount, so a new topic is covered with
 * no edit here.
 */
export function deployedTopics(): DeployedTopic[] {
  const topics = capabilities
    .filter(
      (c) => (c.product === 'ag-ui' || c.product === 'runtimes') && c.pythonDir
    )
    .map((c) => ({ product: c.product as DeployedTopic['product'], topic: c.topic }))
    .sort((a, b) => a.topic.localeCompare(b.topic));
  if (topics.length === 0) {
    throw new Error('No ag-ui topics with pythonDir found in capability registry');
  }
  return topics;
}

/** Public path the SPA for this capability calls; both proxy to the same runtime. */
export function agentUrlFor({ product, topic }: DeployedTopic): string {
  return `/${product}/${topic}/agent`;
}

async function probeTopic(entry: DeployedTopic): Promise<TopicVerdict> {
  try {
    const res = await fetch(`${EXAMPLES_URL}${agentUrlFor(entry)}`, {
      method: 'POST',
      headers: { origin: EXAMPLES_URL, 'content-type': 'application/json' },
      body: '{}',
    });
    return classifyStatus(res.status);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: 0, reason: `request failed — ${message}` };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const topics = deployedTopics();
  console.log(
    `Verifying ${topics.length} deployed topics via ${EXAMPLES_URL} (Railway: ${RAILWAY_URL})`
  );

  const deadline = Date.now() + DEADLINE_MS;
  let pending: DeployedTopic[] = [...topics];
  const verdicts = new Map<string, TopicVerdict>();

  // Poll rather than probe once: `railway up --detach` returns before the new
  // image is live, so an immediate check would assert against the old one.
  for (;;) {
    const results = await Promise.all(
      pending.map(async (entry) => [entry, await probeTopic(entry)] as const)
    );
    for (const [entry, verdict] of results) verdicts.set(entry.topic, verdict);
    pending = results.filter(([, v]) => !v.ok).map(([e]) => e);

    if (pending.length === 0) break;
    if (Date.now() >= deadline) break;

    const remainingS = Math.round((deadline - Date.now()) / 1000);
    console.log(
      `⏳ still unhealthy: ${pending.map((e) => e.topic).join(', ')} — retrying in ${POLL_INTERVAL_MS / 1000}s (${remainingS}s left)`
    );
    await sleep(POLL_INTERVAL_MS);
  }

  const summary = topics.map((entry) => ({
    topic: entry.topic,
    url: agentUrlFor(entry),
    verdict: verdicts.get(entry.topic) ?? {
      ok: false as const,
      status: 0,
      reason: 'never probed',
    },
  }));

  for (const { topic, url, verdict } of summary) {
    if (verdict.ok) {
      console.log(`✅ ${topic}: mounted at ${url} (HTTP ${verdict.status})`);
    } else {
      console.error(`❌ ${topic}: ${url} → HTTP ${verdict.status} — ${verdict.reason}`);
    }
  }

  const failed = summary.filter(({ verdict }) => !verdict.ok);
  console.log(`\n${summary.length - failed.length} healthy, ${failed.length} failing`);
  if (failed.length > 0) {
    console.error(
      '\nThe deployed image does not serve every registered topic. Check the ' +
        'Railway build log for the ag-ui-dev service — `railway up --detach` ' +
        'reports success on upload, not on a successful build.'
    );
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ ag-ui runtime verification failed — ${message}`);
    process.exit(1);
  });
}
