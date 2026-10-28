import {
  expect,
  test,
  type FrameLocator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { renderRuntimeBridgeFrame } from './fixtures/runtime-bridge-frame';

const LANGGRAPH_PATH = '/docs/langgraph/guides/streaming';
const AG_UI_PATH = '/docs/ag-ui/reference/event-mapping';
const CHAT_THREADS_PATH = '/docs/chat/guides/thread-routing';
const FIXTURE_ORIGIN = 'http://127.0.0.1:4399';
const FIXTURE_KEY = 'test-key-redact-me';
const POISON_MARKER = `${FIXTURE_KEY}-poison-body`;

const fixtureCaseId = (testInfo: TestInfo): string =>
  `case-${testInfo.workerIndex}-${testInfo.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`.slice(0, 80);

const fixtureRuntimeUrl = (testInfo: TestInfo, path: string): string =>
  `${FIXTURE_ORIGIN}/case/${fixtureCaseId(testInfo)}/${path}`;

const fixtureRequestLogUrl = (testInfo: TestInfo): string =>
  `${FIXTURE_ORIGIN}/__requests/${fixtureCaseId(testInfo)}`;

function assertSensitiveValuesAbsent(
  label: string,
  values: readonly unknown[],
  sensitiveValues: readonly string[]
): void {
  const contaminated = values.some((value) => {
    let serialized: string;
    try {
      serialized =
        typeof value === 'string' ? value : JSON.stringify(value) ?? '';
    } catch {
      serialized = String(value);
    }
    return sensitiveValues.some(
      (sensitive) => sensitive.length > 0 && serialized.includes(sensitive)
    );
  });
  expect(contaminated, `${label} contained prohibited runtime data`).toBe(
    false
  );
}

function observePrivacyChannels(page: Page): {
  readonly browserMessages: string[];
  readonly outboundPayloads: string[];
} {
  const browserMessages: string[] = [];
  const outboundPayloads: string[] = [];
  page.on('console', (message) => browserMessages.push(message.text()));
  page.on('pageerror', (error) => browserMessages.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    const analyticsPath =
      url.pathname === '/api/ingest' ||
      url.pathname === '/ingest' ||
      url.pathname.startsWith('/ingest/');
    const threadplaneBound =
      url.hostname === 'threadplane.ai' ||
      url.hostname.endsWith('.threadplane.ai');
    if (!analyticsPath && !threadplaneBound) return;
    const payload = request.postData();
    if (payload !== null) outboundPayloads.push(payload);
  });
  return { browserMessages, outboundPayloads };
}

const desktopControlPlane = (page: Page) =>
  page.locator('[data-workspace-desktop-navigation]');

const runtimeFrame = (page: Page, title: string): FrameLocator =>
  page.frameLocator(`iframe[title="${title} live example"]`);

async function openSettings(page: Page): Promise<void> {
  const settings = desktopControlPlane(page).getByRole('button', {
    name: 'Settings',
    exact: true,
  });
  await settings.click();
  await expect(page.locator('[data-runtime-target-settings]')).toBeVisible();
}

async function applyCustomTarget(
  page: Page,
  adapter: 'AG-UI' | 'LangSmith',
  endpoint: string,
  apiKey?: string
): Promise<void> {
  await openSettings(page);
  const settings = page.locator('[data-runtime-target-settings]');
  await settings.getByRole('radio', { name: `Custom ${adapter}` }).check();
  await settings.locator('input[name="rtu"]').fill(endpoint);
  if (apiKey) await settings.locator('input[name="rts"]').fill(apiKey);
  await settings.getByRole('button', { name: 'Use custom target' }).click();
  await expect(settings).toHaveAttribute(
    'data-runtime-target-kind',
    adapter === 'AG-UI' ? 'ag-ui' : 'langsmith'
  );
  if (apiKey)
    await expect(settings.locator('input[name="rts"]')).toHaveValue('');
  await desktopControlPlane(page)
    .getByRole('button', { name: 'Settings', exact: true })
    .click();
  await expect(page.locator('[data-runtime-target-settings]')).toBeHidden();
}

