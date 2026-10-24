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
    {
      ...threadEnvelope('b', 'Beta notes'),
      metadata: { title: 'Beta notes', pinned: true },
    },
  ];
  const fixedNow = new Date('2026-09-28T00:02:01.000Z');
  const refreshedAlpha = {
    ...rows[0],
    metadata: { title: 'Alpha notes', pinned: true },
    updated_at: '2026-09-28T00:01:01.000Z',
  };
  const refreshedBeta = {
    ...rows[1],
    metadata: { title: 'Beta notes', pinned: false },
  };
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
    {
      method: 'POST',
      path: '/api/threads/search',
      payload: { limit: 50, offset: 0 },
      body: [refreshedAlpha, refreshedBeta],
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
    await page.clock.setFixedTime(fixedNow);
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
    const scrim = page.getByRole('button', {
      name: 'Close conversation navigation backdrop',
      exact: true,
    });
    const persistentToggle = page.locator('.tp-chat-sidenav__toggle');
    const expectShortcutUnclaimed = async () => {
      expect(
        await page.evaluate(() => {
          const event = new KeyboardEvent('keydown', {
            key: 'b',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
            composed: true,
          });
          document.activeElement!.dispatchEvent(event);
          return event.defaultPrevented;
        })
      ).toBe(false);
    };
    const expectFullBackdrop = async (edge: 'left' | 'right') => {
      const viewport = page.viewportSize();
      assert.ok(viewport);
      const x = edge === 'left' ? 1 : viewport.width - 1;
      await page.mouse.move(edge === 'left' ? 24 : viewport.width - 24, 820);
      expect(
        await scrim.evaluate((node, x) => {
          const style = getComputedStyle(node);
          return {
            borderRadius: style.borderRadius,
            backgroundColor: style.backgroundColor,
            topCornerCovered: document.elementFromPoint(x, 1) === node,
            bottomCornerCovered:
              document.elementFromPoint(x, innerHeight - 1) === node,
          };
        }, x)
      ).toEqual({
        borderRadius: '0px',
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
        topCornerCovered: true,
        bottomCornerCovered: true,
      });
    };
    await expect(scrim).toHaveCount(0);
    await expect(draft).toBeEnabled();
    const threadList = nav.getByRole('list', { name: 'Loaded conversations' });
    await expect(threadList).toHaveClass(/tp-thread-list/);
    const newThread = nav.getByRole('button', { name: 'New', exact: true });
    await expect(newThread).toHaveClass('tp-thread-list__new');
    await expect(
      threadList.getByRole('button', { name: 'New', exact: true })
    ).toHaveCount(0);
    const alpha = threadList.getByRole('button', {
      name: 'Alpha notes',
      exact: true,
    });
    const beta = threadList.getByRole('button', {
      name: 'Beta notes',
      exact: true,
    });
    await expect(alpha).toHaveAttribute('aria-current', 'true');
    await expect(beta).not.toHaveAttribute('aria-current');
    await expect(alpha).toHaveAccessibleName('Alpha notes');
    await expect(alpha).toHaveAccessibleDescription('2 min ago');
    await expect(alpha.locator('time')).toHaveAttribute(
      'datetime',
      rows[0].updated_at
    );
    await expect(beta).toHaveAccessibleDescription(
      'Pinned conversation 2 min ago'
    );
    await expect(threadList.getByRole('button')).toHaveText([
      /Alpha notes/,
      /Beta notes/,
    ]);
    await expect(alpha.locator('.tp-thread-list__pin')).toHaveCount(0);
    const pin = beta.locator('.tp-thread-list__pin');
    await expect(pin).toHaveCount(1);
    await expect(pin).toHaveAttribute('aria-hidden', 'true');
    await expect(pin).toHaveAttribute('focusable', 'false');
    await expect(pin).not.toHaveAttribute('tabindex');
    const alphaNode = await alpha.elementHandle();
    assert.ok(alphaNode);
    await expect(
      page.getByText('Saved answer a.', { exact: true })
    ).toBeVisible();
    expect(backend.requests).toHaveLength(3);
    // Filtering only the loaded titles must not issue a request or select a row.
    await filter.fill('Alpha');
    await expect(threadList.getByRole('button')).toHaveCount(1);
    await expect(alpha).toHaveAttribute('aria-current', 'true');
    expect(await alphaNode.evaluate((node) => node.isConnected)).toBe(true);
    expect(backend.requests).toHaveLength(3);
    await expect(alpha.locator('mark')).toHaveText('Alpha');
    await expect(alpha).toHaveAccessibleName('Alpha notes');
    await expect(alpha).toHaveAccessibleDescription('2 min ago');
    await expect(alpha.locator('time')).toHaveAttribute(
      'datetime',
      rows[0].updated_at
    );
    await filter.fill('notes');
    await expect(alpha.locator('mark')).toHaveText('notes');
    await expect(beta.locator('mark')).toHaveText('notes');
    await expect(alpha).toHaveAccessibleName('Alpha notes');
    await expect(beta).toHaveAccessibleName('Beta notes');
    await expect(alpha).toHaveAccessibleDescription('2 min ago');
    await expect(alpha.locator('time')).toHaveAttribute(
      'datetime',
      rows[0].updated_at
    );
    // Beta was filtered out and is newly mounted; retain its current node below.
    const retainedBetaNode = await beta.elementHandle();
    assert.ok(retainedBetaNode);
    const expectRetainedThreadList = async () => {
      expect(
        await alphaNode.evaluate(
          (node) =>
            node ===
            document.querySelector(
              '.tp-chat-sidenav__body .tp-thread-list__button[title="Alpha notes"]'
            )
        )
      ).toBe(true);
      expect(
        await retainedBetaNode.evaluate(
          (node) =>
            node ===
            document.querySelector(
              '.tp-chat-sidenav__body .tp-thread-list__button[title="Beta notes"]'
            )
        )
      ).toBe(true);
    };
    await page.screenshot({
      path: testInfo.outputPath('thread-list-desktop.png'),
      fullPage: true,
    });
    await draft.fill('Retain this draft.');
    const filterNode = await filter.elementHandle();
    const firstDraft = await draft.elementHandle();
    assert.ok(filterNode && firstDraft);
    await expect(collapse).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+B Meta+B'
    );
    await expect(collapse).toHaveAttribute(
      'title',
      'Collapse conversations (Ctrl/Command+B)'
    );
    await filter.focus();
    await page.keyboard.press('Control+b');
    await expectShortcutUnclaimed();
    await expect(filter).toHaveValue('notes');
    await draft.focus();
    await page.keyboard.press('Meta+b');
    await expectShortcutUnclaimed();
    await expect(draft).toHaveValue('Retain this draft.');
    await collapse.focus();
    await page.keyboard.press('Control+b');
    await expect(filter).toBeHidden();
    await expect(page.locator('.tp-chat-sidenav__body')).toHaveAttribute(
      'inert',
      ''
    );
    await expect(expand).toBeFocused();
    await expect(expand).toHaveAttribute(
      'title',
      'Expand conversations (Ctrl/Command+B)'
    );
    await page.keyboard.press('Control+b');
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
    await expectRetainedThreadList();
    await collapse.click();
    const compact = page.locator('.tp-chat-sidenav__collapsed-content');
    const compactAlpha = compact.getByRole('button', {
      name: 'Alpha notes',
      exact: true,
    });
    const compactBeta = compact.getByRole('button', {
      name: 'Beta notes',
      exact: true,
    });
    await expect(compact).toBeVisible();
    await expect(expand).toHaveAccessibleName('Expand conversations');
    expect(
      await expand.evaluate((button) => button.getBoundingClientRect().height)
    ).toBeLessThanOrEqual(48);
    await expect(compact).not.toHaveAttribute('inert');
    await expect(compactAlpha).toHaveAccessibleName('Alpha notes');
    await expect(compactAlpha).toHaveAccessibleDescription('2 min ago');
    await expect(compactBeta).toHaveAttribute('title', 'Beta notes');
    await expect(compactBeta).toHaveAccessibleDescription(
      'Pinned conversation 2 min ago'
    );
    await expect(compactBeta.locator('time')).toBeHidden();
    await expect(compactBeta.locator('span').first()).toHaveText('B');
    const compactAlphaNode = await compactAlpha.elementHandle();
    const compactBetaNode = await compactBeta.elementHandle();
    assert.ok(compactAlphaNode && compactBetaNode);
    const expectRetainedCompact = async () => {
      for (const [handle, title] of [
        [compactAlphaNode, 'Alpha notes'],
        [compactBetaNode, 'Beta notes'],
      ] as const) {
        expect(
          await handle.evaluate(
            (node, title) =>
              node ===
              document.querySelector(
                `.tp-chat-sidenav__collapsed-content .tp-thread-list__button[title="${title}"]`
              ),
            title
          )
        ).toBe(true);
      }
    };
    const railLayout = await compactBeta.evaluate((button) => {
      const compact = button.closest('.tp-chat-sidenav__collapsed-content')!;
      const panel = button.closest('nav')!;
      const bounds = button.getBoundingClientRect();
      const title = button.querySelector('span')!.getBoundingClientRect();
      const pin = button.querySelector('svg')!.getBoundingClientRect();
      return {
        width: panel.getBoundingClientRect().width,
        rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
        overflow:
          compact.scrollWidth > compact.clientWidth ||
          button.scrollWidth > button.clientWidth,
        contained:
          pin.left >= bounds.left &&
          pin.right <= title.left &&
          title.right <= bounds.right,
      };
    });
    expect(railLayout.width).toBeCloseTo(4 * railLayout.rem, 0);
    expect(railLayout.overflow).toBe(false);
    expect(railLayout.contained).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath('sidenav-compact-desktop.png'),
      fullPage: true,
    });
    expect(backend.requests).toHaveLength(3);
    await compactBeta.focus();
    await page.keyboard.press('Enter');
    await expect(compactBeta).toHaveAttribute('aria-current', 'true');
    await expand.click();
    await expect(compact).toBeHidden();
    await expect(compact).toHaveAttribute('inert', '');
    await expect(page).toHaveURL(/thread=b/);
    await expect(
      nav.locator('.tp-chat-sidenav__body [aria-current="true"]')
    ).toHaveAccessibleName('Beta notes');
    await expect(
      nav.locator('.tp-chat-sidenav__body [aria-current="true"]')
    ).toHaveAccessibleDescription('Pinned conversation 2 min ago');
    await expect(alpha).not.toHaveAttribute('aria-current');
    await expectRetainedThreadList();
    await expectRetainedCompact();
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
    await collapse.focus();
    await page.keyboard.press('Meta+b');
    await expect(expand).toBeFocused();
    // Both resize directions occur while the same admitted request is held.
    for (const width of [390, 600]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(nav).toBeHidden();
      await expect(compact).toBeHidden();
      await expect(compact).toHaveAttribute('inert', '');
      await expect(panel).toHaveAttribute('inert', '');
      await launcher.focus();
      await expect(persistentToggle).not.toHaveAttribute('aria-keyshortcuts');
      await expect(persistentToggle).not.toHaveAttribute('title');
      await page.keyboard.press('Control+b');
      await expectShortcutUnclaimed();
      await expect(nav).toBeHidden();
      await page.keyboard.press('Enter');
      await expect(compact).toBeHidden();
      await expect(compact).toHaveAttribute('inert', '');
      await expect(close).toBeFocused();
      await page.keyboard.press('Meta+b');
      await expectShortcutUnclaimed();
      await expect(nav).toBeVisible();
      await expect(close).toBeFocused();
      await expect(persistentToggle).not.toHaveAttribute('aria-keyshortcuts');
      await expect(persistentToggle).not.toHaveAttribute('title');
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
      const backdrop = await scrim.boundingBox();
      expect(backdrop).toEqual({ x: 0, y: 0, width, height: 844 });
      await expectFullBackdrop('right');
      expect(
        await scrim.evaluate((node) => getComputedStyle(node).position)
      ).toBe('fixed');
      expect(
        await scrim.evaluate((node) => Number(getComputedStyle(node).zIndex))
      ).toBeLessThan(
        await panel.evaluate((node) => Number(getComputedStyle(node).zIndex))
      );
      // A real underlying control proves the full-viewport backdrop wins hit testing.
      await page.evaluate(() => {
        const probe = document.createElement('button');
        probe.id = 'scrim-underlying-probe';
        probe.textContent = 'Underlying control';
        probe.style.cssText =
          'position:fixed;right:12px;bottom:12px;width:24px;height:24px;z-index:100';
        probe.dataset.activations = '0';
        probe.onclick = () => {
          probe.dataset.activations = String(
            Number(probe.dataset.activations) + 1
          );
        };
        document.body.append(probe);
      });
      expect(
        await scrim.evaluate(
          (node) => document.elementFromPoint(innerWidth - 24, 820) === node
        )
      ).toBe(true);
      expect(
        await panel.evaluate((node) =>
          node.contains(document.elementFromPoint(8, 8))
        )
      ).toBe(true);
      await page.mouse.click(width - 24, 820);
      await expect(nav).toBeHidden();
      await expect(compact).toBeHidden();
      await expect(compact).toHaveAttribute('inert', '');
      await expect(scrim).toHaveCount(0);
      await expect(launcher).toBeFocused();
      await expect(page.locator('#scrim-underlying-probe')).toHaveAttribute(
        'data-activations',
        '0'
      );
      await page
        .locator('#scrim-underlying-probe')
        .evaluate((node) => node.remove());
      expect(backend.requests).toHaveLength(6);
      await expectRetainedThreadList();
      await expectRetainedCompact();
      await launcher.click();
      await scrim.focus();
      await page.keyboard.press(width === 390 ? 'Enter' : 'Space');
      await expect(nav).toBeHidden();
      await expect(compact).toBeHidden();
      await expect(compact).toHaveAttribute('inert', '');
      await expect(launcher).toBeFocused();
      expect(backend.requests).toHaveLength(6);
      await launcher.click();
      await expect(compact).toBeHidden();
      await expect(compact).toHaveAttribute('inert', '');
      await expect(close).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(
        nav.getByRole('button', { name: 'Refresh', exact: true })
      ).toBeFocused();
      await filter.scrollIntoViewIfNeeded();
      await expect(filter).toHaveValue('notes');
      await nav
        .locator('.tp-chat-sidenav__body [aria-current="true"]')
        .scrollIntoViewIfNeeded();
      await expect(
        nav.locator('.tp-chat-sidenav__body [aria-current="true"]')
      ).toBeVisible();
      const highlightLayout = await beta.locator('mark').evaluate((mark) => {
        const button = mark.closest('button')!;
        const outer = button.getBoundingClientRect();
        const style = getComputedStyle(mark);
        const colors = [style.color, style.backgroundColor].map((color) => {
          const [r, g, b] = color
            .match(/\d+/g)!
            .slice(0, 3)
            .map(Number)
            .map((channel) => {
              const value = channel / 255;
              return value <= 0.04045
                ? value / 12.92
                : ((value + 0.055) / 1.055) ** 2.4;
            });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        });
        return {
          contained: Array.from(mark.getClientRects()).every(
            (rect) =>
              rect.left >= outer.left &&
              rect.right <= outer.right &&
              rect.bottom <= outer.bottom
          ),
          contrast: (Math.max(...colors) + 0.05) / (Math.min(...colors) + 0.05),
        };
      });
      expect(highlightLayout.contained).toBe(true);
      expect(highlightLayout.contrast).toBeGreaterThanOrEqual(4.5);
      await expect(beta).toHaveAccessibleName('Beta notes');
      await expect(beta).toHaveAccessibleDescription(
        'Pinned conversation 2 min ago'
      );
      await expect(beta.locator('time')).toHaveAttribute(
        'datetime',
        rows[1].updated_at
      );
      expect(
        await beta.evaluate((button) => {
          const icon = button.querySelector('.tp-thread-list__pin')!;
          const title = button.querySelector('mark')!;
          const outer = button.getBoundingClientRect();
          const rect = icon.getBoundingClientRect();
          const text = title.getBoundingClientRect();
          const style = getComputedStyle(icon);
          return {
            contained:
              rect.left >= outer.left &&
              rect.right <= outer.right &&
              rect.top >= outer.top &&
              rect.bottom <= outer.bottom,
            aligned: rect.top < text.bottom && rect.bottom > text.top,
            inheritsColor:
              style.fill === getComputedStyle(button).color &&
              style.color === getComputedStyle(button).color,
            inline: style.display === 'inline-block',
          };
        })
      ).toEqual({
        contained: true,
        aligned: true,
        inheritsColor: true,
        inline: true,
      });
      const timeLayout = await beta.evaluate((button) => {
        const time = button.querySelector('time')!;
        const title = button.querySelector('span')!;
        const outer = button.getBoundingClientRect();
        const inner = time.getBoundingClientRect();
        return {
          secondLine: inner.top >= title.getBoundingClientRect().bottom,
          contained:
            inner.left >= outer.left &&
            inner.right <= outer.right &&
            inner.bottom <= outer.bottom,
          wraps:
            getComputedStyle(time).overflowWrap === 'anywhere' &&
            getComputedStyle(time).whiteSpace === 'normal',
          inheritsContrast:
            getComputedStyle(time).color === getComputedStyle(button).color,
        };
      });
      expect(timeLayout).toEqual({
        secondLine: true,
        contained: true,
        wraps: true,
        inheritsContrast: true,
      });
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
      await expect(compact).toBeHidden();
      await expect(compact).toHaveAttribute('inert', '');
      await expect(launcher).toBeFocused();
      for (let index = 0; index < 5; index++) {
        await page.keyboard.press('Tab');
        expect(
          await panel.evaluate((node) => node.contains(document.activeElement))
        ).toBe(false);
      }
      await launcher.focus();
      await page.keyboard.press('Space');
      await expect(compact).toBeHidden();
      await expect(compact).toHaveAttribute('inert', '');
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
      // Keep the drawer's own disappearing-control focus coverage too.
      await close.focus();
      await page.setViewportSize({ width: 1280, height: 900 });
      await expect(expand).toBeFocused();
      await expect(scrim).toHaveCount(0);
      await page.setViewportSize({ width, height: 844 });
      await launcher.click();
      // Focus on the removed sibling backdrop must move to the desktop toggle.
      await scrim.focus();
      await page.setViewportSize({ width: 1280, height: 900 });
      await expect(expand).toBeFocused();
      await expect(scrim).toHaveCount(0);
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
    expect(
      await beta.evaluate((node) => getComputedStyle(node).textAlign)
    ).toBe('start');
    await expectFullBackdrop('left');
    expect(await scrim.boundingBox()).toEqual({
      x: 0,
      y: 0,
      width: 600,
      height: 844,
    });
    expect(
      await scrim.evaluate(
        (node) => document.elementFromPoint(24, 820) === node
      )
    ).toBe(true);
    expect(
      await panel.evaluate((node) =>
        node.contains(document.elementFromPoint(592, 8))
      )
    ).toBe(true);
    await page.mouse.click(24, 820);
    await expect(nav).toBeHidden();
    await expect(scrim).toHaveCount(0);
    await expect(launcher).toBeFocused();
    expect(backend.requests).toHaveLength(6);
    await page.locator('html').evaluate((node) => node.removeAttribute('dir'));
    await page.setViewportSize({ width: 1280, height: 900 });
    await expand.click();
    await expect(filter).toHaveValue('notes');
    await expectRetainedThreadList();
    await expectRetainedCompact();
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
    await expectRetainedThreadList();
    await expectRetainedCompact();
    // Refresh after the held stream completes keeps its request indices intact.
    const alphaRow = await alpha.evaluateHandle(
      (button) => button.parentElement
    );
    await nav.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(alpha).toHaveAccessibleDescription(
      'Pinned conversation 1 min ago'
    );
    await expect(beta).toHaveAccessibleDescription('2 min ago');
    await expect(beta.locator('.tp-thread-list__pin')).toHaveCount(0);
    await expect(alpha.locator('.tp-thread-list__pin')).toHaveCount(1);
    await expect(threadList.getByRole('button')).toHaveText([
      /Alpha notes/,
      /Beta notes/,
    ]);
    await expect(alpha).toHaveAccessibleName('Alpha notes');
    await expect(alpha.locator('time')).toHaveAttribute(
      'datetime',
      refreshedAlpha.updated_at
    );
    expect(
      await alphaRow.evaluate(
        (row) =>
          row ===
          document.querySelector(
            '.tp-chat-sidenav__body .tp-thread-list__button[title="Alpha notes"]'
          )?.parentElement
      )
    ).toBe(true);
    await expectRetainedThreadList();
    await expectRetainedCompact();
    await expect(beta).toHaveAttribute('aria-current', 'true');
    expect(backend.requests).toHaveLength(7);
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
