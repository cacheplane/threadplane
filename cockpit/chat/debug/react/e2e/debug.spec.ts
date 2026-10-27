import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from '@playwright/test';
import { writeFile } from 'node:fs/promises';
type Wire = {
  path: string;
  method: string;
  body: {
    checkpoint?: Checkpoint;
    assistant_id?: string;
    input?: { messages: { content: string }[] };
  };
};
type Checkpoint = {
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
};
type State = {
  checkpoint: Checkpoint;
  values: {
    messages?: { id: string; content: string; type: string }[];
    analysis?: { characters: number; words: number };
    [key: string]: unknown;
  };
};
const base = '/chat/debug/react/';
const diagnostics = new WeakMap<
  Page,
  { errors: string[]; warnings: string[] }
>();
const wire = async (request: APIRequestContext): Promise<Wire[]> =>
  (await request.get('/__requests')).json();
const read = async (request: APIRequestContext, path: string) =>
  (await request.get(path)).json();
const control = async (request: APIRequestContext, path: string) =>
  expect((await request.post(path)).ok()).toBe(true);
const mainStatus = (page: Page) =>
  page.locator('main > p[role="status"]:not([aria-label])');
async function send(page: Page, text = 'Explain lift ✈ café') {
  await page.getByLabel('Message', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}
async function ready(page: Page) {
  await page.goto(base);
  await expect(mainStatus(page)).toHaveText('Ready.');
}
async function confirmed(page: Page) {
  await expect(mainStatus(page)).toHaveText('Response confirmed.');
}
async function open(page: Page) {
  await page
    .getByRole('button', { name: 'Open debug panel', exact: true })
    .click();
}
async function refresh(page: Page): Promise<State[]> {
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/history') && r.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Refresh checkpoints' }).click();
  const rows = await (await response).json();
  await confirmed(page);
  return rows;
}
async function inspect(page: Page, index: number) {
  await page.getByRole('tab', { name: 'Timeline' }).click();
  const response = page.waitForResponse((r) =>
    r.url().endsWith('/state/checkpoint')
  );
  await page
    .getByRole('button', { name: /^Inspect / })
    .nth(index)
    .click();
  const state: State = await (await response).json();
  await confirmed(page);
  await page.getByRole('tab', { name: 'State', exact: true }).click();
  return state;
}
test.beforeEach(async ({ request, page }) => {
  await control(request, '/__reset');
  const messages = { errors: [] as string[], warnings: [] as string[] };
  diagnostics.set(page, messages);
  page.on('console', (entry) => {
    if (entry.type() === 'error') messages.errors.push(entry.text());
    if (entry.type() === 'warning') messages.warnings.push(entry.text());
  });
  page.on('pageerror', (error) => {
    throw error;
  });
});
test.afterEach(async ({ page, request }, info) => {
  // Capture business evidence before reset erases the local ledger.
  for (const path of ['/__requests', '/__captures'])
    await writeFile(
      info.outputPath(path.slice(3) + '.json'),
      JSON.stringify(await read(request, path), null, 2)
    );
  await page.goto('about:blank');
  await control(request, '/__release');
  await control(request, '/__reset');
  await expect
    .poll(async () => (await read(request, '/__lifetime')).active)
    .toEqual({ children: 0, streams: 0, reads: 0, handlers: 0, responses: 0 });
  const lifetime = await read(request, '/__lifetime');
  for (const child of lifetime.children) {
    expect(child.reaped).toBe(true);
    for (const id of [child.pid, -child.pgid]) {
      let code;
      try {
        process.kill(id, 0);
      } catch (error) {
        code = (error as NodeJS.ErrnoException).code;
      }
      expect(code).toBe('ESRCH');
    }
  }
  await writeFile(
    info.outputPath('observed-child-absence.json'),
    JSON.stringify(lifetime, null, 2)
  );
  await writeFile(
    info.outputPath('browser-diagnostics.json'),
    JSON.stringify(diagnostics.get(page), null, 2)
  );
  expect(diagnostics.get(page)?.errors).toEqual([]);
});

