import { test } from './fixtures';
import { expect } from '@playwright/test';

test('installed React waits for real first text, stays hidden through later tokens, and clears on Stop, error and selection replacement', async ({
  page,
  retainedConsumer,
}, testInfo) => {
  const { startProofServer, threadEnvelope } = await import(
    '../tooling/proof-server.mjs'
  );
  const { startCheckedServer } = await import('../tooling/retained-build.mjs');
  const row = threadEnvelope('a', 'Conversation A');
  const other = threadEnvelope('b', 'Conversation B');
  const history = (id: string) => ({
    method: 'POST',
    path: `/api/threads/${id}/history`,
    payload: { limit: 10 },
    body: [],
  });
  const run = (
    text: string,
    events: { event: string; data: unknown; hold?: boolean }[]
  ) => ({
    method: 'POST',
    path: '/api/threads/a/runs/stream',
    holdBody: true,
    events,
    assertPayload(payload: unknown) {
      expect(payload).toMatchObject({
        assistant_id: 'assistant',
        input: { messages: [{ type: 'human', content: text }] },
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
  });
  const backend = await startProofServer([
    {
      method: 'POST',
      path: '/api/threads/search',
      payload: { limit: 50, offset: 0 },
      body: [row, other],
    },
    { method: 'GET', path: '/api/threads/a', body: row },
    history('a'),
    run('First request', [
      {
        event: 'values',
        hold: true,
        data: {
          messages: [{ id: 'answer', type: 'ai', content: 'First text' }],
        },
      },
      {
        event: 'values',
        hold: true,
        data: {
          messages: [
            {
              id: 'answer',
              type: 'ai',
              content: 'First text and later tokens',
            },
          ],
        },
      },
    ]),
    run('Stop request', [
      {
        event: 'values',
        hold: true,
        data: {
          messages: [{ id: 'stopped', type: 'ai', content: 'Must not arrive' }],
        },
      },
    ]),
    run('Error request', [
      { event: 'error', hold: true, data: { message: 'Classified failure' } },
    ]),
    run('Replace request', [
      {
        event: 'values',
        hold: true,
        data: {
          messages: [
            { id: 'replaced', type: 'ai', content: 'Must not arrive' },
          ],
        },
      },
    ]),
    { method: 'GET', path: '/api/threads/b', body: other },
    history('b'),
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
      errors.push('Unexpected external request: ' + route.request().url());
      return route.abort();
    });
    await page.goto(origin);
    await page
      .getByRole('button', { name: 'Conversation A', exact: true })
      .click();
    const input = page.getByLabel('Message', { exact: true });
    const indicator = page.locator('.tp-typing-indicator');
    const submission = page.locator('.submission-status');
    const send = async (text: string, step: number) => {
      await input.fill(text);
      await input.press('Control+Enter');
      await backend.steps[step].received;
      await expect(indicator).toHaveText('Assistant is typing···');
      await expect(indicator).not.toHaveAttribute('role');
      await expect(indicator).not.toHaveAttribute('aria-live');
      await expect(indicator.locator('[aria-hidden="true"]')).toHaveCount(3);
      await expect(submission).toHaveAttribute('role', 'status');
      await expect(page.locator('.composer [role="status"]')).toHaveCount(1);
      await expect(input).toBeFocused();
    };
    await expect(indicator).toHaveCount(0);
    await send('First request', 3);
    await input.fill('Preserved draft');
    await page.setViewportSize({ width: 320, height: 720 });
    await page.locator('html').evaluate((element) => (element.dir = 'rtl'));
    await page.emulateMedia({
      forcedColors: 'active',
      reducedMotion: 'reduce',
    });
    await expect(indicator).toBeVisible();
    expect(
      await indicator.evaluate(
        (element) => element.scrollWidth <= element.clientWidth
      )
    ).toBe(true);
    expect(
      await indicator
        .locator('[aria-hidden="true"]')
        .evaluateAll((elements) =>
          elements.every(
            (element) => getComputedStyle(element).animationName === 'none'
          )
        )
    ).toBe(true);
    await indicator.screenshot({
      path: testInfo.outputPath(
        'typing-narrow-rtl-forced-colors-reduced-motion.png'
      ),
    });
    await page.evaluate(() => {
      for (const sheet of document.styleSheets) sheet.disabled = true;
    });
    await expect(
      indicator.getByText('Assistant is typing', { exact: true })
    ).toBeVisible();
    await expect(indicator).not.toHaveAttribute('aria-live');
    await indicator.screenshot({
      path: testInfo.outputPath('typing-no-css.png'),
    });
    await page.evaluate(() => {
      for (const sheet of document.styleSheets) sheet.disabled = false;
    });
    await page.emulateMedia({
      forcedColors: 'none',
      reducedMotion: 'no-preference',
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('html').evaluate((element) => (element.dir = 'ltr'));
    await expect(input).toBeFocused();
    backend.steps[3].events[0].release();
    await expect(page.getByText('First text', { exact: true })).toBeVisible();
    await expect(indicator).toHaveCount(0);
    await expect(input).toHaveValue('Preserved draft');
    await expect(input).toBeFocused();
    backend.steps[3].events[1].release();
    await expect(
      page.getByText('First text and later tokens', { exact: true })
    ).toBeVisible();
    await expect(indicator).toHaveCount(0);
    await expect(input).toHaveValue('Preserved draft');
    await expect(input).toBeFocused();
    backend.steps[3].releaseBody();
    await expect(submission).toHaveText('Response complete.');
    await send('Stop request', 4);
    await input.fill('Draft during wait');
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(indicator).toHaveCount(0);
    await expect(submission).toHaveText(
      'Response stopped locally. The server may still be running.'
    );
    expect((await backend.steps[4].closed).finished).toBe(false);
    await expect(input).toHaveValue('Draft during wait');
    await send('Error request', 5);
    backend.steps[5].events[0].release();
    backend.steps[5].releaseBody();
    await expect(page.getByRole('alert')).toContainText('Classified failure');
    await expect(indicator).toHaveCount(0);
    await expect(submission).toHaveText('The response failed.');
    await send('Replace request', 6);
    await page
      .getByRole('button', { name: 'Conversation B', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Conversation B', exact: true })
    ).toBeVisible();
    await expect(indicator).toHaveCount(0);
    expect((await backend.steps[6].closed).finished).toBe(false);
    await expect(
      page.getByText('Must not arrive', { exact: true })
    ).toHaveCount(0);
    backend.verify();
    for (const index of [0, 1, 2, 3, 5, 7, 8])
      expect((await backend.steps[index].closed).finished).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await server?.close();
    await backend.close();
  }
});
