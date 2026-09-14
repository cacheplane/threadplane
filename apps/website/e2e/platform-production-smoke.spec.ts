import { expect, test, type Page, type Response } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateRuntimeParentOrigins } from '@threadplane/cockpit-runtime-bridge';
import {
  cockpitManifest,
  getWorkspaceDestinationPath,
} from '@threadplane/cockpit-registry';

/**
 * Production platform smoke: verifies the Website, deployed examples,
 * canonical demo, and shared runtimes as one product.
 *
 * Requires:
 *   EXAMPLES_URL - e.g. https://examples.threadplane.ai
 *   OPENAI_API_KEY - optional; enables the canonical LangGraph telemetry canary
 *
 * AG-UI canaries always exercise the deployed services' own provider keys.
 * They must not skip when the test runner has no local provider key.
 *
 * Run:
 *   PRODUCTION_SMOKE=true \
 *   EXAMPLES_URL=https://examples.threadplane.ai \
 *   npx playwright test apps/website/e2e/platform-production-smoke.spec.ts
 */

const EXAMPLES_URL =
  process.env['EXAMPLES_URL'] ?? 'https://examples.threadplane.ai';
const DEMO_URL = process.env['DEMO_URL'] ?? 'https://demo.threadplane.ai';
const WEBSITE_URL = process.env['WEBSITE_URL'] ?? 'https://threadplane.ai';
const AG_UI_DEMO_URL =
  process.env['AG_UI_DEMO_URL'] ?? 'https://ag-ui.threadplane.ai';
// Playwright transpiles specs to CJS, so `import.meta.url` here compiles to a
// `require` the ESM-loaded output cannot resolve and the whole file fails to
// load. `__dirname` is what the emitted module actually has. Don't "modernise"
// this back to import.meta.url.
const runtimeParentOriginSource = JSON.parse(
  readFileSync(join(__dirname, '../../../runtime-parent-origins.json'), 'utf8')
) as { readonly baseOrigins?: unknown };
const runtimeParentPreviewOrigins = (
  process.env['RUNTIME_PARENT_PREVIEW_ORIGINS'] ?? ''
)
  .split(/\r?\n/)
  .filter(Boolean);
const baseRuntimeParentOrigins = validateRuntimeParentOrigins(
  runtimeParentOriginSource.baseOrigins
);
const expectedRuntimeParentOrigins = validateRuntimeParentOrigins([
  ...(baseRuntimeParentOrigins ?? []),
  ...runtimeParentPreviewOrigins,
]);
if (
  baseRuntimeParentOrigins === null ||
  expectedRuntimeParentOrigins === null
) {
  throw new Error('Invalid runtime parent origin smoke policy');
}

const CHAT_CAPABILITIES = [
  'langgraph/streaming',
  'langgraph/persistence',
  'langgraph/interrupts',
  'langgraph/memory',
  'langgraph/durable-execution',
  'langgraph/subgraphs',
  'langgraph/time-travel',
  'langgraph/deployment-runtime',
  'deep-agents/planning',
  'deep-agents/filesystem',
  'deep-agents/subagents',
  'deep-agents/memory',
  'deep-agents/skills',
  'chat/tool-calls',
  'chat/subagents',
  'chat/threads',
  'chat/timeline',
  'chat/generative-ui',
  'chat/theming',
  'chat/a2ui',
] as const;

const CHAT_PRIMITIVE_CAPABILITIES = [
  'chat/messages',
  'chat/input',
  'chat/interrupts',
  'chat/debug',
] as const;

const CHAT_PRIMITIVE_READY_SELECTORS: Record<
  (typeof CHAT_PRIMITIVE_CAPABILITIES)[number],
  string
> = {
  'chat/messages': 'chat-message-list',
  'chat/input': 'chat-input',
  'chat/interrupts': 'chat-interrupt-panel',
  'chat/debug': 'chat-debug',
};

const RENDER_CAPABILITIES = [
  'render/spec-rendering',
  'render/element-rendering',
  'render/state-management',
  'render/registry',
  'render/repeat-loops',
  'render/computed-functions',
] as const;

