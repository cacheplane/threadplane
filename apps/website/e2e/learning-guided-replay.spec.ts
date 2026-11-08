import { expect, test } from '@playwright/test';

for (const framework of ['react', 'angular'] as const) {
  for (const width of [1440, 390]) {
    test(`${framework} learns messages, responses, and turns after Quickstart at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const runtimeRequests: string[] = [];
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (['4300', '4600', '4399'].includes(url.port) ||
            /\/runs\/stream(?:\?|$)/.test(request.url())) {
          runtimeRequests.push(request.url());
        }
      });

      await page.goto(`/docs/${framework}/getting-started/quickstart`);
      await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-hydrated', 'true');
      await page.getByRole('link', { name: 'Learn about turns', exact: true }).click();
      await expect(page).toHaveURL(`/docs/${framework}/getting-started/workbench`);
      await expect(page.getByRole('heading', { name: 'Messages, responses, and turns', exact: true })).toBeVisible();
      const host = page.locator('[data-workspace-shell] .tp-learn-host');
      const guide = host.getByRole('region', { name: 'Guided replay lesson' });
      const explanation = host.getByRole('region', { name: 'What to notice' });
      const turn = explanation.locator('.tp-learn-lesson-facts dd').last();
      await expect(guide).toBeVisible();
      await expect(explanation).toBeVisible();
      await expect(page.locator('.docs-prose video')).toHaveCount(0);
      expect(await host.evaluate(element => Boolean(
        element.compareDocumentPosition(document.querySelector('.docs-prose h2')!) & Node.DOCUMENT_POSITION_FOLLOWING
      ))).toBe(true);
      for (const step of await guide.getByRole('button').all()) {
        expect((await step.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      }
      await expect(host.locator('iframe')).toHaveCount(0);
      await expect(guide.getByRole('button', { name: '1. User message', exact: true })).toHaveAttribute('aria-current', 'step');
      await expect(host.locator('.tp-learn-message-user')).toHaveCount(1);
      await expect(host.getByRole('group', { name: 'Inspector view' })).toBeHidden();
      await expect(host.getByRole('button', { name: 'Play recording', exact: true })).toBeHidden();
      const firstNext = host.getByRole('button', { name: 'Next: turn in progress', exact: true });
      expect((await firstNext.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      await firstNext.click();
      await expect(guide.getByRole('button', { name: '2. Turn in progress', exact: true })).toHaveAttribute('aria-current', 'step');
      await expect(turn).toContainText(/progress|working/i);

      await host.getByRole('button', { name: 'Next: assistant response', exact: true }).click();
      await expect(guide.getByRole('button', { name: '3. Assistant response', exact: true })).toHaveAttribute('aria-current', 'step');
      await host.getByRole('button', { name: 'Inspect data', exact: true }).click();
      const messages = async () => JSON.parse(await host.getByLabel('Messages JSON').innerText()) as { id: string; role: string; text: string }[];
      const state = async () => {
        const snapshot = JSON.parse(await host.getByLabel('Application state JSON').innerText());
        return snapshot.application ?? snapshot;
      };
      const first = (await messages()).find(message => message.role === 'assistant')!;
      expect(first.text.length).toBeGreaterThan(0);
      const partialCursor = await host.getByRole('slider', { name: 'Observation', exact: true }).inputValue();
      await host.getByRole('button', { name: 'Hide data', exact: true }).click();
      await expect(host.getByRole('group', { name: 'Inspector view' })).toBeHidden();
      await host.getByRole('button', { name: 'Show next response update', exact: true }).click();
      await host.getByRole('button', { name: 'Inspect data', exact: true }).click();
      const next = (await messages()).find(message => message.role === 'assistant')!;
      expect(next.id).toBe(first.id);
      expect(next.text.length).toBeGreaterThan(first.text.length);
      expect(await messages()).toHaveLength(2);
      expect(Number(await host.getByRole('slider', { name: 'Observation', exact: true }).inputValue())).toBeGreaterThan(Number(partialCursor));

      await host.getByRole('button', { name: 'Next: turn outcome', exact: true }).click();
      await expect(host.getByRole('group', { name: 'Inspector view' })).toBeVisible();
      await host.getByRole('button', { name: 'JSON', exact: true }).click();
      expect(await state()).toMatchObject({ busy: false, outcome: 'success' });
      await expect(turn).toContainText(/success|complete/i);
      await host.getByRole('button', { name: 'Previous observation', exact: true }).click();
      expect(await state()).toMatchObject({ busy: true, outcome: 'success' });
      await expect(turn).toContainText(/progress|working/i);
      await expect(guide.getByRole('button', { name: '3. Assistant response', exact: true })).toHaveAttribute('aria-current', 'step');

      await host.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(guide.getByRole('button', { name: '2. Turn in progress', exact: true })).toHaveAttribute('aria-current', 'step');
      await host.getByRole('button', { name: 'Restart lesson', exact: true }).click();
      await expect(guide.getByRole('button', { name: '1. User message', exact: true })).toHaveAttribute('aria-current', 'step');
      if (await host.getByRole('button', { name: 'Inspect data', exact: true }).isVisible()) {
        await host.getByRole('button', { name: 'Inspect data', exact: true }).click();
      }
      const cursor = await host.getByRole('slider', { name: 'Observation', exact: true }).inputValue();
      await host.getByRole('button', { name: 'View example source', exact: true }).click();
      await expect(host.getByLabel('Lesson source code')).toContainText(framework === 'react' ? 'useAgent(application)' : 'injectAgent(STREAMING_AGENT)');
      await host.getByRole('button', { name: 'Return to recorded example', exact: true }).click();
      await expect(host.getByRole('slider', { name: 'Observation', exact: true })).toHaveValue(cursor);
      await expect(host.getByRole('group', { name: 'Inspector view' })).toBeVisible();
      if (width >= 1024) {
        const separator = host.getByRole('separator', { name: 'Resize conversation and explanation', exact: true });
        const before = Number(await separator.getAttribute('aria-valuenow'));
        await separator.focus();
        await page.keyboard.press('ArrowRight');
        await expect(separator).toHaveAttribute('aria-valuenow', String(before + 4));
        await page.keyboard.press('Home');
      }
      await expect(host.locator('iframe')).toHaveCount(0);
      expect(runtimeRequests).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    });
  }
}
