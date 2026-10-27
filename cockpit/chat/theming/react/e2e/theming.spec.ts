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
test.afterEach(async ({ page, request }, info) => {
  await page.goto('about:blank');
  await expect
    .poll(async () => (await (await request.get('/__lifetime')).json()).active)
    .toEqual({ children: 0, streams: 0, histories: 0, handlers: 0 });
  await expect
    .poll(
      async () => (await (await request.get('/__lifetime')).json()).responseOpen
    )
    .toBe(0);
  const lifetime = await (await request.get('/__lifetime')).json();
  for (const child of lifetime.children) {
    expect(child.reaped).toBe(true);
    expect(() => process.kill(child.pid, 0)).toThrow(/ESRCH/);
    expect(() => process.kill(-child.pgid, 0)).toThrow(/ESRCH/);
  }
  await writeFile(
    info.outputPath('observed-child-absence.json'),
    JSON.stringify(
      { children: lifetime.children, observedPidAndPgidAbsence: 'ESRCH' },
      null,
      2
    )
  );
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
    const captures = await (await request.get('/__captures')).json();
    expect(captures).toHaveLength(2);
    for (const c of captures) {
      expect(c.proof).toMatchObject({
        actualCompiledGraph: true,
        networkConnectAttempts: 0,
        titleMessageCallbacks: 0,
      });
      expect(c.sse).not.toContain('Authored metadata title');
    }
    expect(
      captures[0].savedMessages.find(
        (m: { type: string }) => m.type === 'human'
      ).content
    ).toBe('Explain lift ✈ café');
    expect(
      captures[1].savedMessages
        .filter((m: { type: string }) => m.type === 'human')
        .map((m: { content: string }) => m.content)
    ).toEqual(['Explain lift ✈ café', 'Continue lift — aérodrome']);
    expect(captures[0].titleUpdates).toHaveLength(1);
    expect(captures[1].titleUpdates).toHaveLength(0);
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
    await page.goto('/chat/theming/react/');
    await submit(page, 'Hold');
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
    if (phase === 'history') await control(request, '/__history/hold');
    await page.goto('/chat/theming/react/');
    await submit(page, phase === 'stream' ? 'Hold' : 'Explain lift');
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
  await page.goto('/chat/theming/react/');
  await submit(page, 'Hold');
  await expect(page.getByRole('status')).toHaveText('Receiving response…');
  await page.goto('about:blank');
  await expect
    .poll(
      async () =>
        (
          await (await request.get('/__lifetime')).json()
        ).active.streams
    )
    .toBe(0);
  const before = await requests(request);
  await page.goto('/chat/theming/react/');
  await expect(page.getByRole('status')).toHaveText('Ready.');
  await expect(page.locator('article')).toHaveCount(0);
  expect(await requests(request)).toEqual(before);
});
