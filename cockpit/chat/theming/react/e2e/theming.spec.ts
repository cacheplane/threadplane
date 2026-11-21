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
    assistant_id?: string;
    thread_id?: string;
    if_exists?: string;
    input?: { messages: { id: string; content: string }[] };
  };
};
const expected = [
  [
    'Dark',
    'rgb(28, 28, 28)',
    'rgb(224, 224, 224)',
    'rgb(118, 118, 118)',
    'rgb(59, 130, 246)',
  ],
  [
    'Light',
    'rgb(255, 255, 255)',
    'rgb(26, 26, 26)',
    'rgb(133, 138, 148)',
    'rgb(37, 99, 235)',
  ],
  [
    'Ocean',
    'rgb(17, 27, 49)',
    'rgb(200, 214, 229)',
    'rgb(96, 123, 156)',
    'rgb(10, 189, 227)',
  ],
  [
    'Forest',
    'rgb(32, 52, 32)',
    'rgb(212, 230, 212)',
    'rgb(118, 144, 118)',
    'rgb(74, 222, 128)',
  ],
] as const;
const requests = async (request: APIRequestContext): Promise<Wire[]> =>
  (await request.get('/__requests')).json();
const control = async (request: APIRequestContext, path: string) =>
  expect((await request.post(path)).ok()).toBe(true);
