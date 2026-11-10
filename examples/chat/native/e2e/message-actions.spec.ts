import { test } from './fixtures';
import { expect, type Locator } from '@playwright/test';

test('installed React message actions copy only explicit answer text without conversation commands', async ({
  page,
  retainedConsumer,
}) => {
  test.setTimeout(300_000);
  const { startProofServer, threadEnvelope } = await import(
    '../tooling/proof-server.mjs'
  );
  const { startCheckedServer } = await import('../tooling/retained-build.mjs');
  const answer =
    '**Exact answer**\n\n<script>literal()</script>\n\n[Link](https://example.com)';
  const saved = [
    {
      id: 'answer',
      type: 'ai',
      content: answer,
      reasoning: 'Private reasoning excluded from copy',
    },
    { id: 'question', type: 'human', content: 'Saved question' },
    { id: 'empty', type: 'ai', content: '', reasoning: 'Reasoning only' },
  ];
  const envelope = threadEnvelope('a', 'Conversation A');
  const lookup = () => ({
    method: 'GET',
    path: '/api/threads/a',
    body: envelope,
  });
  const history = () => ({
    method: 'POST',
    path: '/api/threads/a/history',
    payload: { limit: 10 },
    body: [
      {
        values: { messages: saved },
        next: [],
        tasks: [],
        checkpoint: {
          thread_id: 'a',
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
      body: [envelope],
    },
    lookup(),
    history(),
    lookup(),
    history(),
  ]);
  let server: Awaited<ReturnType<typeof startCheckedServer>> | undefined;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    server = await startCheckedServer({
      retained: retainedConsumer,
      target: backend.origin + '/api',
    });
    const origin = server.url;
    await page.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === origin)
        return route.continue();
      errors.push(`Unexpected external request: ${route.request().url()}`);
      return route.abort();
    });
    // The test owns every write. Never access the operating system clipboard.
    await page.addInitScript(() => {
      const control = {
        writes: [] as string[],
        resolve: () => {},
        reject: () => {},
      };
      Object.defineProperty(window, 'copyProof', { value: control });
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (text: string) => {
            control.writes.push(text);
            return new Promise<void>((resolve, reject) => {
              control.resolve = resolve;
              control.reject = () => reject(new Error('denied'));
            });
          },
        },
      });
    });
    const writes = () =>
      page.evaluate(
        () =>
          (window as unknown as { copyProof: { writes: string[] } }).copyProof
            .writes
      );
    const settle = (success: boolean) =>
      page.evaluate((success) => {
        const control = (
          window as unknown as {
            copyProof: { resolve: () => void; reject: () => void };
          }
        ).copyProof;
        success ? control.resolve() : control.reject();
      }, success);
    await page.goto(server.url);
    await page
      .getByRole('button', { name: 'Conversation A', exact: true })
      .click();
    const list = page.getByRole('region', {
      name: 'Conversation messages',
      exact: true,
    });
    const copy = list.getByRole('button', { name: 'Copy answer', exact: true });
    await expect(copy).toHaveCount(1);
    const compactCopy = async () => {
      await expect(copy).toHaveAccessibleName('Copy answer');
      await expect(copy).toHaveAttribute('title', 'Copy answer');
      await expect(copy).toHaveClass(/tp-message-actions__action--icon-only/);
      await expect(copy.locator('.tp-message-actions__label')).toHaveText(
        'Copy answer'
      );
      const icon = copy.locator('.tp-message-actions__icon');
      await expect(icon).toHaveAttribute('aria-hidden', 'true');
      const svg = icon.locator('svg');
      await expect(svg).toHaveAttribute('aria-hidden', 'true');
      await expect(svg).toHaveAttribute('focusable', 'false');
      await expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
      await expect(svg).toHaveAttribute('stroke', 'currentColor');
      await expect(svg.locator('rect')).toHaveAttribute('width', '11');
      await expect(svg.locator('path')).toHaveAttribute(
        'd',
        'M5 15V5a2 2 0 0 1 2-2h10'
      );
      const bounds = await copy.boundingBox();
      expect(bounds!.width).toBeGreaterThanOrEqual(36);
      expect(bounds!.height).toBeGreaterThanOrEqual(36);
      const glyph = await svg.boundingBox();
      expect(glyph!.width).toBe(16);
      expect(glyph!.height).toBe(16);
      await expect(copy.locator('.tp-message-actions__label')).toHaveCSS(
        'clip-path',
        'inset(50%)'
      );
    };
    await compactCopy();
    await expect(
      list.getByRole('group', { name: 'Message actions' })
    ).toHaveClass(/tp-message-actions/);
    expect(await writes()).toEqual([]);
    const draft = page.getByLabel('Message', { exact: true });
    await draft.fill('Preserved draft');
    const article = list
      .getByRole('article', {
        name: 'assistant message',
        exact: true,
      })
      .filter({
        has: page.getByRole('button', { name: 'Copy answer', exact: true }),
      });
    const controls = article.locator(':scope > .tp-chat-message__controls');
    await expect(article).not.toHaveAttribute('data-current', 'true');
    expect(
      await page.evaluate(
        () => matchMedia('(min-width: 769px) and (hover: hover)').matches
      )
    ).toBe(true);
    await page.mouse.move(0, 0);
    await expect(draft).toBeFocused();
    expect(
      await article.evaluate((el) => el.matches(':hover, :focus-within'))
    ).toBe(false);
    await expect(controls).toHaveCSS('opacity', '0');
    await expect(controls).toHaveCSS('pointer-events', 'none');
    const mountedControls = await controls.elementHandle();
    const mountedCopy = await copy.elementHandle();
    // Pointer/focus actions can scroll the transcript. With feedback unchanged,
    // reveal preserves intrinsic dimensions and offsets within the message.
    const messageBounds = (target: Locator) =>
      target.evaluate((el) => {
        const message = el.closest('article')!.getBoundingClientRect();
        const bounds = el.getBoundingClientRect();
        return {
          x: bounds.x - message.x,
          y: bounds.y - message.y,
          width: bounds.width,
          height: bounds.height,
        };
      });
    const restBounds = await messageBounds(controls);
    const copyBounds = await messageBounds(copy);
    await article.hover();
    await expect(controls).toHaveCSS('opacity', '1');
    await expect(controls).toHaveCSS('pointer-events', 'auto');
    expect(await messageBounds(controls)).toEqual(restBounds);
    expect(await messageBounds(copy)).toEqual(copyBounds);
    expect(await writes()).toEqual([]);
    await page.mouse.move(0, 0);
    await expect(controls).toHaveCSS('opacity', '0');
    await copy.focus();
    await expect(copy).toBeFocused();
    // Real keyboard traversal selects the browser's focus-visible modality.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(copy).toBeFocused();
    await expect(copy).toHaveCSS('outline-style', 'solid');
    await expect(copy).toHaveCSS('outline-width', '2px');
    await expect(copy).toHaveCSS('outline-offset', '3px');
    await expect(controls).toHaveCSS('opacity', '1');
    await expect(controls).toHaveCSS('pointer-events', 'auto');
    expect(await messageBounds(copy)).toEqual(copyBounds);
    expect(await writes()).toEqual([]);
    const stableControls = async () => {
      await compactCopy();
      expect(
        await controls.evaluate(
          (el, original) => el === original,
          mountedControls
        )
      ).toBe(true);
      expect(
        await copy.evaluate((el, original) => el === original, mountedCopy)
      ).toBe(true);
      await expect(controls).toHaveCSS('opacity', '1');
      await expect(controls).toHaveCSS('pointer-events', 'auto');
    };
    await page.keyboard.press('Enter');
    await expect(copy).toBeDisabled();
    await article.hover();
    await expect(
      list.getByText('Copying answer…', { exact: true })
    ).toBeVisible();
    await stableControls();
    await copy.evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    expect(await writes()).toEqual([answer]);
    await settle(true);
    // Disabled controls follow ordinary browser focus behavior. Re-reveal the
    // historical article to inspect the application's feedback when necessary.
    await article.hover();
    await expect(
      list.getByText('Answer copied.', { exact: true })
    ).toBeVisible();
    await expect(copy).toBeEnabled();
    await stableControls();
    await expect(draft).toHaveValue('Preserved draft');
    await expect(
      page.getByRole('heading', { name: 'Conversation A', exact: true })
    ).toBeVisible();
    await copy.focus();
    await page.keyboard.press('Space');
    await expect(copy).toBeDisabled();
    await stableControls();
    await settle(false);
    await article.hover();
    await expect(
      list.getByText('Could not copy answer.', { exact: true })
    ).toBeVisible();
    await stableControls();
    expect(await writes()).toEqual([answer, answer]);
    await copy.click();
    await expect(copy).toBeDisabled();
    // Remove the selected view while its explicitly admitted write is pending.
    await page.evaluate(() => {
      const url = new URL(location.href);
      url.searchParams.delete('thread');
      history.pushState(null, '', url);
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(copy).toHaveCount(0);
    await settle(true);
    await page
      .getByRole('button', { name: 'Conversation A', exact: true })
      .click();
    await expect(copy).toBeEnabled();
    await expect(list.getByText('Answer copied.', { exact: true })).toHaveCount(
      0
    );
    expect(await writes()).toEqual([answer, answer, answer]);
    await page.evaluate(() =>
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: undefined,
      })
    );
    await article.hover();
    await copy.click();
    await expect(
      list.getByText('Could not copy answer.', { exact: true })
    ).toBeVisible();
    expect(await writes()).toEqual([answer, answer, answer]);
    // Rating is application-owned page state: it writes nothing to the
    // clipboard and issues no conversation request.
    const rating = list.getByRole('group', {
      name: 'Rate answer (kept on this page only)',
      exact: true,
    });
    await expect(rating).toHaveCount(1);
    await draft.fill('Draft kept while rating');
    await expect(rating).toHaveAttribute('data-message-id', 'answer');
    const good = rating.getByRole('button', {
      name: 'Good answer',
      exact: true,
    });
    const poor = rating.getByRole('button', {
      name: 'Poor answer',
      exact: true,
    });
    await expect(good).toHaveAttribute('aria-pressed', 'false');
    await expect(poor).toHaveAttribute('aria-pressed', 'false');
    await good.click();
    await expect(good).toHaveAttribute('aria-pressed', 'true');
    await expect(poor).toHaveAttribute('aria-pressed', 'false');
    await poor.focus();
    await page.keyboard.press('Space');
    await expect(good).toHaveAttribute('aria-pressed', 'false');
    await expect(poor).toHaveAttribute('aria-pressed', 'true');
    await expect(poor).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(poor).toHaveAttribute('aria-pressed', 'false');
    await good.click();
    await expect(good).toHaveAttribute('aria-pressed', 'true');
    const ratingBounds = await good.boundingBox();
    expect(ratingBounds!.width).toBeGreaterThanOrEqual(36);
    expect(ratingBounds!.height).toBeGreaterThanOrEqual(36);
    await expect(draft).toHaveValue('Draft kept while rating');
    expect(await writes()).toEqual([answer, answer, answer]);
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
