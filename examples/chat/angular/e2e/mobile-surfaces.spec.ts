import { expect, test } from '@playwright/test';

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
    await draft.fill('A mobile draft with several wrapped lines. '.repeat(6));
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
      'A mobile draft with several wrapped lines. '.repeat(6)
    );
    await expect(close).toBeFocused();
  });
}