/**
 * Driven off the capability registry so a newly added AG-UI topic is covered
 * automatically instead of silently going unasserted — the previous two
 * hardcoded checks covered interrupts and streaming only.
 *
 * Scoped to the AG-UI product: `runtimes` capabilities share the Railway
 * runtime but are not yet in the examples route table, so they have no
 * /ag-ui/<topic>/ URL to assert against.
 */
const AG_UI_TOPICS = [
  ...new Set(
    cockpitManifest
      .filter(
        (entry) => entry.product === 'ag-ui' && entry.runtimeAdapter === 'ag-ui'
      )
      .map((entry) => entry.topic)
  ),
].sort();

const SEND_RECEIVE_TIMEOUT_MS = 30_000;
const WEBSITE_DESTINATIONS = [
  ...new Set(cockpitManifest.map(getWorkspaceDestinationPath)),
].sort();

test.describe('Production: registry-owned Website destinations load', () => {
  for (const destination of WEBSITE_DESTINATIONS) {
    test(`${destination} is reachable`, async ({ request }) => {
      const response = await request.get(
        new URL(destination, WEBSITE_URL).toString()
      );

      expect(response.status()).toBeLessThan(400);
    });
  }
});

test.describe('Production: Angular chat example apps load', () => {
  for (const cap of CHAT_CAPABILITIES) {
    test(`${cap} loads at examples URL`, async ({ page }) => {
      const response = await page.goto(`${EXAMPLES_URL}/${cap}/`, {
        timeout: 15_000,
      });
      expect(response?.status()).toBe(200);
      await expect(page.locator('chat')).toBeVisible({ timeout: 10_000 });
    });
  }
});

test.describe('Production: Angular chat primitive apps load', () => {
  for (const cap of CHAT_PRIMITIVE_CAPABILITIES) {
    test(`${cap} loads at examples URL`, async ({ page }) => {
      const response = await page.goto(`${EXAMPLES_URL}/${cap}/`, {
        timeout: 15_000,
      });
      expect(response?.status()).toBe(200);
      await expect(
        page.locator(CHAT_PRIMITIVE_READY_SELECTORS[cap])
      ).toBeAttached({
        timeout: 10_000,
      });
    });
  }
});

test.describe('Production: render example apps load', () => {
  for (const cap of RENDER_CAPABILITIES) {
    test(`${cap} loads at examples URL`, async ({ page }) => {
      const response = await page.goto(`${EXAMPLES_URL}/${cap}/`, {
        timeout: 15_000,
      });
      expect(response?.status()).toBe(200);
      await expect(page.locator('body')).not.toBeEmpty({ timeout: 10_000 });
    });
  }
});

test.describe('Production: unified runtime embedding policy', () => {
  test('assembled children ship the exact parent/referrer policy without an X-Frame-Options conflict', async ({
    request,
  }) => {
    const response = await request.get(`${EXAMPLES_URL}/langgraph/streaming/`);
    const headers = response.headers();
    const policy = headers['content-security-policy'];
    const frameAncestors = policy
      ?.split(';')
      .find((directive) => directive.trim().startsWith('frame-ancestors'));

    expect(response.status()).toBe(200);
    const actualFrameAncestors = frameAncestors?.trim().split(/\s+/).slice(1);
    const validatedFrameAncestors =
      validateRuntimeParentOrigins(actualFrameAncestors);
    expect(validatedFrameAncestors).not.toBeNull();
    if (runtimeParentPreviewOrigins.length > 0) {
      expect(validatedFrameAncestors).toEqual(expectedRuntimeParentOrigins);
    } else {
      for (const origin of baseRuntimeParentOrigins) {
        expect(validatedFrameAncestors).toContain(origin);
      }
    }
    expect(policy).toContain(
      "connect-src 'self' https: http://localhost:* http://127.0.0.1:*"
    );
    expect(policy).not.toContain('http://[::1]:*');
    expect(policy).toContain("script-src 'self';");
    expect(await response.text()).not.toContain('onload="this.media=');
    expect(frameAncestors).not.toContain('*');
    expect(frameAncestors).not.toContain('cockpit.threadplane.ai');
    expect(headers['referrer-policy']).toBe('origin');
    expect(headers['x-frame-options']).toBeUndefined();
  });

  test('production begins Shared-only and sends only the Website origin as iframe referrer', async ({
    page,
  }) => {
    let iframeReferrer: string | undefined;
    page.on('request', (request) => {
      if (request.resourceType() !== 'document') return;
      if (!request.url().startsWith(`${EXAMPLES_URL}/langgraph/streaming`)) {
        return;
      }
      iframeReferrer = request.headers()['referer'];
    });

    await page.goto(`${WEBSITE_URL}/docs/langgraph/guides/streaming?mode=run`);
    const controls = page.locator('[data-workspace-desktop-navigation]');
    await controls
      .getByRole('button', { name: 'Settings', exact: true })
      .click();
    await expect(
      page.locator('[data-runtime-target-settings]')
    ).toHaveAttribute('data-runtime-target-kind', 'shared');
    await expect(
      page.locator('[data-runtime-target-settings]')
    ).not.toContainText('Custom target active');
    await expect
      .poll(() => iframeReferrer)
      .toBe(new URL(WEBSITE_URL).origin + '/');
  });
});

