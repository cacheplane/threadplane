import { test } from './fixtures';
import { expect, type Locator } from '@playwright/test';
import { applicationTools } from '../shared/trip-summary';

test('installed React latest action preserves a reader through real streaming and returns focus explicitly', async ({
  page,
  retainedConsumer,
}, testInfo) => {
  const { startProofServer, threadEnvelope } = await import(
    '../tooling/proof-server.mjs'
  );
  const { startCheckedServer } = await import('../tooling/retained-build.mjs');
  const rows = [
    threadEnvelope('a', 'Conversation A'),
    threadEnvelope('b', 'Conversation B'),
  ];
  const saved = Array.from({ length: 24 }, (_, i) => ({
    id: `saved-${i}`,
    type: 'ai',
    content: `Saved answer ${i}.\n\n${'A restored conversation needs room to read. '.repeat(
      16
    )}`,
  }));
  const history = (id: string) => ({
    method: 'POST',
    path: `/api/threads/${id}/history`,
    payload: { limit: 10 },
    body: [
      {
        values: { messages: saved },
        next: [],
        tasks: [],
        checkpoint: {
          thread_id: id,
          checkpoint_ns: '',
          checkpoint_id: 'saved',
        },
        parent_checkpoint: null,
        metadata: { source: 'input', step: 0, parents: {} },
        created_at: '2026-09-30T00:00:00.000Z',
      },
    ],
  });
  const backend = await startProofServer([
    {
      method: 'POST',
      path: '/api/threads/search',
      payload: { limit: 50, offset: 0 },
      body: rows,
    },
    { method: 'GET', path: '/api/threads/a', body: rows[0] },
    history('a'),
    {
      method: 'POST',
      path: '/api/threads/a/runs/stream',
      holdBody: true,
      events: [
        'First streamed answer',
        'First streamed answer and later text',
        'First streamed answer and later text followed at latest',
      ].map((content) => ({
        event: 'values',
        hold: true,
        data: {
          messages: [
            ...saved,
            {
              id: 'reply',
              type: 'ai',
              content:
                content + '\n\n' + 'Streaming grows this answer. '.repeat(50),
            },
          ],
        },
      })),
      assertPayload(payload: unknown) {
        const id = (payload as { input: { messages: { id: string }[] } }).input
          .messages[0].id;
        expect(id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        );
        expect(payload).toEqual({
          assistant_id: 'assistant',
          input: {
            messages: [{ type: 'human', id, content: 'Continue' }],
            client_tools: Object.entries(applicationTools).map(
              ([name, tool]) => ({
                name,
                description: tool.description,
                parameters: tool.parameters,
              })
            ),
          },
          stream_mode: [
            'values',
            'messages-tuple',
            'updates',
            'custom',
            'checkpoints',
          ],
          stream_subgraphs: true,
          stream_resumable: true,
          on_disconnect: 'continue',
        });
      },
    },
    { method: 'GET', path: '/api/threads/b', body: rows[1] },
    history('b'),
  ]);
  let server: Awaited<ReturnType<typeof startCheckedServer>> | undefined;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const geometry = (list: Locator) =>
    list.evaluate((el) => ({
      top: el.scrollTop,
      gap: el.scrollHeight - el.clientHeight - el.scrollTop,
      overflow: el.scrollHeight - el.clientHeight,
    }));
  const bottom = (list: Locator) =>
    expect.poll(async () => (await geometry(list)).gap).toBeLessThanOrEqual(1);
  const contained = async (button: Locator) => {
    const bounds = await button.boundingBox();
    expect(bounds).not.toBeNull();
    const viewport = page.viewportSize()!;
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(
      await button.evaluate((el) => el.scrollWidth <= el.clientWidth)
    ).toBe(true);
  };
  try {
    server = await startCheckedServer({
      retained: retainedConsumer,
      target: backend.origin + '/api',
    });
    const origin = server.url;
    await page.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === origin)
        return route.continue();
      errors.push('Unexpected external request: ' + route.request().url());
      return route.abort();
    });
    await page.goto(origin);
    await page
      .getByRole('button', { name: 'Conversation A', exact: true })
      .click();
    const list = page.getByRole('region', {
      name: 'Conversation messages',
      exact: true,
    });
    const input = page.getByLabel('Message', { exact: true });
    const completeUpwardScroll = async (
      action: () => Promise<void>,
      target?: number
    ) => {
      const start = (await geometry(list)).top;
      // Every call starts with real scrollable distance, so Home/wheel cannot
      // be a no-op. Ignore unrelated scrollend events until this gesture moved.
      expect(start).toBeGreaterThan(0);
      const completion = await list.evaluateHandle(
        (el, { start, target }) => {
          let release = () => {};
          const done = new Promise<void>((resolve) => {
            const end = () => {
              if (
                el.scrollTop < start &&
                (target === undefined || el.scrollTop === target)
              )
                resolve();
            };
            el.addEventListener('scrollend', end);
            release = () => el.removeEventListener('scrollend', end);
          });
          return { done, release };
        },
        { start, target }
      );
      try {
        await action();
        await completion.evaluate(({ done }) => done);
      } finally {
        try {
          await completion.evaluate(({ release }) => release());
        } finally {
          await completion.dispose();
        }
      }
    };
    await expect
      .poll(async () => (await geometry(list)).overflow)
      .toBeGreaterThan(1000);
    await bottom(list);
    await list.focus();
    await completeUpwardScroll(() => list.press('Home'), 0);
    await expect
      .poll(async () => (await geometry(list)).gap)
      .toBeGreaterThan(100);
    const idle = page.getByRole('button', {
      name: 'Scroll to latest',
      exact: true,
    });
    await expect(idle).toBeVisible();
    await expect(list).toBeFocused();
    await contained(idle);
    // Real keyboard activation; focus lands on the region before the button disappears.
    await idle.focus();
    await idle.press('Enter');
    await expect(idle).toHaveCount(0);
    await expect(list).toBeFocused();
    await bottom(list);
    await input.fill('Continue');
    await input.press('Control+Enter');
    await backend.steps[3].received;
    await input.fill('Preserved draft');
    await bottom(list);
    await list.hover();
    await completeUpwardScroll(() => page.mouse.wheel(0, -600));
    const streaming = page.getByRole('button', {
      name: 'Scroll to latest, response in progress',
      exact: true,
    });
    await expect(streaming).toBeVisible();
    await expect(input).toBeFocused();
    const before = (await geometry(list)).top;
    backend.steps[3].events[0].release();
    await expect(list).toContainText('First streamed answer');
    backend.steps[3].events[1].release();
    await expect(list).toContainText('and later text');
    expect((await geometry(list)).top).toBe(before);
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('Preserved draft');
    await page.setViewportSize({ width: 320, height: 720 });
    await page.locator('html').evaluate((el) => {
      el.dir = 'rtl';
    });
    await page.emulateMedia({
      forcedColors: 'active',
      reducedMotion: 'reduce',
    });
    await contained(streaming);
    expect(
      await streaming
        .locator('.tp-scroll-bubble__dots > span')
        .evaluateAll((dots) =>
          dots.every((dot) => getComputedStyle(dot).animationName === 'none')
        )
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath('scroll-bubble-narrow-rtl-forced-colors.png'),
    });
    await completeUpwardScroll(() => list.press('Home'), 0);
    const mountedControl = await streaming.elementHandle();
    // Keep only the measured scroll viewport meaningful when removing all skin
    // styles. This is the real region and the same mounted conditional button.
    const regionLayout = await list.evaluate((el) => {
      const overflow = getComputedStyle(el);
      return {
        style: el.getAttribute('style'),
        width: el.clientWidth,
        height: el.clientHeight,
        overflowX: overflow.overflowX,
        overflowY: overflow.overflowY,
      };
    });
    const sheetStates = await page.evaluateHandle(() =>
      [...document.styleSheets].map((sheet) => ({
        sheet,
        disabled: sheet.disabled,
      }))
    );
    try {
      await list.evaluate((el, layout) => {
        el.style.inlineSize = `${layout.width}px`;
        el.style.blockSize = `${layout.height}px`;
        el.style.overflowX = layout.overflowX;
        el.style.overflowY = layout.overflowY;
      }, regionLayout);
      await sheetStates.evaluate((entries) => {
        for (const { sheet } of entries) sheet.disabled = true;
      });
      await expect
        .poll(async () => (await geometry(list)).overflow)
        .toBeGreaterThan(1000);
      await expect
        .poll(async () => (await geometry(list)).gap)
        .toBeGreaterThan(32);
      expect(await mountedControl!.evaluate((el) => el.isConnected)).toBe(true);
      await streaming.scrollIntoViewIfNeeded();
      await expect(
        streaming.getByText('Scroll to latest', { exact: true })
      ).toBeVisible();
      const unstyledBounds = await streaming.boundingBox();
      expect(unstyledBounds).not.toBeNull();
      expect(unstyledBounds!.x).toBeGreaterThanOrEqual(0);
      expect(unstyledBounds!.y).toBeGreaterThanOrEqual(0);
      expect(unstyledBounds!.x + unstyledBounds!.width).toBeLessThanOrEqual(
        page.viewportSize()!.width
      );
      expect(unstyledBounds!.y + unstyledBounds!.height).toBeLessThanOrEqual(
        page.viewportSize()!.height
      );
      await streaming.screenshot({
        path: testInfo.outputPath('scroll-bubble-no-css.png'),
      });
    } finally {
      try {
        await sheetStates.evaluate((entries) => {
          for (const { sheet, disabled } of entries) sheet.disabled = disabled;
        });
      } finally {
        try {
          await list.evaluate((el, original) => {
            if (original === null) el.removeAttribute('style');
            else el.setAttribute('style', original);
          }, regionLayout.style);
        } finally {
          await sheetStates.dispose();
        }
      }
    }
    await contained(streaming);
    await streaming.click();
    await expect(list).toBeFocused();
    await bottom(list);
    backend.steps[3].events[2].release();
    await expect(list).toContainText('followed at latest');
    await bottom(list);
    await expect(list).toBeFocused();
    backend.steps[3].releaseBody();
    expect((await backend.steps[3].closed).finished).toBe(true);
    await expect(page.locator('.submission-status')).toHaveText(
      'Response complete.'
    );
    await expect(input).toHaveValue('Preserved draft');
    await bottom(list);
    await completeUpwardScroll(() => list.press('Home'), 0);
    await expect(idle).toBeVisible();
    const oldButton = await idle.elementHandle();
    const oldList = await list.elementHandle();
    await page
      .getByRole('button', { name: 'Conversation B', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Conversation B', exact: true })
    ).toBeVisible();
    expect(await oldList!.evaluate((el) => el.isConnected)).toBe(false);
    await oldButton!.evaluate((el) => (el as HTMLButtonElement).click());
    await bottom(list);
    await expect(idle).toHaveCount(0);
    backend.verify();
    for (const step of backend.steps)
      expect((await step.closed).finished).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await server?.close();
    await backend.close();
  }
});