async function submit(page: Page, text: string) {
  await page.getByLabel('Message', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}
test.beforeEach(async ({ request }) => {
  await control(request, '/__reset');
});
/**
 * Injected data, opted into only by the test that styles the Reasoning
 * region: langchain_openai's ChatOpenAI does not extract `reasoning_content`
 * from Chat Completions responses, so the real graph never surfaces reasoning
 * (scripts/react-cockpit/langgraph-proxy.mjs, /__inject/reasoning).
 */
const injectReasoning = async (request: APIRequestContext) =>
  expect(
    (await request.post('/__inject/reasoning', {
      data: { text: 'Considering the aviation question.' },
    })).ok()
  ).toBe(true);
test.afterEach(async ({ page, request }, info) => {
  // Every browser connection through the proxy closes and nothing stays held.
  // (No per-run graph child processes exist any more: the graph is `langgraph dev`.)
  await page.goto('about:blank');
  await expect
    .poll(async () => (await request.get('/__lifetime')).json())
    .toMatchObject({ activeStream: false, activeHistory: false, openResponses: 0 });
  for (const path of ['/__requests', '/__captures', '/__lifetime']) {
    const body = JSON.stringify(
      await (await request.get(path)).json(),
      null,
      2
    );
    await writeFile(info.outputPath(path.slice(3) + '.json'), body);
    await info.attach(path.slice(3) + '.json', {
      body,
      contentType: 'application/json',
    });
  }
});
for (const width of [1280, 390]) {
  test(`four actual palettes preserve draft, graph conversation and isolation at ${width}`, async ({
    page,
    request,
  }, info) => {
    await injectReasoning(request);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/chat/theming/react/');
    await expect(page.getByRole('status')).toHaveText('Ready.');
    await page.evaluate(() => {
      const sentinel = document.createElement('p');
      sentinel.id = 'outside-sentinel';
      sentinel.textContent = 'Outside chat';
      sentinel.style.cssText =
        'color:rgb(12, 34, 56);background:rgb(234, 235, 236);border:1px solid rgb(45, 67, 89)';
      document.body.append(sentinel);
      (window as unknown as { input: Element | null }).input =
        document.querySelector('textarea');
    });
    const rootBefore = await page.locator('html').evaluate((el) => ({
      style: el.getAttribute('style'),
      className: el.className,
    }));
    const outsideBefore = await page
      .locator('#outside-sentinel')
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return [s.color, s.backgroundColor, s.borderColor];
      });
    await page
      .getByLabel('Message', { exact: true })
      .fill('Exact unsent aviation draft  ✈');
    for (const [name, surface, text, border, accent] of expected) {
      await page.getByRole('button', { name, exact: true }).click();
      await expect(
        page.getByRole('button', { name, exact: true })
      ).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('main')).toHaveCSS('background-color', surface);
      await expect(page.locator('main')).toHaveCSS('color', text);
      await expect(
        page.getByRole('button', { name: 'New conversation' })
      ).toHaveCSS('border-top-color', border);
      await expect(page.getByRole('button', { name, exact: true })).toHaveCSS(
        'background-color',
        accent
      );
      await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
        'Exact unsent aviation draft  ✈'
      );
      expect(
        await page.evaluate(
          () =>
            document.querySelector('textarea') ===
            (window as unknown as { input: Element }).input
        )
      ).toBe(true);
      expect(await requests(request)).toEqual([]);
    }
    await submit(page, 'Explain lift ✈ café');
    await expect(page.getByRole('status')).toHaveText('Response saved.');
    const before = await requests(request);
    await page.getByRole('button', { name: 'Show reasoning' }).click();
    await expect(
      page.getByRole('region', { name: 'Reasoning', exact: true })
    ).toBeVisible();
    await page
      .getByLabel('Message', { exact: true })
      .fill('Retained follow-up draft');
    for (const [name, , text] of expected) {
      await page.getByRole('button', { name, exact: true }).click();
      await expect(
        page
          .locator(
            'article[aria-label="Assistant"] .theming-demo__message-body > div'
          )
          .last()
          .locator('p')
          .first()
      ).toHaveCSS('color', text);
      await expect(
        page
          .getByRole('region', { name: 'Reasoning', exact: true })
          .locator('p')
      ).toHaveCSS('color', text);
      await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
        'Retained follow-up draft'
      );
      expect(await requests(request)).toEqual(before);
      expect(
        await page.locator('html').evaluate((el) => ({
          style: el.getAttribute('style'),
          className: el.className,
        }))
      ).toEqual(rootBefore);
      expect(
        await page.locator('#outside-sentinel').evaluate((el) => {
          const s = getComputedStyle(el);
          return [s.color, s.backgroundColor, s.borderColor];
        })
      ).toEqual(outsideBefore);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`${width}-${name}.png`),
        fullPage: true,
      });
      await writeFile(
        info.outputPath(`${width}-${name}.html`),
        await page.content()
      );
    }
    await submit(page, 'Continue lift — aérodrome');
    await expect(page.getByRole('status')).toHaveText('Response saved.');
    await expect(page.locator('article')).toHaveCount(4);
    const wire = await requests(request),
      creates = wire.filter((r) => r.path.endsWith('/threads')),
      runs = wire.filter((r) => r.path.endsWith('/runs/stream'));
    expect(creates).toHaveLength(1);
    expect(creates[0].body.if_exists).toBe('raise');
    expect(runs).toHaveLength(2);
    expect(runs[0].path).toBe(runs[1].path);
    expect(runs[0].body.input?.messages[0].content).toBe('Explain lift ✈ café');
    expect(runs[1].body.input?.messages[0].content).toBe(
      'Continue lift — aérodrome'
    );
    expect(runs.every((r) => r.body.assistant_id === 'c-theming')).toBe(true);
    expect(wire.filter((r) => r.path.endsWith('/history'))).toHaveLength(2);
    const captures: {
      sse: string;
      savedMessages: { type: string; content: string }[];
      titleBefore: string | null;
      titleAfter: string | null;
    }[] = await (await request.get('/__captures')).json();
    expect(captures).toHaveLength(2);
    // The title model's reply (its own aimock fixture) never streams as answer
    // content. (It does appear in later runs' metadata: thread metadata.)
    const streamedContent = (sse: string) =>
      sse
        .split(/\r?\n\r?\n/)
        .filter((event) => /^event: messages/m.test(event))
        .map((event) => JSON.parse(event.split(/\r?\n/).find((l) => l.startsWith('data:'))!.slice(5))[0].content)
        .join('');
    for (const c of captures) {
      expect(streamedContent(c.sse)).toContain('upward force');
      expect(streamedContent(c.sse)).not.toContain('Aviation snippet title');
    }
    expect(
      captures[0].savedMessages.find((m) => m.type === 'human')?.content
    ).toBe('Explain lift ✈ café');
    expect(
      captures[1].savedMessages
        .filter((m) => m.type === 'human')
        .map((m) => m.content)
    ).toEqual(['Explain lift ✈ café', 'Continue lift — aérodrome']);
    // The title is written once, on the first turn, and kept on the second.
    expect(captures[0].titleBefore).toBeNull();
    expect(captures[0].titleAfter).toBe('Aviation snippet title');
    expect(captures[1].titleBefore).toBe('Aviation snippet title');
    expect(captures[1].titleAfter).toBe('Aviation snippet title');
    await page.getByRole('button', { name: 'New conversation' }).click();
    await expect(page.getByRole('status')).toHaveText('Ready.');
    await expect(page.locator('article')).toHaveCount(0);
    expect(await requests(request)).toEqual(wire);
    await info.attach('dom.html', {
      body: await page.content(),
      contentType: 'text/html',
    });
  });
  test(`palette changes during streaming and confirmation preserve ownership at ${width}`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await control(request, '/__hold/stream');
    await page.goto('/chat/theming/react/');
    await submit(page, 'Hello');
    await expect(page.getByRole('status')).toHaveText('Receiving response…');
    await page
      .getByLabel('Message', { exact: true })
      .fill('Draft during stream');
    const before = await requests(request);
    for (const [name] of expected) {
      await page.getByRole('button', { name, exact: true }).click();
      await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
        'Draft during stream'
      );
      expect(await requests(request)).toEqual(before);
    }
    await control(request, '/__history/hold');
    await control(request, '/__release');
    await expect(page.getByRole('status')).toHaveText(
      'Confirming saved response…'
    );
    const confirming = await requests(request);
    for (const [name] of expected) {
      await page.getByRole('button', { name, exact: true }).click();
      await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
        'Draft during stream'
      );
      expect(await requests(request)).toEqual(confirming);
    }
    await control(request, '/__release-history');
    await expect(page.getByRole('status')).toHaveText('Response saved.');
    expect(
      (await requests(request)).filter((r) => r.path.endsWith('/runs/stream'))
    ).toHaveLength(1);
  });
}
for (const phase of ['stream', 'history'])
  test(`Stop revokes a held ${phase} and New stays local`, async ({
    page,
    request,
  }) => {
    await control(request, phase === 'history' ? '/__history/hold' : '/__hold/stream');
    await page.goto('/chat/theming/react/');
    await submit(page, 'Hello');
    await expect(page.getByRole('status')).toHaveText(
      phase === 'stream' ? 'Receiving response…' : 'Confirming saved response…'
    );
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(
      'Stopped. Start a new conversation to continue.'
    );
    await control(
      request,
      phase === 'stream' ? '/__release' : '/__release-history'
    );
    await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
    const before = await requests(request);
    await page.getByRole('button', { name: 'New conversation' }).click();
    await expect(page.getByRole('status')).toHaveText('Ready.');
    expect(await requests(request)).toEqual(before);
  });
test('pagehide closes the original stream and remount never replays it', async ({
  page,
  request,
}) => {
  await control(request, '/__hold/stream');
  await page.goto('/chat/theming/react/');
  await submit(page, 'Hello');
  await expect(page.getByRole('status')).toHaveText('Receiving response…');
  await page.goto('about:blank');
  await expect
    .poll(
      async () =>
        (
          await (await request.get('/__lifetime')).json()
        ).activeStream
    )
    .toBe(false);
  const before = await requests(request);
  await page.goto('/chat/theming/react/');
  await expect(page.getByRole('status')).toHaveText('Ready.');
  await expect(page.locator('article')).toHaveCount(0);
  expect(await requests(request)).toEqual(before);
});