async function sendMessage(
  frame: FrameLocator,
  message: string
): Promise<void> {
  await frame.getByRole('textbox', { name: 'Type a message' }).fill(message);
  await frame.getByRole('button', { name: 'Send message' }).click();
}

async function assertMemoryPrivacy(page: Page): Promise<void> {
  const topState = await page.evaluate(
    (secret) => ({
      url: location.href,
      state: JSON.stringify(history.state),
      local: JSON.stringify(localStorage),
      session: JSON.stringify(sessionStorage),
      cookies: document.cookie,
      html: document.documentElement.outerHTML,
      secretPresent: document.documentElement.textContent?.includes(secret),
    }),
    FIXTURE_KEY
  );
  assertSensitiveValuesAbsent(
    'top-level memory privacy state',
    Object.values(topState),
    [FIXTURE_KEY]
  );

  for (const frame of page
    .frames()
    .filter((candidate) => candidate !== page.mainFrame())) {
    const childState = await frame.evaluate(() => ({
      url: location.href,
      local: JSON.stringify(localStorage),
      session: JSON.stringify(sessionStorage),
      cookies: document.cookie,
      html: document.documentElement.outerHTML,
    }));
    assertSensitiveValuesAbsent(
      'child memory privacy state',
      Object.values(childState),
      [FIXTURE_KEY]
    );
  }
}

async function assertOperationalPrivacy(
  page: Page,
  endpoint: string,
  privacyChannels: ReturnType<typeof observePrivacyChannels>
): Promise<void> {
  const runtimeSection = desktopControlPlane(page).locator(
    '[data-runtime-section]'
  );
  await runtimeSection
    .getByRole('button', { name: 'More runtime actions' })
    .click();
  await page.getByRole('menuitem', { name: 'Copy diagnostics' }).click();
  await expect(runtimeSection.getByRole('status')).toContainText(
    'Diagnostics copied.'
  );
  const diagnosticsText = await page.evaluate(() =>
    navigator.clipboard.readText()
  );
  assertSensitiveValuesAbsent('copied diagnostics', [diagnosticsText], [
    FIXTURE_KEY,
    POISON_MARKER,
    endpoint,
  ]);
  let diagnostics: unknown;
  try {
    diagnostics = JSON.parse(diagnosticsText);
  } catch {
    throw new Error('Copied diagnostics were not valid JSON');
  }
  expect(
    typeof diagnostics === 'object' &&
      diagnostics !== null &&
      (diagnostics as Record<string, unknown>)['targetKind'] === 'langsmith',
    'Copied diagnostics did not retain the sanitized target kind'
  ).toBe(true);

  await desktopControlPlane(page)
    .getByRole('button', { name: 'Activity', exact: true })
    .click();
  const activity = page.locator('[data-control-plane-utility-panel]');
  await expect(
    activity.getByText('Runtime ready', { exact: true }).first()
  ).toBeVisible();
  await expect(
    activity.getByText('Diagnostics copied', { exact: true }).first()
  ).toBeVisible();
  assertSensitiveValuesAbsent(
    'Activity',
    [await activity.textContent()],
    [FIXTURE_KEY, POISON_MARKER, endpoint]
  );

  await page.waitForTimeout(100);
  assertSensitiveValuesAbsent(
    'browser console and page errors',
    privacyChannels.browserMessages,
    [FIXTURE_KEY, POISON_MARKER, endpoint]
  );
  assertSensitiveValuesAbsent(
    'analytics and Threadplane-bound request payloads',
    privacyChannels.outboundPayloads,
    [FIXTURE_KEY, POISON_MARKER, endpoint]
  );
}

