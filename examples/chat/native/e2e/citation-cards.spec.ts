import { test } from './fixtures';
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';

test('installed custom citation cards retain metadata, preview lifetime and safe local presentation', async ({
  page,
  retainedConsumer,
}, testInfo) => {
  const { startProofServer, threadEnvelope } = await import(
    '../tooling/proof-server.mjs'
  );
  const { startCheckedServer } = await import('../tooling/retained-build.mjs');
  const a = threadEnvelope('a', 'Conversation A');
  const b = threadEnvelope('b', 'Conversation B');
  const sourceType = '<b>نوع المصدر</b> ' + 'مصدرطويل'.repeat(60);
  const answer = (corrected = false, removed = false) => ({
    id: 'answer',
    type: 'ai',
    content:
      'Answer [^sidecar].\n\n[^sidecar]: Sidecar [source](/card-sidecar) Sidecar snippet\n',
    additional_kwargs: {
      citations: [
        ...(removed
          ? []
          : [
              {
                id: '__proto__',
                index: 2,
                title: corrected ? 'Corrected provider' : '<b>Provider</b>',
                sourceType: corrected ? 'Corrected type' : sourceType,
                url: corrected
                  ? 'https://docs.example.org/card-corrected'
                  : 'https://www.example.com/card-provider',
                publishedAt: corrected
                  ? '2025-08-20T12:00:00.000Z'
                  : '2024-04-15T12:00:00.000Z',
                iconUrl: '/card-icon',
                snippet: '<script>literal()</script> ' + 'Long'.repeat(80),
              },
            ]),
        { id: 'empty', index: 3, title: 'Empty type', sourceType: '' },
        { id: 'absent', index: 4, title: 'Absent type' },
        {
          id: 'blocked',
          index: 5,
          title: 'Blocked source',
          url: 'javascript:alert(1)',
          publishedAt: 'invalid date',
          iconUrl: 'https://images.invalid/card-icon',
        },
        {
          id: 'blocked-host',
          index: 6,
          title: 'Blocked host',
          url: 'ftp://blocked.invalid/card-unsafe-host',
          publishedAt: 'invalid date',
        },
      ],
    },
  });
  const history = (id: string) => ({
    method: 'POST',
    path: `/api/threads/${id}/history`,
    payload: { limit: 10 },
    body: [
      {
        values: { messages: [answer()] },
        next: [],
        tasks: [],
        checkpoint: {
          thread_id: id,
          checkpoint_ns: '',
          checkpoint_id: 'saved',
        },
        parent_checkpoint: null,
        metadata: null,
        created_at: '2026-09-30T00:00:00.000Z',
      },
    ],
  });
  const run = (index: number) => ({
    method: 'POST',
    path: '/api/threads/a/runs/stream',
    holdHeaders: true,
    holdBody: true,
    events: [
      { event: 'values', data: { messages: [answer(true, index === 2)] } },
    ],
    assertPayload(payload: unknown) {
      const value = payload as {
        input: {
          messages: { id: string; type: string; content: string }[];
          client_tools: unknown[];
        };
        assistant_id: string;
        stream_mode: string[];
        stream_subgraphs: boolean;
        stream_resumable: boolean;
        on_disconnect: string;
      };
      assert.match(value.input.messages[0].id, /^[0-9a-f-]{36}$/i);
      assert.deepEqual(value.input.messages, [
        {
          id: value.input.messages[0].id,
          type: 'human',
          content: `Request ${index}`,
        },
      ]);
      assert.equal(value.assistant_id, 'assistant');
      assert.deepEqual(value.stream_mode, [
        'values',
        'messages-tuple',
        'updates',
        'custom',
        'checkpoints',
      ]);
      assert.equal(value.stream_subgraphs, true);
      assert.equal(value.stream_resumable, true);
      assert.equal(value.on_disconnect, 'continue');
      assert.equal(value.input.client_tools.length, 1);
    },
  });
  const backend = await startProofServer([
    {
      method: 'POST',
      path: '/api/threads/search',
      payload: { limit: 50, offset: 0 },
      body: [a, b],
    },
    { method: 'GET', path: '/api/threads/a', body: a },
    history('a'),
    run(1),
    run(2),
    { method: 'GET', path: '/api/threads/b', body: b },
    history('b'),
    { method: 'GET', path: '/api/threads/a', body: a },
    history('a'),
  ]);
  let server: Awaited<ReturnType<typeof startCheckedServer>> | undefined;
  const errors: string[] = [];
  const sourceRequests: string[] = [];
  const sourcePaths = new Set([
    '/card-provider',
    '/card-corrected',
    '/card-sidecar',
    '/card-icon',
    '/card-unsafe-host',
  ]);
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    server = await startCheckedServer({
      retained: retainedConsumer,
      target: backend.origin + '/api',
    });
    const origin = server.url;
    const [published, correctedPublished] = await page.evaluate(() =>
      ['2024-04-15T12:00:00.000Z', '2025-08-20T12:00:00.000Z'].map((value) =>
        new Date(value).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
        })
      )
    );
    await page.route('**/*', (route) => {
      const requested = new URL(route.request().url());
      // Source and icon destinations are forbidden even on this server's origin.
      if (
        sourcePaths.has(requested.pathname) ||
        [
          'images.invalid',
          'www.example.com',
          'docs.example.org',
          'blocked.invalid',
        ].includes(requested.hostname)
      ) {
        sourceRequests.push(route.request().url());
        return route.abort();
      }
      if (requested.origin === origin) return route.continue();
      errors.push(`Unexpected external request: ${route.request().url()}`);
      return route.abort();
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(origin + '/?thread=a');
    const draft = page.getByLabel('Message', { exact: true });
    await expect(draft).toBeEnabled();
    await draft.fill('Retained custom card draft');
    const textarea = await draft.elementHandle();
    assert.ok(textarea);
    const panel = page.getByRole('region', { name: 'Sources', exact: true });
    const header = panel.getByRole('button', { name: /^Sources \(/ });
    const wrappers = panel.locator('.native-source-card');
    const provider = panel.locator(
      '.native-source-card[data-source-id="__proto__"]'
    );
    const trigger = provider.getByRole('button', {
      name: /^Preview source 2:/,
    });
    const dialog = page.getByRole('dialog', { name: 'Source 2', exact: true });
    const close = dialog.getByRole('button', { name: 'Close', exact: true });
    const retained = async (requests: number) => {
      expect(backend.requests).toHaveLength(requests);
      await expect(draft).toHaveValue('Retained custom card draft');
      expect(
        await textarea.evaluate(
          (node) => node === document.querySelector('#message')
        )
      ).toBe(true);
    };
    await expect(header).toHaveText('Sources (6)');
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await expect(wrappers).toHaveCount(0);
    await header.click();
    // Preserve the existing custom card composition before checking derived metadata.
    await expect(wrappers).toHaveCount(6);
    expect(
      await wrappers.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-source-id'))
      )
    ).toEqual([
      'sidecar',
      '__proto__',
      'empty',
      'absent',
      'blocked',
      'blocked-host',
    ]);
    await expect(provider.locator('.native-source-card__type')).toHaveText(
      `Source type: ${sourceType}`
    );
    await expect(panel.locator('[data-source-id="empty"] small')).toHaveText(
      'Source type: '
    );
    await expect(panel.locator('[data-source-id="absent"] small')).toHaveCount(
      0
    );
    await expect(panel.locator('[data-source-id="sidecar"] small')).toHaveCount(
      0
    );
    await expect(provider.locator('.native-source-card__host')).toHaveText(
      'Host: example.com'
    );
    await expect(provider.locator('.native-source-card__published')).toHaveText(
      `Published: ${published}`
    );
    for (const id of ['sidecar', 'empty', 'absent', 'blocked']) {
      await expect(
        panel.locator(`[data-source-id="${id}"] .native-source-card__host`)
      ).toHaveCount(0);
      await expect(
        panel.locator(`[data-source-id="${id}"] .native-source-card__published`)
      ).toHaveCount(0);
    }
    await expect(
      panel.locator('[data-source-id="blocked-host"] .native-source-card__host')
    ).toHaveText('Host: blocked.invalid');
    await expect(
      panel.locator(
        '[data-source-id="blocked-host"] .native-source-card__published'
      )
    ).toHaveCount(0);
    await expect(panel.locator('img,script,b')).toHaveCount(0);
    await retained(3);
    await trigger.focus();
    await page.keyboard.press('Control+Enter');
    await expect(dialog).toHaveCount(0);
    await trigger.evaluate((node) => {
      const claimed = (event: Event) => event.preventDefault();
      node.addEventListener('keydown', claimed, { capture: true, once: true });
    });
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(close).toBeFocused();
    await expect(dialog).toContainText('<script>literal()</script>');
    await expect(dialog).toContainText('2024-04-15T12:00:00.000Z');
    await expect(dialog.locator('img,script,b')).toHaveCount(0);
    const link = dialog.getByRole('link', { name: 'Open source', exact: true });
    await expect(link).toHaveAttribute(
      'href',
      'https://www.example.com/card-provider'
    );
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await page.keyboard.press('Tab');
    await expect(link).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Space');
    await expect(close).toBeFocused();
    await close.click();
    await panel
      .getByRole('button', {
        name: 'Preview source 5: Blocked source',
        exact: true,
      })
      .click();
    const blocked = page.getByRole('dialog', { name: 'Source 5', exact: true });
    await expect(blocked).toContainText('javascript:alert(1)');
    await expect(blocked.getByRole('link')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await panel
      .getByRole('button', {
        name: 'Preview source 6: Blocked host',
        exact: true,
      })
      .click();
    const blockedHost = page.getByRole('dialog', {
      name: 'Source 6',
      exact: true,
    });
    await expect(blockedHost).toContainText(
      'ftp://blocked.invalid/card-unsafe-host'
    );
    await expect(blockedHost.getByRole('link')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await retained(3);
    const retired = await provider.elementHandle();
    const retiredTrigger = await trigger.elementHandle();
    assert.ok(retired && retiredTrigger);
    await header.click();
    await expect(wrappers).toHaveCount(0);
    expect(await retired.evaluate((node) => node.isConnected)).toBe(false);
    await retiredTrigger.evaluate((node) =>
      (node as HTMLButtonElement).click()
    );
    await expect(dialog).toHaveCount(0);
    await retained(3);
    await header.click();
    // Scope dark tokens to Sources while the surrounding host keeps its white surface.
    await panel.evaluate((node) => {
      node.style.setProperty('--tp-chat-text', '#f5f5f5');
      node.style.setProperty('--tp-chat-surface', '#1c1c1c');
      node.style.setProperty('--tp-chat-border', '#454545');
    });
    await expect(provider).toHaveCSS('color', 'rgb(245, 245, 245)');
    await expect(provider).toHaveCSS('background-color', 'rgb(28, 28, 28)');
    await expect(provider).toHaveCSS('border-color', 'rgb(69, 69, 69)');
    await expect(provider.locator('.native-source-card__type')).toHaveCSS(
      'color',
      'rgb(245, 245, 245)'
    );
    const contrast = await provider.evaluate((node) => {
      const style = getComputedStyle(node);
      const luminance = (color: string) => {
        const channels = color
          .match(/[\d.]+/g)
          ?.slice(0, 3)
          .map(Number);
        if (!channels || channels.length !== 3)
          throw new Error('Expected computed RGB color');
        const [r, g, b] = channels.map((channel) => {
          const value = channel / 255;
          return value <= 0.04045
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const foreground = luminance(style.color);
      const background = luminance(style.backgroundColor);
      return (
        (Math.max(foreground, background) + 0.05) /
        (Math.min(foreground, background) + 0.05)
      );
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    await panel.screenshot({
      path: testInfo.outputPath('citation-cards-scoped-dark.png'),
    });
    await page
      .locator('html')
      .evaluate((node) => node.setAttribute('dir', 'rtl'));
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await provider.scrollIntoViewIfNeeded();
      for (const card of await wrappers.all()) {
        const box = await card.boundingBox();
        assert.ok(box);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(
          await card.evaluate((node) => node.scrollWidth <= node.clientWidth)
        ).toBe(true);
      }
      await page.screenshot({
        path: testInfo.outputPath(`citation-cards-rtl-${width}.png`),
      });
      await retained(3);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page
      .locator('html')
      .evaluate((node) => node.setAttribute('dir', 'ltr'));
    const originalWrapper = await provider.elementHandle();
    const originalItem = await trigger.evaluateHandle((node) =>
      node.closest('li')
    );
    const originalTrigger = await trigger.elementHandle();
    assert.ok(originalWrapper && originalTrigger);
    for (const index of [1, 2]) {
      await draft.fill(`Request ${index}`);
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      const step = backend.steps[index + 2];
      await step.received;
      await trigger.click();
      const open = await dialog.elementHandle();
      assert.ok(open);
      step.releaseHeaders();
      if (index === 1) {
        await expect(trigger).toHaveAttribute(
          'aria-label',
          'Preview source 2: Corrected provider'
        );
        await expect(provider.locator('.native-source-card__type')).toHaveText(
          'Source type: Corrected type'
        );
        await expect(dialog.getByRole('heading')).toHaveText(
          'Corrected provider'
        );
        await expect(link).toHaveAttribute(
          'href',
          'https://docs.example.org/card-corrected'
        );
        await expect(provider.locator('.native-source-card__host')).toHaveText(
          'Host: docs.example.org'
        );
        await expect(
          provider.locator('.native-source-card__published')
        ).toHaveText(`Published: ${correctedPublished}`);
        await expect(dialog).toContainText('2025-08-20T12:00:00.000Z');
        expect(
          await provider.evaluate(
            (node, original) => node === original,
            originalWrapper
          )
        ).toBe(true);
        expect(
          await trigger.evaluate(
            (node, original) => node.closest('li') === original,
            originalItem
          )
        ).toBe(true);
        expect(
          await open.evaluate(
            (node) => node === document.querySelector('dialog[open]')
          )
        ).toBe(true);
        await close.click();
        step.releaseBody();
      } else {
        // Later historical values remain interim until canonical acceptance at EOF.
        await step.headersSent;
        await expect(trigger).toHaveAttribute(
          'aria-label',
          'Preview source 2: Corrected provider'
        );
        await expect(provider.locator('.native-source-card__type')).toHaveText(
          'Source type: Corrected type'
        );
        expect(
          await trigger.evaluate(
            (node, original) => node.closest('li') === original,
            originalItem
          )
        ).toBe(true);
        step.releaseBody();
        await expect(provider).toHaveCount(0);
        await expect(dialog).toHaveCount(0);
        expect(await originalWrapper.evaluate((node) => node.isConnected)).toBe(
          false
        );
        expect(await open.evaluate((node) => node.isConnected)).toBe(false);
        await originalTrigger.evaluate((node) =>
          (node as HTMLButtonElement).click()
        );
        await expect(dialog).toHaveCount(0);
        await expect(header).toHaveText('Sources (5)');
      }
      await step.closed;
      await expect(draft).toBeEnabled();
      await expect(draft).toHaveValue('');
      await draft.fill('Retained custom card draft');
      await retained(index + 3);
      await expect(header).toHaveAttribute('aria-expanded', 'true');
    }
    const oldHeader = await header.elementHandle();
    assert.ok(oldHeader);
    let previousTextarea = textarea;
    for (const [thread, count] of [
      ['b', 7],
      ['a', 9],
    ] as const) {
      await page.evaluate((thread) => {
        const next = new URL(location.href);
        next.searchParams.set('thread', thread);
        history.pushState(null, '', next);
        dispatchEvent(new PopStateEvent('popstate'));
      }, thread);
      await backend.steps[count - 1].received;
      await expect(page.locator('.conversation-id')).toHaveText(
        `Conversation ID: ${thread}`
      );
      await expect(header).toHaveAttribute('aria-expanded', 'false');
      await expect(wrappers).toHaveCount(0);
      await expect(draft).toBeEnabled();
      await expect(draft).toHaveValue('');
      expect(await previousTextarea.evaluate((node) => node.isConnected)).toBe(
        false
      );
      const freshTextarea = await draft.elementHandle();
      assert.ok(freshTextarea);
      expect(
        await freshTextarea.evaluate(
          (node, old) => node !== old,
          previousTextarea
        )
      ).toBe(true);
      previousTextarea = freshTextarea;
      await draft.fill(`Draft for ${thread}`);
      expect(backend.requests).toHaveLength(count);
    }
    await oldHeader.evaluate((node) => (node as HTMLButtonElement).click());
    await originalTrigger.evaluate((node) =>
      (node as HTMLButtonElement).click()
    );
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await expect(dialog).toHaveCount(0);
    await expect(draft).toHaveValue('Draft for a');
    expect(sourceRequests).toEqual([]);
    expect(errors).toEqual([]);
    backend.verify();
    for (const step of backend.steps)
      expect((await step.closed).finished).toBe(true);
  } finally {
    await page.close();
    await server?.close();
    await backend.close();
  }
});
