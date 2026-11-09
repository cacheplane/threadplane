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
    await expect(controls).toHaveCSS('opacity', '1');
    await expect(controls).toHaveCSS('pointer-events', 'auto');
    expect(await messageBounds(copy)).toEqual(copyBounds);
    expect(await writes()).toEqual([]);
    const stableControls = async () => {
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