for (const width of [1280, 390])
  test(`native graph, exact checkpoints and independent panel at ${width}`, async ({
    page,
    request,
    context,
  }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await ready(page);
    expect(await wire(request)).toEqual([]);
    await send(page);
    await confirmed(page);
    await expect(page.locator('article')).toHaveCount(4);
    const first = await page.locator('article').allTextContents();
    const captures = await read(request, '/__captures');
    const a = captures[0].state.values.messages[1].content;
    expect(captures[0].state.values.analysis).toEqual({
      characters: [...a].length,
      words: a.split(' ').length,
    });
    expect(captures[0].proof).toMatchObject({
      actualCompiledGraph: true,
      networkAttempts: 0,
      providerVariant: 'natural',
    });
    expect(captures[0].localCapturedReplay).toBe(true);
    await expect(
      page.getByLabel('Observed analysis', { exact: true })
    ).toContainText(`${[...a].length} characters`);
    await page
      .getByLabel('Message', { exact: true })
      .fill('Retained unsent draft ✈  café');
    await page.evaluate(() => {
      (window as unknown as { debugInput: Element | null }).debugInput =
        document.querySelector('textarea');
    });
    const before = await wire(request);
    await open(page);
    for (const dock of ['left', 'right', 'bottom']) {
      await page.getByRole('button', { name: 'Dock ' + dock }).click();
      await expect(page.locator('.tp-debug__panel')).toHaveAttribute(
        'data-dock',
        dock
      );
    }
    const stateTab = page.getByRole('tab', { name: 'State', exact: true });
    await stateTab.focus();
    await stateTab.press('End');
    await expect(page.getByRole('tab', { name: 'Timeline' })).toBeFocused();
    await page.getByRole('tab', { name: 'Timeline' }).press('Home');
    await expect(stateTab).toBeFocused();
    await stateTab.press('Escape');
    await expect(
      page.getByRole('button', { name: 'Open debug panel' })
    ).toBeFocused();
    await open(page);
    expect(await wire(request)).toEqual(before);
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
      'Retained unsent draft ✈  café'
    );
    expect(
      await page.evaluate(
        () =>
          document.querySelector('textarea') ===
          (window as unknown as { debugInput: Element }).debugInput
      )
    ).toBe(true);
    await page
      .getByRole('button', { name: 'Copy displayed current state' })
      .click();
    const displayed = await page
      .locator('.tp-debug__value pre')
      .first()
      .textContent();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      displayed
    );
    expect(JSON.parse(displayed ?? '{}')).toEqual({
      analysis: captures[0].state.values.analysis,
    });
    const history = await refresh(page);
    const afterRefresh = await wire(request);
    expect(
      afterRefresh
        .slice(before.length)
        .map((r) => [r.method, r.path.split('/').at(-1)])
    ).toEqual([['POST', 'history']]);
    const missingIndex = history.findIndex(
      (row) =>
        row.values.analysis === undefined &&
        Object.hasOwn(row.values, 'messages')
    );
    expect(missingIndex).toBeGreaterThanOrEqual(0);
    const observedEarly = await inspect(page, missingIndex);
    expect(observedEarly.checkpoint).toEqual(history[missingIndex].checkpoint);
    expect(observedEarly.values.analysis).toBeUndefined();
    const selected = page.getByRole('region', {
      name: 'Selected checkpoint',
      exact: true,
    });
    await selected
      .getByText('Displayed checkpoint values', { exact: true })
      .click();
    await expect(selected.locator('pre')).toHaveText('{}');
    const laterIndex = history.findIndex(
      (row) =>
        row.values.analysis !== undefined &&
        (row.values.messages?.length ?? 0) <
          captures[0].state.values.messages.length &&
        row.checkpoint.checkpoint_id !==
          captures[0].state.checkpoint.checkpoint_id
    );
    expect(laterIndex).toBeGreaterThanOrEqual(0);
    const observedLater = await inspect(page, laterIndex);
    expect(observedLater.checkpoint).toEqual(history[laterIndex].checkpoint);
    expect(observedLater.checkpoint.checkpoint_id).not.toBe(
      captures[0].state.checkpoint.checkpoint_id
    );
    expect(observedLater.values.analysis).toEqual(
      captures[0].state.values.analysis
    );
    expect(observedLater.values).not.toEqual(captures[0].state.values);
    await selected
      .getByText('Displayed checkpoint values', { exact: true })
      .click();
    await expect(selected.locator('pre')).toContainText('analysis');
    await writeFile(
      info.outputPath('observed-checkpoints.json'),
      JSON.stringify({ history, observedEarly, observedLater }, null, 2)
    );
    await page.screenshot({
      path: info.outputPath(`${width}-checkpoints.png`),
      fullPage: true,
    });
    // Author a local token override to test inheritance; it is not a graph field or palette feature.
    await page.locator('main').evaluate((el) => {
      el.style.setProperty('--tp-chat-text', 'rgb(20, 40, 60)');
      el.style.setProperty('--tp-chat-surface', 'rgb(240, 242, 244)');
    });
    await expect(page.locator('.tp-debug__panel')).toHaveCSS(
      'color',
      'rgb(20, 40, 60)'
    );
    await expect(page.locator('.tp-debug__panel')).toHaveCSS(
      'background-color',
      'rgb(240, 242, 244)'
    );
    const prior = await wire(request);
    await page
      .getByRole('button', { name: 'Close debug panel', exact: true })
      .click();
    await send(page, 'Continue lift — aérodrome');
    await confirmed(page);
    await expect(page.locator('article')).toHaveCount(8);
    expect(
      (await page.locator('article').allTextContents()).slice(0, 4)
    ).toEqual(first);
    const final = await wire(request);
    expect(final.filter((r) => r.path.endsWith('/threads'))).toHaveLength(1);
    expect(final.filter((r) => r.path.endsWith('/runs/stream'))).toHaveLength(
      2
    );
    expect(final.filter((r) => r.path.endsWith('/history'))).toHaveLength(3);
    expect(
      final.filter((r) => r.path.endsWith('/state/checkpoint'))
    ).toHaveLength(4);
    expect(
      final
        .slice(prior.length)
        .filter((r) => r.path.endsWith('/runs/stream'))[0].body.assistant_id
    ).toBe('c-debug');
    await open(page);
    await page.screenshot({
      path: info.outputPath(`${width}-two-turns.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
    await page.reload();
    await expect(mainStatus(page)).toHaveText('Ready.');
    await expect(page.locator('.tp-debug__panel')).toHaveAttribute(
      'data-dock',
      'bottom'
    );
    await expect(stateTab).toHaveAttribute('aria-selected', 'true');
    expect(await wire(request)).toEqual(final);
  });

test('late old-context exact response cannot repopulate New conversation', async ({
  page,
  request,
}, info) => {
  await ready(page);
  await send(page);
  await confirmed(page);
  await open(page);
  await refresh(page);
  await page.getByRole('button', { name: 'Dock bottom' }).click();
  let captured: State | undefined,
    admit: () => void = () => undefined,
    release: () => void = () => undefined;
  const admitted = new Promise<void>((resolve) => {
    admit = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let settled: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    settled = resolve;
  });
  await page.route('**/state/checkpoint', async (route) => {
    try {
      const response = await route.fetch();
      captured = await response.json();
      admit();
      await released;
      await route.fulfill({ response, json: captured });
    } finally {
      settled();
    }
  });
  try {
    await page.getByRole('tab', { name: 'Timeline' }).click();
    await page
      .getByRole('button', { name: /^Inspect / })
      .nth(1)
      .click();
    await admitted;
    await expect(mainStatus(page)).toHaveText('Reading selected checkpoint…');
    await page
      .getByRole('button', { name: 'New conversation', exact: true })
      .click();
    await expect(mainStatus(page)).toHaveText('Ready.');
    release();
    await done;
    // New is an outside pointer action, which intentionally closes this panel.
    await open(page);
    await page.getByRole('tab', { name: 'State', exact: true }).click();
    await expect(
      page.getByRole('region', { name: 'Selected checkpoint' })
    ).toHaveCount(0);
    await expect(page.locator('article')).toHaveCount(0);
    await expect(
      page.getByLabel('Observed analysis', { exact: true })
    ).toHaveCount(0);
    expect(
      (await wire(request)).filter((r) => r.path.endsWith('/runs/stream'))
    ).toHaveLength(1);
    await writeFile(
      info.outputPath('late-response-evidence.json'),
      JSON.stringify(
        {
          label:
            'Actual old-context exact response delayed by browser transport gate',
          captured,
        },
        null,
        2
      )
    );
  } finally {
    release();
    await done;
  }
});

for (const action of ['Stop', 'New conversation', 'unmount'])
  test(`${action} revokes an actual held checkpoint read`, async ({
    page,
    request,
  }) => {
    await ready(page);
    await send(page);
    await confirmed(page);
    await open(page);
    const baseline = await wire(request);
    await control(request, '/__hold/history');
    await page.getByRole('button', { name: 'Refresh checkpoints' }).click();
    await expect
      .poll(async () => (await read(request, '/__lifetime')).active.reads)
      .toBe(1);
    if (action === 'New conversation')
      await page
        .getByRole('button', { name: 'Close debug panel', exact: true })
        .click();
    if (action === 'unmount') await page.goto('about:blank');
    else await page.getByRole('button', { name: action, exact: true }).click();
    await expect
      .poll(async () => (await read(request, '/__lifetime')).active.reads)
      .toBe(0);
    await control(request, '/__release');
    const ledger = await wire(request);
    expect(ledger.filter((r) => r.path.endsWith('/runs/stream'))).toHaveLength(
      1
    );
    expect(ledger.filter((r) => r.path.endsWith('/history'))).toHaveLength(
      baseline.filter((r) => r.path.endsWith('/history')).length + 1
    );
    if (action === 'New conversation') {
      await expect(mainStatus(page)).toHaveText('Ready.');
      await expect(page.locator('article')).toHaveCount(0);
    }
  });

for (const variant of ['wrong-thread', 'wrong-checkpoint', 'invalid-values'])
  test(`authored selected-read response ${variant} is rejected`, async ({
    page,
    request,
  }, info) => {
    await ready(page);
    await send(page);
    await confirmed(page);
    await open(page);
    await refresh(page);
    await page
      .getByLabel('Message', { exact: true })
      .fill('Available after rejected inspection');
    const transcript = await page.locator('article').allTextContents();
    const current = await page
      .locator('.tp-debug__value pre')
      .first()
      .textContent();
    let baseline: State | undefined;
    await page.route('**/state/checkpoint', async (route) => {
      const response = await route.fetch();
      const state: State = await response.json();
      baseline = structuredClone(state);
      if (variant === 'wrong-thread')
        state.checkpoint.thread_id = '00000000-0000-0000-0000-000000000000';
      else if (variant === 'wrong-checkpoint')
        state.checkpoint.checkpoint_id = 'authored-wrong-identity';
      else state.values = null as unknown as State['values'];
      await route.fulfill({ response, json: state });
    });
    await inspect(page, 1);
    const selected = page.getByRole('region', { name: 'Selected checkpoint' });
    await expect(selected).toContainText(
      variant === 'invalid-values'
        ? 'Checkpoint values are unavailable.'
        : 'Checkpoint inspection failed.'
    );
    await expect(
      selected.getByRole('button', { name: 'Copy displayed checkpoint values' })
    ).toHaveCount(0);
    expect(await page.locator('article').allTextContents()).toEqual(transcript);
    expect(
      await page.locator('.tp-debug__value pre').first().textContent()
    ).toBe(current);
    await expect(
      page.getByRole('button', { name: 'Send', exact: true })
    ).toBeEnabled();
    expect(
      (await wire(request)).filter((r) => r.path.endsWith('/runs/stream'))
    ).toHaveLength(1);
    await writeFile(
      info.outputPath('authored-response-variant.json'),
      JSON.stringify(
        {
          label:
            'Browser-authored selected response only; natural graph capture unchanged',
          variant,
          baseline,
        },
        null,
        2
      )
    );
  });

test('authored duplicate metadata rows are visible and uninspectable', async ({
  page,
  request,
}, info) => {
  await ready(page);
  await send(page);
  await confirmed(page);
  await open(page);
  const before = await wire(request);
  await page.route('**/history', async (route) => {
    const response = await route.fetch();
    const rows: State[] = await response.json();
    await route.fulfill({ response, json: [rows[1], rows[1]] });
  });
  await refresh(page);
  await page.getByRole('tab', { name: 'Timeline' }).click();
  const buttons = page.getByRole('button', { name: /^Inspect / });
  await expect(buttons).toHaveCount(2);
  await expect(buttons.nth(0)).toBeDisabled();
  await expect(buttons.nth(1)).toBeDisabled();
  expect(
    (await wire(request)).filter((r) => r.path.endsWith('/state/checkpoint'))
  ).toHaveLength(
    before.filter((r) => r.path.endsWith('/state/checkpoint')).length
  );
  await writeFile(
    info.outputPath('authored-response-variant.json'),
    JSON.stringify({
      label:
        'Browser-authored duplicate metadata response only; natural captures unchanged',
    })
  );
});

test('authored Unicode inspection projection copies exactly the bounded displayed text', async ({
  page,
  context,
}, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await ready(page);
  await send(page);
  await confirmed(page);
  await open(page);
  await refresh(page);
  const authored = Object.fromEntries(
    Array.from({ length: 50 }, (_, i) => [
      `field-${i}`,
      '✈ café 😀 '.repeat(70),
    ])
  );
  await page.route('**/state/checkpoint', async (route) => {
    const response = await route.fetch();
    const state: State = await response.json();
    await route.fulfill({ response, json: { ...state, values: authored } });
  });
  await inspect(page, 1);
  const selected = page.getByRole('region', { name: 'Selected checkpoint' });
  await expect(selected).toContainText('Display truncated.');
  await selected
    .getByText('Displayed checkpoint values', { exact: true })
    .click();
  const text = await selected.locator('pre').textContent();
  expect(() => JSON.parse(text ?? '')).not.toThrow();
  expect(Buffer.byteLength(text ?? '', 'utf8')).toBeLessThanOrEqual(32768);
  expect(text).toContain('✈ café 😀');
  await selected
    .getByRole('button', { name: 'Copy displayed checkpoint values' })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);
  await writeFile(
    info.outputPath('authored-response-variant.json'),
    JSON.stringify({
      label: 'Browser-authored Unicode projection; not a natural graph field',
      authoredBytes: Buffer.byteLength(JSON.stringify(authored)),
      displayedBytes: Buffer.byteLength(text ?? ''),
    })
  );
});

for (const action of ['Stop', 'New conversation', 'unmount'])
  test(`${action} releases an actual held captured SSE replay`, async ({
    page,
    request,
  }, info) => {
    await control(request, '/__hold/stream');
    await ready(page);
    await send(page);
    await expect
      .poll(async () => (await read(request, '/__lifetime')).active.streams)
      .toBe(1);
    await expect(mainStatus(page)).toHaveText('Receiving response…');
    await expect(page.locator('article')).toHaveCount(2);
    if (action === 'unmount') await page.goto('about:blank');
    else await page.getByRole('button', { name: action, exact: true }).click();
    await expect
      .poll(async () => (await read(request, '/__lifetime')).active.streams)
      .toBe(0);
    await control(request, '/__release');
    const ledger = await wire(request);
    expect(ledger.filter((r) => r.path.endsWith('/runs/stream'))).toHaveLength(
      1
    );
    expect(ledger.filter((r) => r.path.endsWith('/history'))).toHaveLength(0);
    await writeFile(
      info.outputPath('stream-milestone.json'),
      JSON.stringify(
        {
          label:
            'Captured actual graph SSE replay; compiled graph already completed before HTTP replay hold',
          action,
          ledger,
        },
        null,
        2
      )
    );
    if (action === 'New conversation') {
      await expect(mainStatus(page)).toHaveText('Ready.');
      await expect(page.locator('article')).toHaveCount(0);
    }
  });
