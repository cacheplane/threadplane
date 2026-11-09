import { test } from './fixtures';
import { expect, type Locator } from '@playwright/test';
import { applicationTools } from '../shared/trip-summary';

test('installed React ChatMessage preserves roles, direction, controls and reading through streamed growth', async ({
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
  const roleMessages = [
    {
      id: 'system',
      type: 'system',
      content: 'System instruction in plain text',
    },
    { id: 'user', type: 'human', content: 'مرحبا بالعالم' },
    {
      id: 'answer',
      type: 'ai',
      content: 'שלום עולם — mixed English',
      additional_kwargs: {
        citations: [
          {
            id: 'local',
            index: 1,
            title: 'Local source',
            snippet: 'Literal source context',
          },
        ],
      },
    },
    {
      id: 'tool',
      type: 'tool',
      tool_call_id: 'lookup',
      content: '<b>literal tool</b>\n' + 'long literal line '.repeat(30),
    },
  ];
  const saved = [
    ...roleMessages,
    ...Array.from({ length: 24 }, (_, i) => ({
      id: `saved-${i}`,
      type: 'ai',
      content: `Saved answer ${i}.\n\n${'A restored conversation needs room to read. '.repeat(
        16
      )}`,
    })),
  ];
  const submittedFrames = ['human', 'ai', 'human'].map((type) => ({
    id: '',
    type,
    content: 'Continue',
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
      ].map((content, index) => ({
        event: 'values',
        hold: true,
        data: {
          messages: [
            ...saved,
            submittedFrames[index],
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
        for (const message of submittedFrames) message.id = id;
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
    await page.addInitScript(() => {
      const writes: string[] = [];
      Object.defineProperty(window, 'messageCopyWrites', { value: writes });
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            writes.push(text);
          },
        },
      });
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
    const messages = list.locator('.tp-chat-message');
    await expect(messages).toHaveCount(saved.length);
    const roleNames = saved.map((message) =>
      message.type === 'ai'
        ? 'assistant'
        : message.type === 'human'
        ? 'user'
        : message.type
    );
    for (let index = 0; index < saved.length; index++) {
      if (index === 0)
        await expect(messages.nth(index)).not.toHaveAttribute('data-prev-role');
      else
        await expect(messages.nth(index)).toHaveAttribute(
          'data-prev-role',
          roleNames[index - 1]
        );
    }
    const marginInRem = (article: Locator) =>
      article.evaluate(
        (element) =>
          parseFloat(getComputedStyle(element).marginBlockStart) /
          parseFloat(getComputedStyle(document.documentElement).fontSize)
      );
    for (const role of ['system', 'user', 'assistant', 'tool']) {
      const articles = list.getByRole('article', {
        name: `${role} message`,
        exact: true,
      });
      await expect(articles).toHaveCount(role === 'assistant' ? 25 : 1);
      for (const article of await articles.all()) {
        await expect(
          article.locator(':scope > .tp-chat-message__body')
        ).toHaveAttribute('dir', 'auto');
        await expect(article.locator('h3.role-label')).toHaveCount(0);
        await expect(
          article.locator(':scope > .tp-chat-message__speaker')
        ).toHaveCount(role === 'user' || role === 'assistant' ? 1 : 0);
        await expect(
          article.locator(':scope > .tp-chat-message__controls')
        ).toHaveCount(role === 'assistant' ? 1 : 0);
      }
    }
    const user = list
      .getByRole('article', { name: 'user message', exact: true })
      .filter({
        has: page
          .locator('.tp-chat-message__body')
          .filter({ hasText: /^مرحبا بالعالم$/ }),
      });
    await expect(user).toHaveCount(1);
    expect(await marginInRem(user)).toBe(0.5);
    const answer = list
      .getByRole('article', { name: 'assistant message', exact: true })
      .first();
    const tool = list.getByRole('article', {
      name: 'tool message',
      exact: true,
    });
    await expect(user.locator('.tp-chat-message__speaker')).toHaveText('You:');
    await expect(answer.locator('.tp-chat-message__speaker')).toHaveText(
      'Assistant:'
    );
    const direction = (article: Locator) =>
      article
        .locator('.tp-chat-message__body > .tp-markdown')
        .evaluate((el) => getComputedStyle(el).direction);
    expect(await direction(user)).toBe('rtl');
    expect(await direction(answer)).toBe('rtl');
    const english = list.getByRole('article', {
      name: 'system message',
      exact: true,
    });
    expect(await direction(english)).toBe('ltr');
    const sources = answer.getByRole('region', {
      name: 'Sources',
      exact: true,
    });
    expect(
      await sources.evaluate((el) =>
        el.parentElement?.classList.contains('tp-chat-message')
      )
    ).toBe(true);
    await expect(sources).toHaveCSS('direction', 'ltr');
    await page.locator('html').evaluate((el) => {
      el.dir = 'rtl';
    });
    expect(await direction(user)).toBe('rtl');
    expect(await direction(answer)).toBe('rtl');
    expect(await direction(english)).toBe('ltr');
    await expect(sources).toHaveCSS('direction', 'rtl');
    const sourceToggle = sources.getByRole('button', {
      name: 'Sources (1)',
      exact: true,
    });
    await sourceToggle.click();
    await expect(sources.locator('.tp-citation-card')).toHaveCSS(
      'direction',
      'rtl'
    );
    await sources
      .getByRole('button', {
        name: 'Preview source 1: Local source',
        exact: true,
      })
      .click();
    const preview = page.getByRole('dialog', { name: 'Source 1', exact: true });
    await expect(preview).toHaveAttribute('dir', 'rtl');
    await preview.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(preview).toHaveCount(0);
    await sourceToggle.click();
    await page.locator('html').evaluate((el) => {
      el.dir = 'ltr';
    });
    await expect(sources).toHaveCSS('direction', 'ltr');
    expect(backend.requests).toHaveLength(3);
    await expect(tool.locator('pre')).toHaveText(roleMessages[3].content);
    await expect(tool.locator('b')).toHaveCount(0);
    expect(
      await tool.locator('pre').evaluate((el) => ({
        whiteSpace: getComputedStyle(el).whiteSpace,
        overflow: getComputedStyle(el).overflowX,
      }))
    ).toEqual({ whiteSpace: 'pre', overflow: 'auto' });
    const writes = () =>
      page.evaluate(
        () =>
          (window as unknown as { messageCopyWrites: string[] })
            .messageCopyWrites
      );
    expect(await writes()).toEqual([]);
    const copy = answer
      .locator('.tp-chat-message__controls')
      .getByRole('button', { name: 'Copy answer', exact: true });
    await copy.focus();
    await copy.press('Enter');
    await expect(answer.getByRole('status')).toHaveText('Answer copied.');
    expect(await writes()).toEqual([roleMessages[2].content]);
    await expect(answer.locator('.tp-chat-message__body button')).toHaveCount(
      0
    );
    await page.screenshot({
      path: testInfo.outputPath('message-presentation-roles.png'),
    });
    await list.focus();

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
    await expect(user).toHaveCount(1);
    await expect(
      list.getByRole('article', { name: 'user message', exact: true })
    ).toHaveCount(2);
    const submittedUser = list
      .getByRole('article', { name: 'user message', exact: true })
      .last();
    await expect(submittedUser).toHaveAttribute('data-prev-role', 'assistant');
    expect(await marginInRem(submittedUser)).toBe(1.5);
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
    const caret = list.locator('.tp-chat-message__caret');
    await expect(caret).toHaveCount(0);
    backend.steps[3].events[0].release();
    await expect(list).toContainText('First streamed answer');
    await expect(caret).toHaveCount(1);
    await expect(caret).toBeVisible();
    await expect(caret).toHaveAttribute('aria-hidden', 'true');
    await expect(caret).toHaveText('');
    await expect(caret.locator('..')).toHaveClass('tp-chat-message__body');
    await expect(caret.locator('../..')).toHaveAttribute(
      'data-current',
      'true'
    );
    await expect(caret.locator('../..')).toHaveAttribute(
      'data-streaming',
      'true'
    );
    await expect(caret).toHaveCSS('width', '8px');
    await expect(caret).toHaveCSS('height', '8px');
    await expect(caret.locator('../..')).toHaveAttribute(
      'data-prev-role',
      'user'
    );
    const currentAnswer = caret.locator('../..');
    const currentControls = currentAnswer.locator(
      ':scope > .tp-chat-message__controls'
    );
    const currentCopy = currentControls.getByRole('button', {
      name: 'Copy answer',
      exact: true,
    });
    await expect(currentControls).toHaveCSS('opacity', '1');
    await expect(currentControls).toHaveCSS('pointer-events', 'auto');
    await expect(currentCopy).toBeEnabled();
    const mountedCopy = await currentCopy.elementHandle();
    const stableCurrentCopy = async () => {
      expect(
        await currentCopy.evaluate(
          (el, original) => el === original,
          mountedCopy
        )
      ).toBe(true);
      await expect(currentControls).toHaveCSS('opacity', '1');
      await expect(currentControls).toHaveCSS('pointer-events', 'auto');
    };
    backend.steps[3].events[1].release();
    await expect(list).toContainText('and later text');
    await expect(caret.locator('../..')).toHaveAttribute(
      'data-prev-role',
      'assistant'
    );
    await stableCurrentCopy();
    expect(await writes()).toEqual([roleMessages[2].content]);
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
    await stableCurrentCopy();
    await expect(currentControls).toHaveCSS('transition-duration', '0s');
    const historicalControls = answer.locator(
      ':scope > .tp-chat-message__controls'
    );
    await expect(historicalControls).toHaveCSS('opacity', '1');
    await expect(historicalControls).toHaveCSS('pointer-events', 'auto');
    await expect(historicalControls).toHaveCSS('transition-duration', '0s');
    await expect(caret).toBeVisible();
    await expect(caret).toHaveCSS('animation-name', 'none');
    await expect(caret).toHaveCSS('opacity', '1');
    await expect(caret).toHaveCSS('background-image', 'none');
    await expect(caret).toHaveCSS('box-shadow', 'none');
    expect(
      await caret.evaluate((element) => {
        const probe = document.createElement('span');
        probe.style.color = 'CanvasText';
        element.parentElement!.append(probe);
        const matches =
          getComputedStyle(element).backgroundColor ===
          getComputedStyle(probe).color;
        probe.remove();
        return matches;
      })
    ).toBe(true);
    await contained(streaming);
    expect(await direction(user)).toBe('rtl');
    expect(await direction(answer)).toBe('rtl');
    expect(await direction(english)).toBe('ltr');
    await expect(sources).toHaveCSS('direction', 'rtl');
    expect(
      await tool
        .locator('.tp-chat-message__body')
        .evaluate((el) => getComputedStyle(el).direction)
    ).toBe('ltr');
    expect(
      await streaming
        .locator('.tp-scroll-bubble__dots > span')
        .evaluateAll((dots) =>
          dots.every((dot) => getComputedStyle(dot).animationName === 'none')
        )
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(
        'message-presentation-narrow-rtl-forced-colors.png'
      ),
    });
    await completeUpwardScroll(() => list.press('Home'), 0);
    const mountedControl = await streaming.elementHandle();
    for (const article of [user, answer, tool]) {
      await article.scrollIntoViewIfNeeded();
      const bounds = await article.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
      expect(
        await article
          .locator('.tp-chat-message__body')
          .evaluate((el) => el.clientWidth > 0)
      ).toBe(true);
    }
    await user.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath('message-presentation-narrow-role-bodies.png'),
    });
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
      await expect(user.locator('.tp-chat-message__speaker')).toHaveText(
        'You:'
      );
      await expect(answer.locator('.tp-chat-message__speaker')).toHaveText(
        'Assistant:'
      );
      await expect(tool.locator('pre')).toHaveText(roleMessages[3].content);
      expect(await direction(user)).toBe('rtl');
      await user.scrollIntoViewIfNeeded();
      const bodyBounds = await user
        .locator('.tp-chat-message__body')
        .boundingBox();
      expect(bodyBounds!.width).toBeGreaterThan(0);
      expect(bodyBounds!.x).toBeGreaterThanOrEqual(0);
      expect(bodyBounds!.x + bodyBounds!.width).toBeLessThanOrEqual(320);
      expect(bodyBounds!.y).toBeGreaterThanOrEqual(0);
      expect(bodyBounds!.y + bodyBounds!.height).toBeLessThanOrEqual(
        page.viewportSize()!.height
      );
      await expect(user).toBeInViewport({ ratio: 1 });
      await expect(user.locator('.tp-chat-message__body')).toBeInViewport({
        ratio: 1,
      });
      const visibleBody = await user.evaluate((article) => {
        const body = article.querySelector('.tp-chat-message__body');
        const region = article.closest('.tp-chat-list');
        if (!body || !region)
          throw new Error('Message body and transcript required');
        const rect = (element: Element) => {
          const { left, top, right, bottom } = element.getBoundingClientRect();
          return { left, top, right, bottom };
        };
        const bodyRect = rect(body);
        const regionRect = rect(region);
        return {
          article: rect(article),
          body: bodyRect,
          clip: {
            left: Math.max(0, regionRect.left + region.clientLeft),
            top: Math.max(0, regionRect.top + region.clientTop),
            right: Math.min(
              innerWidth,
              regionRect.left + region.clientLeft + region.clientWidth
            ),
            bottom: Math.min(
              innerHeight,
              regionRect.top + region.clientTop + region.clientHeight
            ),
          },
          hitInsideBody: body.contains(
            document.elementFromPoint(
              (bodyRect.left + bodyRect.right) / 2,
              (bodyRect.top + bodyRect.bottom) / 2
            )
          ),
        };
      });
      for (const rect of [visibleBody.article, visibleBody.body]) {
        expect(rect.left).toBeGreaterThanOrEqual(visibleBody.clip.left);
        expect(rect.top).toBeGreaterThanOrEqual(visibleBody.clip.top);
        expect(rect.right).toBeLessThanOrEqual(visibleBody.clip.right);
        expect(rect.bottom).toBeLessThanOrEqual(visibleBody.clip.bottom);
      }
      expect(visibleBody.hitInsideBody).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath('message-presentation-no-css.png'),
      });
      await streaming.scrollIntoViewIfNeeded();
      await streaming.screenshot({
        path: testInfo.outputPath('message-presentation-controls-no-css.png'),
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
    await stableCurrentCopy();
    // The reader deliberately returned to latest before activating stream copy.
    await currentCopy.click();
    await expect(currentAnswer.getByRole('status')).toHaveText(
      'Answer copied.'
    );
    expect(await writes()).toEqual([
      roleMessages[2].content,
      'First streamed answer and later text followed at latest\n\n' +
        'Streaming grows this answer. '.repeat(50),
    ]);
    await stableCurrentCopy();
    await list.focus();
    backend.steps[3].releaseBody();
    expect((await backend.steps[3].closed).finished).toBe(true);
    await expect(page.locator('.submission-status')).toHaveText(
      'Response complete.'
    );
    await expect(caret).toHaveCount(0);
    // The caret disappears on completion; keep addressing the same article.
    expect(await mountedCopy!.evaluate((el) => el.isConnected)).toBe(true);
    const completedAnswer = list
      .getByRole('article', { name: 'assistant message', exact: true })
      .last();
    const completedCopy = completedAnswer.getByRole('button', {
      name: 'Copy answer',
      exact: true,
    });
    expect(
      await completedCopy.evaluate(
        (el, original) => el === original,
        mountedCopy
      )
    ).toBe(true);
    await expect(
      completedAnswer.locator(':scope > .tp-chat-message__controls')
    ).toHaveCSS('opacity', '1');
    await expect(
      completedAnswer.locator(':scope > .tp-chat-message__controls')
    ).toHaveCSS('pointer-events', 'auto');
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