test.describe('Production: canonical demo sends runtime telemetry', () => {
  test.skip(() => !process.env['OPENAI_API_KEY'], 'Requires OPENAI_API_KEY');

  test('demo chat sends and receives a message with runtime lifecycle telemetry', async ({
    page,
  }) => {
    test.setTimeout(75_000);
    const telemetryPayloads: Array<{ event?: unknown; properties?: unknown }> =
      [];
    page.on('request', (request) => {
      const url = request.url();
      if (!url.includes('/api/ingest')) return;
      const body = request.postData();
      if (!body) return;
      try {
        telemetryPayloads.push(JSON.parse(body));
      } catch {
        // Ignore malformed non-JSON requests; assertions below require valid telemetry payloads.
      }
    });

    await page.goto(`${DEMO_URL}/embed`, { timeout: 15_000 });
    await expect(page.locator('chat')).toBeVisible({ timeout: 10_000 });

    await page.locator('textarea[name="messageText"]').fill('hello');
    await page.getByRole('button', { name: /send message/i }).click();

    await expect(
      page.locator('chat-message[data-role="assistant"]').last()
    ).toBeVisible({
      timeout: SEND_RECEIVE_TIMEOUT_MS,
    });

    for (const event of [
      'tplane:runtime_request_created',
      'tplane:stream_started',
      'tplane:stream_ended',
    ]) {
      await expect
        .poll(
          () =>
            telemetryPayloads.some(
              (payload) =>
                payload.event === event &&
                typeof payload.properties === 'object' &&
                payload.properties !== null &&
                (payload.properties as Record<string, unknown>)['transport'] ===
                  'langgraph' &&
                (payload.properties as Record<string, unknown>)['surface'] ===
                  'canonical_demo'
            ),
          { timeout: 10_000 }
        )
        .toBe(true);
    }

    expect(JSON.stringify(telemetryPayloads)).not.toMatch(
      /messages|threadId|assistantId|apiUrl/
    );
  });
});