test.describe('custom runtime targets', () => {
  test.beforeEach(async ({ page, request }, testInfo) => {
    test.setTimeout(60_000);
    await page.addInitScript(() => {
      const hideDevelopmentIndicator = () => {
        document
          .querySelectorAll<HTMLElement>('nextjs-portal')
          .forEach((portal) => {
            portal.style.setProperty('display', 'none', 'important');
          });
      };
      addEventListener('DOMContentLoaded', () => {
        hideDevelopmentIndicator();
        new MutationObserver(hideDevelopmentIndicator).observe(
          document.documentElement,
          {
            childList: true,
            subtree: true,
          }
        );
      });
    });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await request.delete(fixtureRequestLogUrl(testInfo));
  });

  test('isolates fixture request evidence across concurrent case IDs', async ({
    request,
  }) => {
    await Promise.all([
      request.post(`${FIXTURE_ORIGIN}/case/isolation-a/ag-ui/success`, {
        headers: { Origin: 'http://localhost:4321' },
        data: {},
      }),
      request.post(`${FIXTURE_ORIGIN}/case/isolation-b/ag-ui/success`, {
        headers: { Origin: 'http://localhost:4300' },
        data: {},
      }),
    ]);

    const [caseA, caseB] = await Promise.all([
      request.get(`${FIXTURE_ORIGIN}/__requests/isolation-a`),
      request.get(`${FIXTURE_ORIGIN}/__requests/isolation-b`),
    ]);
    expect(await caseA.json()).toEqual([
      expect.objectContaining({ origin: 'http://localhost:4321' }),
    ]);
    expect(await caseB.json()).toEqual([
      expect.objectContaining({ origin: 'http://localhost:4300' }),
    ]);
  });

  test('streams through the real AG-UI app with an exact iframe Origin', async ({
    page,
    request,
  }, testInfo) => {
    await page.goto(`${AG_UI_PATH}?mode=run`);
    await applyCustomTarget(
      page,
      'AG-UI',
      fixtureRuntimeUrl(testInfo, 'ag-ui/success')
    );

    const frame = runtimeFrame(page, 'AG-UI Streaming');
    await sendMessage(frame, 'Use the custom AG-UI runtime');
    await expect(frame.getByText('Custom AG-UI success')).toBeVisible();

    const records = (await (
      await request.get(fixtureRequestLogUrl(testInfo))
    ).json()) as Array<{
      origin: string | null;
      headerNames: string[];
      keyMatched: boolean;
    }>;
    expect(
      records.some((record) => record.origin === 'http://localhost:4321')
    ).toBe(true);
    expect(
      records.some((record) => record.headerNames.includes('content-type'))
    ).toBe(true);
    assertSensitiveValuesAbsent('AG-UI request evidence', records, [
      FIXTURE_KEY,
    ]);
  });

  test('streams through the real LangGraph app with preflight and a sanitized key header', async ({
    page,
    request,
  }, testInfo) => {
    const endpoint = fixtureRuntimeUrl(testInfo, 'langgraph/success');
    const privacyChannels = observePrivacyChannels(page);
    await page.goto(`${LANGGRAPH_PATH}?mode=run`);
    await applyCustomTarget(
      page,
      'LangSmith',
      endpoint,
      FIXTURE_KEY
    );

    const frame = runtimeFrame(page, 'LangGraph Streaming');
    await sendMessage(frame, 'Use the custom LangSmith runtime');
    await expect(frame.getByText('Custom LangSmith success')).toBeVisible();

    const records = (await (
      await request.get(fixtureRequestLogUrl(testInfo))
    ).json()) as Array<{
      origin: string | null;
      headerNames: string[];
      keyMatched: boolean;
    }>;
    expect(
      records.some((record) => record.origin === 'http://localhost:4300')
    ).toBe(true);
    expect(
      records.some((record) =>
        record.headerNames.includes('access-control-request-method')
      )
    ).toBe(true);
    expect(
      records.some(
        (record) =>
          record.headerNames.includes('x-api-key') && record.keyMatched
      )
    ).toBe(true);
    assertSensitiveValuesAbsent('LangGraph request evidence', records, [
      FIXTURE_KEY,
    ]);
    await assertOperationalPrivacy(page, endpoint, privacyChannels);
    await assertMemoryPrivacy(page);
  });

  test('rejects a wrong LangGraph key without retaining its value', async ({
    page,
    request,
  }, testInfo) => {
    await page.goto(`${LANGGRAPH_PATH}?mode=run`);
    await applyCustomTarget(
      page,
      'LangSmith',
      fixtureRuntimeUrl(testInfo, 'langgraph/success'),
      'test-key-deliberately-wrong'
    );
    await sendMessage(runtimeFrame(page, 'LangGraph Streaming'), 'Reject me');

    await expect(page.getByText('Unauthorized', { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    const records = (await (
      await request.get(fixtureRequestLogUrl(testInfo))
    ).json()) as Array<{
      origin: string | null;
      headerNames: string[];
      keyMatched: boolean;
    }>;
    expect(
      records.some(
        (record) =>
          record.headerNames.includes('x-api-key') && !record.keyMatched
      )
    ).toBe(true);
    assertSensitiveValuesAbsent('wrong-key request evidence', records, [
      'test-key-deliberately-wrong',
    ]);
  });

  for (const failure of ['unauthorized', 'forbidden'] as const) {
    test(`maps a real ${failure} response to Unauthorized without exposing its poison body`, async ({
      page,
    }, testInfo) => {
      const observed: string[] = [];
      page.on('console', (message) => observed.push(message.text()));
      page.on('pageerror', (error) => observed.push(error.message));
      await page.goto(`${LANGGRAPH_PATH}?mode=run`);
      await applyCustomTarget(
        page,
        'LangSmith',
        fixtureRuntimeUrl(testInfo, `langgraph/${failure}`),
        FIXTURE_KEY
      );
      await sendMessage(
        runtimeFrame(page, 'LangGraph Streaming'),
        'Fail safely'
      );

      await expect(page.getByText('Unauthorized', { exact: true })).toBeVisible(
        {
          timeout: 15_000,
        }
      );
      assertSensitiveValuesAbsent('failure browser logs', observed, [
        POISON_MARKER,
        FIXTURE_KEY,
      ]);
      await assertMemoryPrivacy(page);
    });
  }

  test('maps the real Chat Threads immediate refresh failure to Unauthorized', async ({
    page,
    request,
  }, testInfo) => {
    await page.goto(`${CHAT_THREADS_PATH}?mode=run`);
    const initialFrame = page.locator(
      'iframe[title="Chat Threads live example"]'
    );
    await expect(
      runtimeFrame(page, 'Chat Threads').getByText(
        'How can I help?',
        { exact: true }
      )
    ).toBeVisible({ timeout: 15_000 });
    await initialFrame.evaluate((element) =>
      element.setAttribute('data-shared-generation', 'true')
    );
    await applyCustomTarget(
      page,
      'LangSmith',
      fixtureRuntimeUrl(testInfo, 'langgraph/unauthorized'),
      FIXTURE_KEY
    );
    await expect(
      page.locator('iframe[data-shared-generation="true"]')
    ).toHaveCount(0);

    await expect
      .poll(async () => {
        const records = (await (
          await request.get(fixtureRequestLogUrl(testInfo))
        ).json()) as Array<{
          origin: string | null;
          headerNames: string[];
          keyMatched: boolean;
        }>;
        return records
          .map(
            (record) =>
              `${record.origin ?? 'none'}:${record.keyMatched}:${record.headerNames.join(',')}`
          )
          .join('|');
      }, { timeout: 15_000 })
      .toContain('http://localhost:4506:true:');

    await expect(page.getByText('Unauthorized', { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await assertMemoryPrivacy(page);
  });

  test('maps a real failed CORS preflight to Network blocked', async ({
    page,
  }, testInfo) => {
    await page.goto(`${AG_UI_PATH}?mode=run`);
    await applyCustomTarget(
      page,
      'AG-UI',
      fixtureRuntimeUrl(testInfo, 'ag-ui/cors')
    );
    await sendMessage(
      runtimeFrame(page, 'AG-UI Streaming'),
      'Block this request'
    );
    await expect(
      page.getByText('Network blocked', { exact: true })
    ).toBeVisible({
      timeout: 15_000,
    });
  });

  test('uses the synthetic bridge only for a transport handshake fault', async ({
    page,
  }) => {
    await page.route('http://localhost:4300/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        headers: { 'Referrer-Policy': 'origin' },
        body: renderRuntimeBridgeFrame('child-ready-loss'),
      });
    });
    await page.goto(`${LANGGRAPH_PATH}?mode=run`);
    await expect(
      page.getByText('Incompatible runtime', { exact: true })
    ).toBeVisible({
      timeout: 12_000,
    });
  });

  test('replaces the iframe generation and ignores a late response from the old target', async ({
    page,
  }, testInfo) => {
    await page.goto(`${AG_UI_PATH}?mode=run`);
    await applyCustomTarget(
      page,
      'AG-UI',
      fixtureRuntimeUrl(testInfo, 'ag-ui/delayed-unauthorized')
    );
    const firstFrame = page.locator(
      'iframe[title="AG-UI Streaming live example"]'
    );
    await firstFrame.evaluate((element) =>
      element.setAttribute('data-old-generation', 'true')
    );
    await sendMessage(
      runtimeFrame(page, 'AG-UI Streaming'),
      'Start old generation'
    );

    await applyCustomTarget(
      page,
      'AG-UI',
      fixtureRuntimeUrl(testInfo, 'ag-ui/success')
    );
    await expect(
      page.locator('iframe[data-old-generation="true"]')
    ).toHaveCount(0);
    await sendMessage(runtimeFrame(page, 'AG-UI Streaming'), 'Use replacement');
    await expect(
      runtimeFrame(page, 'AG-UI Streaming').getByText('Custom AG-UI success')
    ).toBeVisible();
    await page.waitForTimeout(2_200);
    await expect(page.getByText('Unauthorized', { exact: true })).toHaveCount(
      0
    );
  });

  test('keeps both adapter slots across in-shell navigation, supports explicit clear, then clears on reload', async ({
    page,
  }, testInfo) => {
    await page.goto(`${LANGGRAPH_PATH}?mode=run`);
    await applyCustomTarget(
      page,
      'LangSmith',
      fixtureRuntimeUrl(testInfo, 'langgraph/success'),
      FIXTURE_KEY
    );
    await page
      .getByRole('link', { name: 'AG-UI Streaming', exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`${AG_UI_PATH.replaceAll('/', '\\/')}`)
    );
    await applyCustomTarget(
      page,
      'AG-UI',
      fixtureRuntimeUrl(testInfo, 'ag-ui/success')
    );

    await page.goBack();
    await expect(page).toHaveURL(
      new RegExp(`${LANGGRAPH_PATH.replaceAll('/', '\\/')}`)
    );
    await openSettings(page);
    await expect(page.locator('[data-runtime-target-settings]')).toContainText(
      fixtureRuntimeUrl(testInfo, 'langgraph/success')
    );
    await page
      .locator('[data-runtime-target-settings]')
      .getByRole('button', { name: 'Use shared development' })
      .click();
    await expect(
      page.locator('[data-runtime-target-settings]')
    ).toHaveAttribute('data-runtime-target-kind', 'shared');
    await desktopControlPlane(page)
      .getByRole('button', { name: 'Settings', exact: true })
      .click();
    await page
      .getByRole('link', { name: 'AG-UI Streaming', exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`${AG_UI_PATH.replaceAll('/', '\\/')}`)
    );
    await openSettings(page);
    await expect(page.locator('[data-runtime-target-settings]')).toContainText(
      fixtureRuntimeUrl(testInfo, 'ag-ui/success')
    );
    await page.reload();
    await openSettings(page);
    await expect(
      page.locator('[data-runtime-target-settings]')
    ).toHaveAttribute('data-runtime-target-kind', 'shared');
    await expect(
      page.locator('[data-runtime-target-settings]')
    ).not.toContainText(FIXTURE_ORIGIN);
    await assertMemoryPrivacy(page);
  });

  test('clears a custom target after a full top-level navigation away and back', async ({
    page,
  }, testInfo) => {
    await page.goto(`${AG_UI_PATH}?mode=run`);
    await applyCustomTarget(
      page,
      'AG-UI',
      fixtureRuntimeUrl(testInfo, 'ag-ui/success')
    );

    await page.goto('http://localhost:4300/');
    await page.goto(`${AG_UI_PATH}?mode=run`);
    await openSettings(page);
    await expect(
      page.locator('[data-runtime-target-settings]')
    ).toHaveAttribute('data-runtime-target-kind', 'shared');
    await expect(
      page.locator('[data-runtime-target-settings]')
    ).not.toContainText(FIXTURE_ORIGIN);
    await assertMemoryPrivacy(page);
  });
});
