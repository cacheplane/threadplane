import { test } from './fixtures';
import { expect } from '@playwright/test';

test('installed React error notice observes classified failure and expires with the selection', async ({
  page,
  retainedConsumer,
}, testInfo) => {
  const { startProofServer, threadEnvelope } = await import(
    '../tooling/proof-server.mjs'
  );
  const { startCheckedServer } = await import('../tooling/retained-build.mjs');
  const envelope = threadEnvelope('a', 'Conversation A');
  const history = () => ({
    method: 'POST',
    path: '/api/threads/a/history',
    payload: { limit: 10 },
    body: [
      {
        values: { messages: [] },
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
    { method: 'GET', path: '/api/threads/a', body: envelope },
    history(),
    {
      method: 'POST',
      path: '/api/threads/a/runs/stream',
      events: [
        {
          event: 'error',
          data: { message: '<script>privateDiagnostic()</script>' },
        },
      ],
      assertPayload(payload: unknown) {
        expect(payload).toMatchObject({
          assistant_id: 'assistant',
          input: { messages: [{ type: 'human', content: 'Observe failure' }] },
        });
      },
    },
    { method: 'GET', path: '/api/threads/a', body: envelope },
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
    await page.goto(origin);
    await page
      .getByRole('button', { name: 'Conversation A', exact: true })
      .click();
    const input = page.getByLabel('Message', { exact: true });
    await input.fill('Observe failure');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const alert = page
      .getByRole('alert')
      .filter({ hasText: '<script>privateDiagnostic()</script>' });
    await expect(alert).toBeVisible();
    await expect(alert).toHaveText('<script>privateDiagnostic()</script>');
    await expect(alert.locator('script, img, a')).toHaveCount(0);
    await expect(alert.getByRole('button')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /^(Retry|Check status)$/ })
    ).toHaveCount(0);
    await expect(
      page.getByRole('status').filter({ hasText: 'The response failed.' })
    ).toBeVisible();
    await expect(input).toBeFocused();
    await page.setViewportSize({ width: 320, height: 720 });
    await page.locator('html').evaluate((element) => (element.dir = 'rtl'));
    await page.emulateMedia({ forcedColors: 'active' });
    await expect(alert).toBeVisible();
    expect(
      await alert.evaluate(
        (element) => element.scrollWidth <= element.clientWidth
      )
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath('error-narrow-rtl-forced-colors.png'),
    });
    await page.evaluate(() => {
      for (const style of document.querySelectorAll(
        'style, link[rel="stylesheet"]'
      ))
        style.remove();
    });
    await expect(alert).toBeVisible();
    await expect(alert).toHaveText('<script>privateDiagnostic()</script>');
    await page.screenshot({ path: testInfo.outputPath('error-no-css.png') });
    await page.evaluate(() => {
      const url = new URL(location.href);
      url.searchParams.delete('thread');
      history.pushState(null, '', url);
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(
      page.getByRole('heading', { name: 'A place for your next conversation.' })
    ).toBeVisible();
    await expect(alert).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Conversation A', exact: true })
      .click();
    await expect(
      page.getByText('This conversation has no messages yet.')
    ).toBeVisible();
    await expect(alert).toHaveCount(0);
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
