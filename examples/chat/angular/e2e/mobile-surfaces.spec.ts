import { expect, test } from '@playwright/test';
import { openDemo, selectToolbarOption, toolbarSelect } from './test-helpers';

test('mobile embed keeps a useful composer width and selects its model through the toolbar', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openDemo(page);
  const input = page.getByRole('textbox', { name: 'Type a message', exact: true });
  await expect(input).toBeVisible();
  await expect.poll(async () => (await input.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(140);
  await input.fill('Keep this draft while resizing');
  await selectToolbarOption(page, 'Model', 'gpt-5-nano');
  await expect(toolbarSelect(page, 'Model')).toContainText('gpt-5-nano');
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(page.locator('embed-mode chat-input chat-select .chat-select__trigger')).toBeVisible();
  await expect(page.locator('embed-mode chat-input chat-select .chat-select__trigger')).toContainText('gpt-5-nano');
  await expect(input).toHaveValue('Keep this draft while resizing');
  await page.setViewportSize({ width: 320, height: 640 });
  await expect(page.locator('embed-mode chat-input chat-select')).toHaveCount(0);
  await expect(input).toHaveValue('Keep this draft while resizing');
});

test('mobile toolbar controls preserve the selected theme and leave room for conversations', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openDemo(page);
  for (const field of ['Model', 'Effort', 'Gen UI', 'Theme']) {
    await expect(toolbarSelect(page, field)).toBeVisible();
  }
  await selectToolbarOption(page, 'Theme', 'Material light');
  await expect(toolbarSelect(page, 'Theme')).toHaveText(/Material light/);
  await page.reload();
  await expect(toolbarSelect(page, 'Theme')).toHaveText(/Material light/);
  await page
    .getByRole('button', { name: 'Open conversations', exact: true })
    .click();
  await expect
    .poll(async () => {
      const toolbar = await page
        .getByRole('toolbar', { name: 'Demo controls' })
        .boundingBox();
      const drawer = await page.locator('chat-sidenav').boundingBox();
      return (
        !!toolbar &&
        !!drawer &&
        drawer.height > 0 &&
        drawer.y >= toolbar.y + toolbar.height - 1 &&
        drawer.y + drawer.height <= 641 &&
        drawer.x >= 0 &&
        drawer.x + drawer.width <= 321
      );
    })
    .toBe(true);
});

for (const { width, blockIconFont } of [
  { width: 320, blockIconFont: false },
  { width: 390, blockIconFont: false },
  { width: 320, blockIconFont: true },
]) {
  test(`mobile popup promo keeps its image and complete caption at ${width}px${blockIconFont ? ' without the icon font' : ''}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 640 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    if (blockIconFont) {
      await page.route('https://fonts.googleapis.com/**', route => route.abort());
      await page.route('https://fonts.gstatic.com/**', route => route.abort());
    }
    await openDemo(page, '/popup');
    const promo = page.locator('app-mode-promo .promo');
    await expect(promo).toBeVisible();
    await expect
      .poll(() =>
        promo
          .locator('img')
          .evaluate(
            (image: HTMLImageElement) =>
              image.complete && image.naturalWidth > 0
          )
      )
      .toBe(true);
    const geometry = await promo.evaluate((element) => {
      const card = element.getBoundingClientRect();
      const parts = [
        ...element.querySelectorAll('.promo__eyebrow, h2, p, li, button'),
      ].map((part) => {
        const rect = part.getBoundingClientRect();
        return {
          text: part.textContent?.trim(),
          top: rect.top - card.top,
          bottom: rect.bottom - card.top,
          left: rect.left - card.left,
          right: rect.right - card.left,
        };
      });
      const image = element.querySelector('img');
      if (!image) throw new Error('Promo preview image is missing');
      const imageBox = image.getBoundingClientRect();
      return {
        width: card.width,
        height: card.height,
        parts,
        imageRatio: imageBox.width / imageBox.height,
        naturalRatio: image.naturalWidth / image.naturalHeight,
      };
    });
    for (const part of geometry.parts) {
      expect(
        part.top,
        `${part.text}: ${JSON.stringify(geometry)}`
      ).toBeGreaterThanOrEqual(0);
      expect(part.bottom).toBeLessThanOrEqual(geometry.height);
      expect(part.left).toBeGreaterThanOrEqual(0);
      expect(part.right).toBeLessThanOrEqual(geometry.width);
    }
    expect(geometry.imageRatio).toBeCloseTo(geometry.naturalRatio, 2);
    const action = promo.getByRole('button', { name: 'Enable app mode' });
    await action.scrollIntoViewIfNeeded();
    const actionBox = await action.boundingBox();
    if (!actionBox) throw new Error('Promo action has no visible bounds');
    const actionContainer = await promo.locator('.promo__action').boundingBox();
    if (!actionContainer) throw new Error('Promo action container has no visible bounds');
    expect(actionBox.x + actionBox.width).toBeLessThanOrEqual(
      actionContainer.x + actionContainer.width
    );
    expect(actionBox.height).toBeGreaterThanOrEqual(44);
    expect(actionBox.y).toBeGreaterThanOrEqual(0);
    // Scrolling rounds to device pixels while bounding boxes retain fractions.
    expect(actionBox.y + actionBox.height).toBeLessThanOrEqual(641);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(width);
  });
}

for (const mode of ['popup', 'sidebar']) {
  test(`mobile ${mode} keeps close reachable and preserves the draft through keyboard resizing`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 402, height: 714 });
    await page.goto(`/${mode}`);
    const launcher = page.getByRole('button', {
      name: 'Open chat',
      exact: true,
    });
    if (mode === 'popup') await launcher.click();
    const close = page.getByRole('button', { name: 'Close chat', exact: true });
    await close.click({ trial: true });
    const draft = page.getByRole('textbox', {
      name: 'Type a message',
      exact: true,
    });
    const geometry = await draft.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        width: box.width,
        height: box.height,
        inlineHeight: element.style.height,
        scrollHeight: element.scrollHeight,
        display: style.display,
        visibility: style.visibility,
      };
    });
    expect(geometry.height, JSON.stringify(geometry)).toBeGreaterThan(0);
    await draft.fill('A mobile draft with several wrapped lines. '.repeat(6).trimEnd());
    await page.evaluate(() => {
      const viewport = visualViewport!;
      Object.defineProperty(viewport, 'height', {
        configurable: true,
        value: 377,
      });
      Object.defineProperty(viewport, 'offsetTop', {
        configurable: true,
        value: 0,
      });
      viewport.dispatchEvent(new Event('resize'));
    });
    await expect(draft).toBeFocused();
    await expect
      .poll(async () => {
        const box = await draft.boundingBox();
        return !!box && box.y >= 0 && box.y + box.height <= 377;
      })
      .toBe(true);
    await close.click();
    await expect(launcher).toBeFocused();
    await launcher.click();
    await expect(draft).toHaveValue(
      'A mobile draft with several wrapped lines. '.repeat(6).trimEnd()
    );
    await expect(close).toBeFocused();
  });
}
