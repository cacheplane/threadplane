import { expect, test } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('installed React popup preserves its draft and a hidden running response without commands', async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  const { buildConsumer } = await import('../tooling/consumer.mjs');
  const { startProofServer, threadEnvelope } = await import(
    '../tooling/proof-server.mjs'
  );
  const { captureRetainedBuild, readRetainedBuild, startCheckedServer } =
    await import('../tooling/retained-build.mjs');
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'native-popup-')));
  const thread = threadEnvelope('popup', 'Popup conversation');
  const saved = [{ type: 'ai', id: 'saved', content: '# Saved answer' }];
  const backend = await startProofServer([
    {
      method: 'POST',
      path: '/api/threads/search',
      payload: { limit: 50, offset: 0 },
      body: [thread],
    },
    { method: 'GET', path: '/api/threads/popup', body: thread },
    {
      method: 'POST',
      path: '/api/threads/popup/history',
      payload: { limit: 10 },
      body: [
        {
          values: { messages: saved },
          next: [],
          tasks: [],
          checkpoint: {
            thread_id: 'popup',
            checkpoint_ns: '',
            checkpoint_id: 'saved',
          },
          parent_checkpoint: null,
          metadata: { source: 'input', step: 0, parents: {} },
          created_at: '2026-10-20T00:00:00.000Z',
        },
      ],
    },
    {
      method: 'POST',
      path: '/api/threads/popup/runs/stream',
      holdHeaders: true,
      holdBody: true,
      events: [
        {
          event: 'values',
          data: {
            messages: [
              ...saved,
              {
                type: 'ai',
                id: 'response',
                content:
                  '# Popup response\n\nFinished while the view was hidden.',
              },
            ],
          },
        },
      ],
      assertPayload(value: unknown) {
        const payload = value as {
          assistant_id: unknown;
          input: {
            messages: { id: string; type: string; content: string }[];
            client_tools: { name: string }[];
          };
          stream_mode: unknown;
          on_disconnect: unknown;
        };
        assert.equal(payload.assistant_id, 'assistant');
        assert.equal(payload.input.messages.length, 1);
        assert.deepEqual(payload.input.messages[0], {
          id: payload.input.messages[0].id,
          type: 'human',
          content: 'Continue in the popup.',
        });
        assert.match(payload.input.messages[0].id, /^[0-9a-f-]{36}$/i);
        assert.deepEqual(
          payload.input.client_tools.map((tool) => tool.name),
          ['show_trip_summary']
        );
        assert.deepEqual(payload.stream_mode, [
          'values',
          'messages-tuple',
          'updates',
          'custom',
          'checkpoints',
        ]);
        assert.equal(payload.on_disconnect, 'continue');
      },
    },
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
      errors.push('Unexpected external request: ' + route.request().url());
      return route.abort();
    });
    await page.goto(origin + '/?presentation=popup');
    await page
      .getByRole('button', { name: 'Popup conversation', exact: true })
      .click();
    const launcher = page.getByRole('button', { name: 'Chat', exact: true });
    const dialog = page.getByRole('dialog', {
      name: 'Conversation',
      exact: true,
    });
    const panel = page.locator('.tp-chat-popup__panel');
    const draft = page.locator('#message');
    await expect(draft).toBeEnabled();
    await expect(dialog).toBeHidden();
    await expect(panel).toHaveAttribute('inert', '');
    await expect(launcher).toHaveAttribute('aria-expanded', 'false');
    const inputNode = await draft.elementHandle();
    assert.ok(inputNode);
    expect(backend.requests).toHaveLength(3);
    await launcher.focus();
    await page.keyboard.press('Enter');
    const close = dialog.getByRole('button', {
      name: 'Close chat',
      exact: true,
    });
    await expect(close).toBeFocused();
    await expect(dialog).toHaveAttribute('aria-modal', 'false');
    await draft.fill('Keep this unsent draft.');
    await draft.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(launcher).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(draft).toHaveValue('Keep this unsent draft.');
    expect(
      await inputNode.evaluate(
        (node) => node === document.querySelector('#message')
      )
    ).toBe(true);
    await close.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(launcher).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    // Real Tab navigation must skip the retained but hidden/inert controls.
    for (let index = 0; index < 8; index++) {
      await page.keyboard.press('Tab');
      expect(
        await panel.evaluate((node) => node.contains(document.activeElement))
      ).toBe(false);
    }
    expect(backend.requests).toHaveLength(3);
    await launcher.click();
    await draft.fill('Continue in the popup.');
    await draft.press('Control+Enter');
    await backend.steps[3].received;
    await expect(
      dialog.getByText('Response in progress…', { exact: true })
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Stop', exact: true })
    ).toBeVisible();
    await close.click();
    await expect(dialog).toBeHidden();
    // Closing the view must not physically cancel the admitted request.
    backend.steps[3].releaseHeaders();
    await backend.steps[3].headersSent;
    backend.steps[3].releaseBody();
    expect((await backend.steps[3].closed).finished).toBe(true);
    await expect(page.locator('.submission-status')).toHaveText(
      'Response complete.'
    );
    await launcher.focus();
    await page.keyboard.press('Space');
    await expect(
      dialog.getByRole('heading', { name: 'Popup response', exact: true })
    ).toBeVisible();
    await expect(draft).toHaveValue('');
    expect(
      await inputNode.evaluate(
        (node) => node === document.querySelector('#message')
      )
    ).toBe(true);
    expect(backend.requests).toHaveLength(4);
    await page.setViewportSize({ width: 390, height: 844 });
    const rect = await panel.boundingBox();
    assert.ok(rect);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(390);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.y + rect.height).toBeLessThanOrEqual(844);
    await draft.scrollIntoViewIfNeeded();
    await expect(draft).toBeVisible();
    await draft.fill('Mobile draft');
    const send = dialog.getByRole('button', { name: 'Send', exact: true });
    await send.scrollIntoViewIfNeeded();
    await expect(send).toBeVisible();
    await expect(send).toBeEnabled();
    await expect(close).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath('popup-mobile.png'),
      fullPage: true,
    });
    await close.click();
    await expect(launcher).toBeFocused();
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
