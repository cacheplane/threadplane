#!/usr/bin/env npx tsx
/**
 * Verify the shared cockpit LangSmith deployment.
 *
 * Usage:
 *   npx tsx scripts/verify-shared-deployment.ts --dry-run
 *   npx tsx scripts/verify-shared-deployment.ts
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

type DeploymentUrls = Record<string, string>;

const REQUIRED_URL_KEYS = [
  'streaming',
  'deployment-runtime',
  'planning',
  'filesystem',
] as const;

const SMOKE_ASSISTANT_IDS = [
  'streaming',
  'deployment-runtime',
  'da-planning',
  'da-filesystem',
  'c-generative-ui',
  'c-a2ui',
  'chat',
] as const;

type SmokeAssistantId = (typeof SMOKE_ASSISTANT_IDS)[number];

const DEPLOYMENT_URLS_PATH = resolve(__dirname, '../deployment-urls.json');
export const DEFAULT_SMOKE_ASSISTANT_STREAM_TIMEOUT_MS = 30000;

const SMOKE_ASSISTANT_STREAM_TIMEOUT_MS: Partial<Record<SmokeAssistantId, number>> = {
  // The planning graph intentionally performs two model calls: one to create
  // structured plan state, then one to execute the plan and answer.
  'da-planning': 90000,
  // UI graph assistants can include extra model/tool work before the first AI
  // stream event, and CI has observed them occasionally crossing 30s.
  'c-generative-ui': 90000,
  'c-a2ui': 90000,
};

export function getSmokeAssistantStreamTimeoutMs(assistantId: SmokeAssistantId) {
  return (
    SMOKE_ASSISTANT_STREAM_TIMEOUT_MS[assistantId] ??
    DEFAULT_SMOKE_ASSISTANT_STREAM_TIMEOUT_MS
  );
}

function parseArgs(argv: string[]) {
  return {
    dryRun: argv.includes('--dry-run'),
  };
}

function readDeploymentUrls(): DeploymentUrls {
  const raw = readFileSync(DEPLOYMENT_URLS_PATH, 'utf-8');
  return JSON.parse(raw) as DeploymentUrls;
}

function normalizeUrl(value: string | undefined): string {
  return (value ?? '').trim();
}

function isPlaceholderUrl(url: string): boolean {
  return url === 'PENDING_DEPLOYMENT' || url.includes('placeholder');
}

function getSharedUrl(urls: DeploymentUrls): string {
  const entries = Object.entries(urls);
  if (entries.length === 0) {
    throw new Error('deployment-urls.json does not contain any deployment entries');
  }

  const normalized = entries.map(([name, url]) => [name, normalizeUrl(url)] as const);
  const missing = normalized.filter(([, url]) => url.length === 0);
  if (missing.length > 0) {
    throw new Error(`Missing deployment URL for: ${missing.map(([name]) => name).join(', ')}`);
  }

  const unique = [...new Set(normalized.map(([, url]) => url))];
  if (unique.length !== 1) {
    throw new Error(
      [
        'deployment-urls.json must resolve every active capability to the same shared URL',
        `Found URLs: ${unique.join(', ')}`,
      ].join('\n'),
    );
  }

  return unique[0]!;
}

function validateRequiredAssistants(urls: DeploymentUrls) {
  const missing = REQUIRED_URL_KEYS.filter((id) => !normalizeUrl(urls[id]));
  if (missing.length > 0) {
    throw new Error(`Missing required deployment URL keys: ${missing.join(', ')}`);
  }
}

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}${text ? ` - ${text}` : ''}`);
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Expected JSON from ${url}, received: ${text}`);
  }
}

export async function verifyHealth(url: string) {
  const data = await fetchJson(`${url}/ok`, {
    headers: authHeaders(),
    // The shared free deployment can sleep between visits; its measured
    // cold start takes about 32 seconds. Only this read-only readiness request
    // gets a larger budget. Thread creation and model streams are unchanged.
    signal: AbortSignal.timeout(60000),
  });

  if (!data || typeof data !== 'object' || (data as { ok?: unknown }).ok !== true) {
    throw new Error(`/ok returned ${JSON.stringify(data)}`);
  }
}

function authHeaders(): Record<string, string> {
  const apiKey = process.env['LANGSMITH_API_KEY'] ?? '';
  return apiKey ? { 'x-api-key': apiKey } : {};
}

async function createThread(url: string) {
  const thread = await fetchJson(`${url}/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ metadata: {} }),
    signal: AbortSignal.timeout(10000),
  });

  const threadId = (thread as { thread_id?: string }).thread_id;
  if (!threadId) {
    throw new Error(`Thread creation response missing thread_id: ${JSON.stringify(thread)}`);
  }

  return threadId;
}

async function smokeAssistant(url: string, assistantId: SmokeAssistantId) {
  const threadId = await createThread(url);
  const timeoutMs = getSmokeAssistantStreamTimeoutMs(assistantId);
  const runRes = await fetch(`${url}/threads/${threadId}/runs/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      assistant_id: assistantId,
      input: { messages: [{ role: 'human', content: 'hello' }] },
      stream_mode: ['values'],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await runRes.text();
  if (!runRes.ok) {
    throw new Error(`${runRes.status} ${runRes.statusText}${text ? ` - ${text}` : ''}`);
  }

  if (!text.includes('"type":"ai"')) {
    throw new Error(`No AI response in stream: ${text}`);
  }
}

async function main() {
  const { dryRun } = parseArgs(process.argv.slice(2));
  const urls = readDeploymentUrls();
  validateRequiredAssistants(urls);

  const sharedUrl = getSharedUrl(urls);
  const activeNames = Object.keys(urls).sort();

  if (dryRun) {
    console.log(`✅ deployment-urls.json is shared across ${activeNames.length} active capabilities`);
    console.log(`✅ required deployment URL keys present: ${REQUIRED_URL_KEYS.join(', ')}`);
    console.log(`✅ smoke assistants configured: ${SMOKE_ASSISTANT_IDS.join(', ')}`);
    console.log(`✅ shared URL: ${sharedUrl}`);
    if (isPlaceholderUrl(sharedUrl)) {
      console.log('ℹ️  shared URL is still a placeholder');
    }
    return;
  }

  if (isPlaceholderUrl(sharedUrl)) {
    throw new Error('deployment-urls.json still points at PENDING_DEPLOYMENT; live verification requires a real URL');
  }

  await verifyHealth(sharedUrl);
  console.log(`✅ shared deployment healthy (${sharedUrl})`);

  let passed = 0;
  const failures: string[] = [];

  for (const assistantId of SMOKE_ASSISTANT_IDS) {
    try {
      await smokeAssistant(sharedUrl, assistantId);
      console.log(`✅ ${assistantId}: smoke test passed`);
      passed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${assistantId}: ${message}`);
      console.error(`❌ ${assistantId}: smoke test failed — ${message}`);
    }
  }

  console.log(`\n${passed} passed, ${failures.length} failed out of ${SMOKE_ASSISTANT_IDS.length}`);
  if (failures.length > 0) {
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ shared deployment verification failed — ${message}`);
    process.exit(1);
  });
}
