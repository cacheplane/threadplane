import { expect, test } from '@playwright/test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('installed React message actions copy only explicit answer text without conversation commands', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const { buildConsumer } = await import('../tooling/consumer.mjs');
  const { startProofServer, threadEnvelope } = await import(
    '../tooling/proof-server.mjs'
  );
  const { captureRetainedBuild, readRetainedBuild, startCheckedServer } =
    await import('../tooling/retained-build.mjs');
  const work = realpathSync(
    mkdtempSync(join(tmpdir(), 'native-message-actions-'))
  );
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
    await buildConsumer({
      root: resolve(__dirname, '../../../../'),
      assistantId: 'assistant',
      output: join(work, 'production'),
      capture: (context: unknown) =>
        captureRetainedBuild(join(work, 'retained'), context),
    });
    server = await startCheckedServer({
      retained: readRetainedBuild(join(work, 'retained')),
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
    await copy.focus();
    await page.keyboard.press('Enter');
    await expect(copy).toBeDisabled();
    await copy.evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    expect(await writes()).toEqual([answer]);
    await settle(true);
    await expect(
      list.getByText('Answer copied.', { exact: true })
    ).toBeVisible();
    await expect(copy).toBeEnabled();
    await expect(draft).toHaveValue('Preserved draft');
    await expect(
      page.getByRole('heading', { name: 'Conversation A', exact: true })
    ).toBeVisible();
    await copy.focus();
    await page.keyboard.press('Space');
    await expect(copy).toBeDisabled();
    await settle(false);
    await expect(
      list.getByText('Could not copy answer.', { exact: true })
    ).toBeVisible();
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
    rmSync(work, { recursive: true, force: true });
  }
});