test.describe('AG-UI Railway runtime', () => {
  const RAILWAY_URL =
    process.env['AG_UI_RAILWAY_URL'] ??
    'https://ag-ui-dev-production.up.railway.app';

  test('healthcheck /ok responds 200', async ({ request }) => {
    const res = await request.get(`${RAILWAY_URL}/ok`);
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  for (const topic of AG_UI_TOPICS) {
    test(`ag-ui/${topic} page is reachable`, async ({ page }) => {
      const res = await page.goto(`${EXAMPLES_URL}/ag-ui/${topic}/`, {
        timeout: 15_000,
      });
      expect(res?.status()).toBeLessThan(400);
    });

    /**
     * Page reachability is not enough, and /ok is not either. A misconfigured
     * agent URL, a missing proxy route, or a Railway image that crashed on
     * boot all leave a healthy 200 index.html and a healthy /ok while the
     * runtime endpoint is dead — Railway keeps serving the last good image
     * when a new one fails to boot. That combination hid a broken
     * /agent/subagents for two and a half months.
     *
     * POSTing an empty body is a deliberate, token-free canary: the FastAPI
     * request model rejects it before any graph or LLM call runs.
     *   422 → healthy (proxy routed, internal token accepted, topic mounted)
     *   404 → topic missing from the deployed image, or no proxy route
     *   401 → AG_UI_INTERNAL_TOKEN mismatch between the proxy and Railway
     */
    test(`ag-ui/${topic} agent endpoint is routed and mounted`, async ({
      request,
    }) => {
      const res = await request.post(`${EXAMPLES_URL}/ag-ui/${topic}/agent`, {
        headers: { Origin: EXAMPLES_URL, 'content-type': 'application/json' },
        data: {},
      });
      const status = res.status();
      expect(
        status,
        `POST /ag-ui/${topic}/agent returned ${status}; 404 means the deployed image has no /agent/${topic} route (check the Railway build/boot log) or the Vercel proxy route is missing`
      ).not.toBe(404);
      expect(
        status,
        `POST /ag-ui/${topic}/agent returned 401 — AG_UI_INTERNAL_TOKEN mismatch between the Vercel proxy and Railway`
      ).not.toBe(401);
      expect(status).toBeLessThan(500);
    });
  }
});

/**
 * Regression guard for the examples LangGraph proxy hardening
 * (scripts/examples-middleware.ts → createProxyHandler). These assert the
 * origin allowlist and body-size cap stay live after future redeploys.
 *
 * Both checks are rejected by the proxy BEFORE the rate-limit gate and before
 * any forward to LangGraph Cloud, so they burn no LLM tokens and consume no
 * rate-limit budget. The rate-limit (429) path is deliberately NOT asserted
 * here — it is stateful/time-windowed and would race with real traffic.
 */
test.describe('examples langgraph proxy hardening', () => {
  const streamPath = () =>
    `${EXAMPLES_URL}/api/threads/00000000-0000-0000-0000-000000000000/runs/stream`;
  const runBody = { assistant_id: 'streaming', input: { messages: [] } };

  test('rejects a forbidden Origin with 403', async ({ request }) => {
    const res = await request.post(streamPath(), {
      headers: {
        Origin: 'https://evil.example.com',
        'content-type': 'application/json',
      },
      data: runBody,
    });
    expect(res.status()).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'origin_not_allowed' });
  });

  test('rejects an oversized body with 413', async ({ request }) => {
    const res = await request.post(streamPath(), {
      headers: { Origin: EXAMPLES_URL, 'content-type': 'application/json' },
      data: { assistant_id: 'streaming', input: { blob: 'A'.repeat(70_000) } },
    });
    expect(res.status()).toBe(413);
    expect(await res.json()).toMatchObject({ error: 'payload_too_large' });
  });
});

// A provider authentication error can close an HTTP-200 stream before an
// interrupt or reply arrives. Require protocol completion, not just transport
// success, so this fails promptly with a useful diagnostic in that case.
async function completedAgentEvents(response: Response) {
  expect(response.status(), response.url()).toBe(200);
  const events = (await response.text())
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => JSON.parse(line.slice(5).trim()) as Record<string, unknown>);
  const types = events.map((event) => event['type']);
  expect(types, 'Agent returned RUN_ERROR').not.toContain('RUN_ERROR');
  expect(
    types,
    'Agent stream ended without RUN_FINISHED; check deployed provider credentials and runtime logs'
  ).toContain('RUN_FINISHED');
  return events;
}

function nextAgentResponse(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/agent'),
    { timeout: 60_000 }
  );
}

