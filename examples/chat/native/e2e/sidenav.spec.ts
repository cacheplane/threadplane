import { expect, test } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('installed React sidenav retains navigation, draft and a running response across modes', async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  const { buildConsumer } = await import('../tooling/consumer.mjs');
  const { startProofServer, threadEnvelope } = await import(
    '../tooling/proof-server.mjs'
  );
  const { captureRetainedBuild, readRetainedBuild, startCheckedServer } =
    await import('../tooling/retained-build.mjs');
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'native-sidenav-')));
  const rows = [
    threadEnvelope('a', 'Alpha notes'),
    threadEnvelope('b', 'Beta notes'),
  ];
  const saved = (id: string) => [
    { type: 'ai', id: `saved-${id}`, content: `Saved answer ${id}.` },
  ];
  const history = (id: string) => ({
    method: 'POST',
    path: `/api/threads/${id}/history`,
    payload: { limit: 10 },
    body: [
      {
        values: { messages: saved(id) },
        next: [],
        tasks: [],
        checkpoint: {
          thread_id: id,
          checkpoint_ns: '',
          checkpoint_id: 'saved',
        },
        parent_checkpoint: null,
        metadata: { source: 'input', step: 0, parents: {} },
        created_at: '2026-10-20T00:00:00.000Z',
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
    { method: 'GET', path: '/api/threads/b', body: rows[1] },
    history('b'),
    {
      method: 'POST',
      path: '/api/threads/b/runs/stream',
      holdHeaders: true,
      holdBody: true,
      events: [
        {
          event: 'values',
          data: {
            messages: [
              ...saved('b'),
              { type: 'ai', id: 'response', content: '# Sidenav response' },
            ],
          },
        },
      ],
      assertPayload(value: unknown) {
        const payload = value as {
          assistant_id: string;
          input: {
            messages: { id: string; type: string; content: string }[];
            client_tools: { name: string }[];
          };
          on_disconnect: string;
        };
        assert.equal(payload.assistant_id, 'assistant');
        assert.equal(payload.input.messages.length, 1);
        assert.deepEqual(payload.input.messages[0], {
          id: payload.input.messages[0].id,
          type: 'human',
          content: 'Continue with navigation.',
        });
        assert.match(payload.input.messages[0].id, /^[0-9a-f-]{36}$/i);
        assert.deepEqual(
          payload.input.client_tools.map((tool) => tool.name),
          ['show_trip_summary']
        );
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
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(origin + '/?presentation=sidenav&thread=a');
    const nav = page.getByRole('navigation', {
      name: 'Conversations',
      exact: true,
    });
    const panel = page.locator('.tp-chat-sidenav__panel');
    const filter = page.getByRole('searchbox', {
      name: 'Filter loaded conversations by title',
    });
    const draft = page.getByRole('textbox', { name: 'Message', exact: true });
    const launcher = page.getByRole('button', {
      name: 'Open conversations',
      exact: true,
    });
    const collapse = page.getByRole('button', {
      name: 'Collapse conversations',
      exact: true,
    });
    const expand = page.getByRole('button', {
      name: 'Expand conversations',
      exact: true,
    });
    const close = page.getByRole('button', {
      name: 'Close conversations',
      exact: true,
    });
    await expect(draft).toBeEnabled();
    await expect(
      page.getByText('Saved answer a.', { exact: true })
    ).toBeVisible();
    expect(backend.requests).toHaveLength(3);
    await filter.fill('notes');
    await draft.fill('Retain this draft.');
    const filterNode = await filter.elementHandle();
    const firstDraft = await draft.elementHandle();
    assert.ok(filterNode && firstDraft);
    await collapse.focus();
    await page.keyboard.press('Enter');
    await expect(filter).toBeHidden();
    await expect(page.locator('.tp-chat-sidenav__body')).toHaveAttribute(
      'inert',
      ''
    );
    await expect(expand).toBeFocused();
    await page.keyboard.press('Space');
    await expect(filter).toHaveValue('notes');
    await expect(draft).toHaveValue('Retain this draft.');
    expect(
      await filterNode.evaluate(
        (node) => node === document.querySelector('#filter')
      )
    ).toBe(true);
    expect(
      await firstDraft.evaluate(
        (node) => node === document.querySelector('#message')
      )
    ).toBe(true);
    expect(backend.requests).toHaveLength(3);
    await nav.getByRole('button', { name: 'Beta notes', exact: true }).click();
    await expect(page).toHaveURL(/thread=b/);
    await expect(nav.locator('[aria-current="true"]')).toHaveText('Beta notes');
    await expect(
      page.getByText('Saved answer b.', { exact: true })
    ).toBeVisible();
    await expect(draft).toHaveValue('');
    expect(
      await firstDraft.evaluate(
        (node) => node === document.querySelector('#message')
      )
    ).toBe(false);
    const retainedDraft = await draft.elementHandle();
    assert.ok(retainedDraft);
    await draft.fill('Continue with navigation.');
    await draft.press('Control+Enter');
    await backend.steps[5].received;
    await expect(page.locator('.submission-status')).toHaveText(
      'Response in progress…'
    );
    await collapse.click();
    // Both resize directions occur while the same admitted request is held.
    for (const width of [390, 600]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(nav).toBeHidden();
      await expect(panel).toHaveAttribute('inert', '');
      await launcher.focus();
      await page.keyboard.press('Enter');
      await expect(close).toBeFocused();
      await expect(launcher).toBeHidden();
      await expect(nav).not.toHaveAttribute('aria-modal');
      const rect = await panel.boundingBox();
      assert.ok(rect);
      expect(rect.x).toBe(0);
      expect(rect.y).toBe(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(width);
      const rem = await page.evaluate(() =>
        parseFloat(getComputedStyle(document.documentElement).fontSize)
      );
      expect(rect.width).toBeCloseTo(Math.min(20 * rem, width), 0);
      expect(rect.height).toBe(844);
      await page.keyboard.press('Tab');
      await expect(
        nav.getByRole('button', { name: 'Refresh', exact: true })
      ).toBeFocused();
      await filter.scrollIntoViewIfNeeded();
      await expect(filter).toHaveValue('notes');
      await nav.locator('[aria-current="true"]').scrollIntoViewIfNeeded();
      await expect(nav.locator('[aria-current="true"]')).toBeVisible();
      // Escape outside the nonmodal nav leaves it open.
      await page.locator('h1').evaluate((node) => {
        node.setAttribute('tabindex', '-1');
        node.focus();
      });
      await page.keyboard.press('Escape');
      await expect(nav).toBeVisible();
      await filter.focus();
      await page.keyboard.press('Escape');
      await expect(nav).toBeHidden();
      await expect(launcher).toBeFocused();
      for (let index = 0; index < 5; index++) {
        await page.keyboard.press('Tab');
        expect(
          await panel.evaluate((node) => node.contains(document.activeElement))
        ).toBe(false);
      }
      await launcher.focus();
      await page.keyboard.press('Space');
      await expect(close).toBeFocused();
      await page.screenshot({
        path: testInfo.outputPath(`sidenav-mobile-${width}.png`),
        fullPage: true,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
      // Focus on a disappearing drawer control must move to the desktop toggle.
      await page.setViewportSize({ width: 1280, height: 900 });
      await expect(expand).toBeFocused();
      await expect(filter).toBeHidden();
      expect(
        await retainedDraft.evaluate(
          (node) => node === document.querySelector('#message')
        )
      ).toBe(true);
      await expect(page.locator('.submission-status')).toHaveText(
        'Response in progress…'
      );
      expect(backend.requests).toHaveLength(6);
    }
    // Drawer placement follows the document's inline direction.
    await page.setViewportSize({ width: 600, height: 844 });
    await page
      .locator('html')
      .evaluate((node) => node.setAttribute('dir', 'rtl'));
    await launcher.click();
    const rtl = await panel.boundingBox();
    assert.ok(rtl);
    expect(rtl.x + rtl.width).toBe(600);
    await close.click();
    await expect(launcher).toBeFocused();
    await page.locator('html').evaluate((node) => node.removeAttribute('dir'));
    await page.setViewportSize({ width: 1280, height: 900 });
    await expand.click();
    await expect(filter).toHaveValue('notes');
    backend.steps[5].releaseHeaders();
    await backend.steps[5].headersSent;
    backend.steps[5].releaseBody();
    expect((await backend.steps[5].closed).finished).toBe(true);
    await expect(
      page.getByRole('heading', { name: 'Sidenav response', exact: true })
    ).toBeVisible();
    await expect(page.locator('.submission-status')).toHaveText(
      'Response complete.'
    );
    expect(
      await retainedDraft.evaluate(
        (node) => node === document.querySelector('#message')
      )
    ).toBe(true);
    expect(backend.requests).toHaveLength(6);
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
