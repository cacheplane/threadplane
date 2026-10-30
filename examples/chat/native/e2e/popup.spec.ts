import { test, type RetainedConsumer } from './fixtures';
import { expect, type Page, type TestInfo } from '@playwright/test';
import assert from 'node:assert/strict';

async function verifyPanel(
  page: Page,
  testInfo: TestInfo,
  presentation: 'popup' | 'sidebar',
  retainedConsumer: RetainedConsumer
) {
  test.setTimeout(300_000);
  const { startProofServer, threadEnvelope } = await import(
    '../tooling/proof-server.mjs'
  );
  const { startCheckedServer } =
    await import('../tooling/retained-build.mjs');
  const title = `${presentation} conversation`;
  const thread = threadEnvelope('popup', title);
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
          content: `Continue in the ${presentation}.`,
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
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(origin + `/?presentation=${presentation}`);
    await page.getByRole('button', { name: title, exact: true }).click();
    const launcher = page.getByRole('button', { name: 'Chat', exact: true });
    const dialog = page.getByRole('dialog', {
      name: 'Conversation',
      exact: true,
    });
    const panel = page.locator('.tp-chat-popup__panel');
    const draft = page.locator('#message');
    const filter = page.getByRole('searchbox');
    const filterNode = await filter.elementHandle();
    assert.ok(filterNode);
    const preference = page.getByRole('checkbox', {
      name: 'Keep page beside chat',
    });
    let expectedRequests = 3;
    const verifySidebarLayout = async (
      open: boolean,
      push: boolean,
      rtl = false
    ) => {
      const geometry = await page
        .locator('.tp-chat-sidebar-layout')
        .evaluate((layout) => {
          const slot = layout.querySelector('.tp-chat-sidebar-layout__page')!;
          const child = slot.firstElementChild!;
          const directory = slot.querySelector('aside')!;
          const bounds = (node: Element) => {
            const { x, y, width, height, right } = node.getBoundingClientRect();
            return { x, y, width, height, right };
          };
          return {
            layout: bounds(layout),
            slot: bounds(slot),
            child: bounds(child),
            directory: bounds(directory),
            padding: parseFloat(getComputedStyle(layout).paddingInlineEnd),
            rem: parseFloat(
              getComputedStyle(document.documentElement).fontSize
            ),
            viewport: innerWidth,
            // Check real children, including narrow action buttons, rather than only root scrolling.
            escaped: [...slot.querySelectorAll('*')]
              .filter((node) => {
                const rect = node.getBoundingClientRect();
                const parent = slot.getBoundingClientRect();
                return (
                  rect.width > 0 &&
                  (rect.left < parent.left - 1 || rect.right > parent.right + 1)
                );
              })
              .map((node) => node.outerHTML),
          };
        });
      const reserve =
        open && push && geometry.viewport > 640 ? 28 * geometry.rem : 0;
      expect(geometry.padding).toBeCloseTo(reserve, 1);
      expect(geometry.slot.width).toBeCloseTo(
        geometry.layout.width - reserve,
        1
      );
      expect(geometry.child.width).toBeCloseTo(geometry.slot.width, 1);
      expect(geometry.directory.width).toBeCloseTo(geometry.slot.width, 1);
      expect(geometry.slot.x).toBeCloseTo(
        geometry.layout.x + (rtl ? reserve : 0),
        1
      );
      expect(geometry.escaped).toEqual([]);
      if (open) {
        const rect = await panel.boundingBox();
        assert.ok(rect);
        expect(rect.width).toBeCloseTo(
          geometry.viewport <= 640 ? geometry.viewport : 28 * geometry.rem,
          1
        );
        expect(rect.x).toBeCloseTo(rtl ? 0 : geometry.viewport - rect.width, 1);
        if (reserve) {
          if (rtl)
            expect(geometry.slot.x).toBeGreaterThanOrEqual(rect.x + rect.width);
          else expect(geometry.slot.right).toBeLessThanOrEqual(rect.x);
        }
      }
      expect(
        await filterNode.evaluate(
          (node) => node === document.querySelector('#filter')
        )
      ).toBe(true);
      await expect(filter).toHaveValue(presentation);
      expect(backend.requests).toHaveLength(expectedRequests);
    };
    await expect(draft).toBeEnabled();
    await expect(dialog).toBeHidden();
    await expect(panel).toHaveAttribute('inert', '');
    await expect(launcher).toHaveAttribute('aria-expanded', 'false');
    const inputNode = await draft.elementHandle();
    assert.ok(inputNode);
    expect(backend.requests).toHaveLength(3);
    await filter.fill(presentation);
    if (presentation === 'sidebar') {
      await expect(preference).toBeChecked();
      await verifySidebarLayout(false, true);
    }
    await launcher.focus();
    await page.keyboard.press('Enter');
    const close = dialog.getByRole('button', {
      name: 'Close chat',
      exact: true,
    });
    await expect(close).toBeFocused();
    await expect(dialog).toHaveAttribute('aria-modal', 'false');
    if (presentation === 'sidebar') {
      await verifySidebarLayout(true, true);
      await page.screenshot({
        path: testInfo.outputPath('sidebar-desktop-1280.png'),
        fullPage: true,
      });
      await expect(launcher).toBeHidden();
      const rect = await panel.boundingBox();
      assert.ok(rect);
      const rem = await page.evaluate(() =>
        parseFloat(getComputedStyle(document.documentElement).fontSize)
      );
      expect(rect.width).toBeCloseTo(28 * rem, 0);
      expect(rect.x + rect.width).toBe(1280);
      expect(rect.y).toBe(0);
      expect(rect.height).toBe(900);
    }
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
    await expect(
      presentation === 'sidebar' ? preference : launcher
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await close.click();
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
    await draft.fill(`Continue in the ${presentation}.`);
    await draft.press('Control+Enter');
    await backend.steps[3].received;
    expectedRequests = 4;
    await expect(
      dialog.getByText('Response in progress…', { exact: true })
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Stop', exact: true })
    ).toBeVisible();
    await close.click();
    await expect(dialog).toBeHidden();
    if (presentation === 'sidebar') {
      await verifySidebarLayout(false, true);
      // Keep the same fourth request admitted through every layout change.
      await preference.uncheck();
      await launcher.click();
      await verifySidebarLayout(true, false);
      await preference.check();
      await verifySidebarLayout(true, true);
      await page
        .locator('html')
        .evaluate((node) => node.setAttribute('dir', 'rtl'));
      await verifySidebarLayout(true, true, true);
      await preference.uncheck();
      await verifySidebarLayout(true, false, true);
      await preference.check();
      await page
        .locator('html')
        .evaluate((node) => node.setAttribute('dir', 'ltr'));
      for (const width of [641, 640, 390, 600, 641, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        await verifySidebarLayout(true, true);
        if (width === 641) {
          // Trial clicks verify hit targets without issuing application commands.
          await page
            .getByRole('button', { name: 'Refresh', exact: true })
            .click({ trial: true });
          await page
            .getByRole('button', { name: 'New', exact: true })
            .click({ trial: true });
          await page
            .getByRole('button', { name: title, exact: true })
            .click({ trial: true });
          await filter.click();
          await expect(filter).toBeFocused();
        }
        await expect(close).toBeVisible();
        // Closing exposes the page controls even under the full-width mobile panel.
        await close.click();
        await verifySidebarLayout(false, true);
        await preference.uncheck();
        await verifySidebarLayout(false, false);
        await preference.check();
        await launcher.click();
        await verifySidebarLayout(true, true);
        expect(
          await inputNode.evaluate(
            (node) => node === document.querySelector('#message')
          )
        ).toBe(true);
        expect(backend.requests).toHaveLength(4);
        if (width <= 640) {
          await page.screenshot({
            path: testInfo.outputPath(`sidebar-held-mobile-${width}.png`),
            fullPage: true,
          });
        }
      }
      await close.click();
      await expect(dialog).toBeHidden();
      expect(backend.requests).toHaveLength(4);
    }
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
    for (const width of [390, 600]) {
      await page.setViewportSize({ width, height: 844 });
      const rect = await panel.boundingBox();
      assert.ok(rect);
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(width);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.y + rect.height).toBeLessThanOrEqual(844);
      if (presentation === 'sidebar') {
        expect(rect.x).toBe(0);
        expect(rect.y).toBe(0);
        expect(rect.width).toBe(width);
        expect(rect.height).toBe(844);
        await expect(launcher).toBeHidden();
      }
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
        path: testInfo.outputPath(`${presentation}-mobile-${width}.png`),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(filter).toHaveValue(presentation);
    expect(
      await filterNode.evaluate(
        (node) => node === document.querySelector('#filter')
      )
    ).toBe(true);
    if (presentation === 'sidebar') await verifySidebarLayout(true, true);
    await expect(draft).toHaveValue('Mobile draft');
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
  }
}

for (const presentation of ['popup', 'sidebar'] as const) {
  test(`installed React ${presentation} preserves its draft and a hidden running response without commands`, async ({
    page,
    retainedConsumer,
  }, testInfo) => {
    await verifyPanel(page, testInfo, presentation, retainedConsumer);
  });
}