test.describe('Production: live AG-UI provider canaries', () => {
  // These are synthetic demo operations. Run sequentially and bound retries
  // separately from dev-server startup retries to limit live provider usage.
  test.describe.configure({ mode: 'default', timeout: 120_000, retries: 1 });

  for (const runtime of ['refund', 'mastra'] as const) {
    for (const approved of [true, false]) {
      const action = approved ? 'Approve' : 'Cancel';
      test(`${runtime}: ${action} completes the live approval flow`, async ({
        page,
      }) => {
        const mastra = runtime === 'mastra';
        await page.goto(
          `${EXAMPLES_URL}/${mastra ? 'runtimes/mastra' : 'ag-ui/interrupts'}/`
        );
        const initialResponse = nextAgentResponse(page);
        await page
          .getByText(
            mastra ? 'Reserve the campsite' : 'Refund a duplicate charge',
            { exact: true }
          )
          .click();
        const initialEvents = await completedAgentEvents(await initialResponse);
        expect(initialEvents).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: 'CUSTOM', name: 'on_interrupt' }),
          ])
        );
        const dialog = page.locator('dialog.chat-approval-card');
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText(
          mastra ? 'Reservation approval required' : 'Refund approval required'
        );
        await expect(dialog).toContainText(
          mastra ? 'North Pines' : 'cus_a8x2k'
        );
        await expect(dialog).toContainText(mastra ? '$90.00' : '$47.50');

        const resumedResponse = nextAgentResponse(page);
        await dialog.getByRole('button', { name: action, exact: true }).click();
        const response = await resumedResponse;
        const command = response.request().postDataJSON()
          .forwardedProps.command;
        expect(command.resume.approved).toBe(approved);
        const events = await completedAgentEvents(response);
        await expect(dialog).not.toBeVisible();
        const reply = page
          .locator('chat-message[data-role="assistant"]')
          .last();

        if (mastra) {
          expect(command.interruptEvent.toolCallId).toEqual(expect.any(String));
          expect(command.interruptEvent.runId).toEqual(expect.any(String));
          expect(events).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                type: 'TOOL_CALL_RESULT',
                toolCallId: command.interruptEvent.toolCallId,
                content: expect.stringContaining(
                  approved ? 'Reserved North Pines' : 'Nothing was booked.'
                ),
              }),
            ])
          );
          const cancellation =
            /declined|cancelled|canceled|not.{0,20}(booked|completed|confirmed|reserved)|nothing.{0,20}booked/i;
          await expect(reply).toContainText(
            approved ? /reserved|confirmed|booked/i : cancellation
          );
          if (approved) await expect(reply).not.toContainText(cancellation);
          else await expect(reply).not.toContainText('TP-0288');
        } else {
          await expect(reply).toContainText(
            approved
              ? 'Refund of $47.50 issued to'
              : 'Refund cancelled by operator. No charge issued.'
          );
          if (approved) await expect(reply).toContainText('cus_a8x2k');
          else await expect(reply).not.toContainText('Refund ID:');
        }
      });
    }
  }

  test('AG-UI demo completes a live reply', async ({ page }) => {
    await page.goto(`${AG_UI_DEMO_URL}/embed`);
    await page
      .locator('textarea[name="messageText"]')
      .fill('Say hello in one sentence.');
    const response = nextAgentResponse(page);
    await page.getByRole('button', { name: /send message/i }).click();
    const events = await completedAgentEvents(await response);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'TEXT_MESSAGE_CONTENT',
          delta: expect.stringMatching(/\S/),
        }),
      ])
    );
    await expect(
      page.locator('chat-message[data-role="assistant"]').last()
    ).toContainText(/\S/);
  });
});

test.describe('AG-UI demo (ag-ui.threadplane.ai)', () => {
  const DEMO = AG_UI_DEMO_URL;

  test('demo SPA is reachable', async ({ page }) => {
    const res = await page.goto(`${DEMO}/`);
    expect(res?.status()).toBeLessThan(400);
  });

  test('forbidden origin to /agent is rejected with 403', async ({
    request,
  }) => {
    const res = await request.post(`${DEMO}/agent`, {
      headers: {
        Origin: 'https://evil.example.com',
        'content-type': 'application/json',
      },
      data: {},
    });
    expect(res.status()).toBe(403);
  });
});
