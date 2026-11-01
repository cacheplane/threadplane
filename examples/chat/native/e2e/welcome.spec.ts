import { test } from './fixtures';
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';

test('installed React welcome prefills explicitly and retains composer ownership through streaming and presentation changes', async ({
  page,
  retainedConsumer,
}, testInfo) => {
  const { startProofServer, threadEnvelope } = await import(
    '../tooling/proof-server.mjs'
  );
  const { startCheckedServer } = await import('../tooling/retained-build.mjs');
  const row = threadEnvelope('welcome', 'Empty welcome conversation');
  const key = 'threadplane-native-react-projects-v1';
  const raw = 'Help me understand a topic step by step.';
  const backend = await startProofServer([
    {
      method: 'POST',
      path: '/api/threads/search',
      payload: { limit: 50, offset: 0 },
      body: [row],
    },
    { method: 'GET', path: '/api/threads/welcome', body: row },
    {
      method: 'POST',
      path: '/api/threads/welcome/history',
      payload: { limit: 10 },
      holdBody: true,
      body: [],
    },
    {
      method: 'POST',
      path: '/api/threads/welcome/runs/stream',
      holdBody: true,
      events: [
        {
          event: 'values',
          data: {
            messages: [
              { id: 'answer', type: 'ai', content: 'Start with one question.' },
            ],
          },
        },
      ],
      assertPayload(value: unknown) {
        const payload = value as { input: { messages: { id: string }[] } };
        const id = payload.input.messages[0].id;
        assert.match(
          id,
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        );
        assert.deepEqual(payload, {
          assistant_id: 'assistant',
          input: {
            messages: [{ id, type: 'human', content: raw }],
            client_tools: [
              {
                name: 'show_trip_summary',
                description:
                  'Show a supplied trip recap with days and places. This terminal summary needs no follow-up; it does not plan or change an itinerary.',
                parameters: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    days: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          day: { type: 'integer', minimum: 1 },
                          places: { type: 'array', items: { type: 'string' } },
                        },
                        required: ['day', 'places'],
                      },
                    },
                    note: { type: 'string' },
                  },
                  required: ['title', 'days'],
                },
              },
            ],
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
  ]);
  let server: Awaited<ReturnType<typeof startCheckedServer>> | undefined;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  try {
    server = await startCheckedServer({
      retained: retainedConsumer,
      target: backend.origin + '/api',
      apiKey: 'welcome-proof-key',
    });
    const origin = server.url;
    await page.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === origin) {
        expect(route.request().headers()['x-api-key']).toBeUndefined();
        return route.continue();
      }
      errors.push('Unexpected external request: ' + route.request().url());
      return route.abort();
    });
    await page.addInitScript((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          projects: [{ id: 'other', name: 'Other project' }],
        })
      );
    }, key);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(origin + '/?presentation=sidebar&thread=welcome');
    await backend.steps[2].received;
    const welcome = page.getByRole('heading', {
      name: 'How can I help?',
      exact: true,
    });
    const draft = page.locator('#message');
    const launcher = page.getByRole('button', { name: 'Chat', exact: true });
    const dialog = page.getByRole('dialog', {
      name: 'Conversation',
      exact: true,
    });
    const close = dialog.getByRole('button', {
      name: 'Close chat',
      exact: true,
    });
    await launcher.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(close).toBeFocused();
    await expect(draft).toBeVisible();
    await expect(draft).toBeDisabled();
    await expect(welcome).toHaveCount(0);
    await expect(page.locator('.tp-welcome-suggestion')).toHaveCount(0);
    expect(backend.requests).toHaveLength(3);
    const inputNode = await draft.elementHandle();
    assert.ok(inputNode);
    backend.steps[2].releaseBody();
    await expect(welcome).toBeVisible();
    await expect(draft).toBeEnabled();
    await expect(page.locator('.tp-welcome-suggestion')).toHaveCount(2);
    await expect(close).toBeFocused();
    await close.click();
    const preference = page.getByRole('checkbox', {
      name: 'Keep page beside chat',
    });
    const project = page.getByRole('button', {
      name: 'Other project',
      exact: true,
    });
    await project.click();
    const url = page.url();
    const storage = await page.evaluate(
      (key) => localStorage.getItem(key),
      key
    );
    await launcher.press('Enter');
    await expect(close).toBeFocused();
    await expect(welcome).toBeVisible();
    const trip = page.getByRole('button', {
      name: 'Plan a weekend trip',
      exact: true,
    });
    const topic = page.getByRole('button', {
      name: 'Explain a topic',
      exact: true,
    });
    await expect(page.locator('.tp-welcome-suggestion')).toHaveCount(2);
    await expect(trip).toBeEnabled();
    await expect(topic).toBeEnabled();
    const retained = async (requests: number, value: string) => {
      expect(backend.requests).toHaveLength(requests);
      expect(page.url()).toBe(url);
      await expect(project).toHaveAttribute('aria-current', 'true');
      expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
        storage
      );
      await expect(draft).toHaveValue(value);
      expect(
        await inputNode.evaluate(
          (node) => node === document.querySelector('#message')
        )
      ).toBe(true);
      await expect(page.locator('.conversation-id')).toHaveText(
        'Conversation ID: welcome'
      );
    };
    // Native pointer and keyboard activation both fill the existing controlled input.
    await trip.click();
    await expect(draft).toBeFocused();
    await retained(3, 'Help me plan a weekend trip.');
    await expect(trip).toBeDisabled();
    await expect(topic).toBeDisabled();
    for (const value of ['   \n  ', 'My own draft']) {
      await draft.fill(value);
      await expect(trip).toBeDisabled();
      await expect(topic).toBeDisabled();
      await topic.evaluate((button) => (button as HTMLButtonElement).click());
      await retained(3, value);
    }
    await draft.fill('');
    await expect(trip).toBeEnabled();
    await expect(topic).toBeEnabled();
    await topic.focus();
    await page.keyboard.press('Space');
    await expect(draft).toBeFocused();
    await retained(3, raw);
    await draft.fill('');
    await trip.focus();
    await page.keyboard.press('Enter');
    await expect(draft).toBeFocused();
    await retained(3, 'Help me plan a weekend trip.');
    await draft.fill('');
    await close.click();
    await preference.uncheck();
    await launcher.click();
    await expect(close).toBeFocused();
    await expect(welcome).toBeVisible();
    await retained(3, '');
    await page
      .locator('html')
      .evaluate((node) => node.setAttribute('dir', 'rtl'));
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(welcome).toBeVisible();
      for (const control of [welcome, draft, trip, topic]) {
        await control.scrollIntoViewIfNeeded();
        const box = await control.boundingBox();
        assert.ok(box);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(844);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`welcome-rtl-${width}.png`),
        fullPage: false,
      });
      await retained(3, '');
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await topic.click();
    await expect(draft).toBeFocused();
    await retained(3, raw);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await backend.steps[3].received;
    await expect(
      page.getByText('Start with one question.', { exact: true })
    ).toBeVisible();
    await expect(welcome).toHaveCount(0);
    await expect(trip).toHaveCount(0);
    await expect(draft).toBeDisabled();
    await retained(4, '');
    await close.click();
    await preference.check();
    await launcher.click();
    await expect(close).toBeFocused();
    await retained(4, '');
    await expect(
      page.getByRole('button', { name: 'Stop', exact: true })
    ).toBeEnabled();
    backend.steps[3].releaseBody();
    expect((await backend.steps[3].closed).finished).toBe(true);
    await expect(page.locator('.submission-status')).toHaveText(
      'Response complete.'
    );
    await expect(draft).toBeEnabled();
    await draft.fill('A new draft after the first message.');
    await close.click();
    await launcher.press('Space');
    await expect(close).toBeFocused();
    await expect(welcome).toHaveCount(0);
    await retained(4, 'A new draft after the first message.');
    for (const request of backend.requests)
      expect(request.headers['x-api-key']).toBe('welcome-proof-key');
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
