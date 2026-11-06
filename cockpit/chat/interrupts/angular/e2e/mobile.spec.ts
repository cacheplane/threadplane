import { expect, test } from '@playwright/test';

for (const height of [450, 812]) {
  for (const action of ['Accept', 'Ignore']) {
    test(`mobile approval stays in transcript and completes: ${height}px ${action}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 375, height });
      await page.goto('/');
      await page
        .getByRole('textbox', { name: 'Type a message', exact: true })
        .fill(action === 'Accept' ? 'Book me on UA123.' : 'Book me on AA404.');
      await page
        .getByRole('button', { name: 'Send message', exact: true })
        .click();
      const transcript = page.getByRole('region', {
        name: 'Conversation',
        exact: true,
      });
      const decision = transcript.getByRole('button', {
        name: action,
        exact: true,
      });
      await expect(decision).toBeEnabled({ timeout: 30000 });
      await decision.scrollIntoViewIfNeeded();
      expect(
        await decision.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return el.contains(
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
          );
        })
      ).toBe(true);
      await decision.click();
      await expect(
        transcript.locator('chat-message[data-role="assistant"]').last()
      ).toContainText(action === 'Accept' ? /booked/i : /cancel/i, {
        timeout: 30000,
      });
      await expect(decision).toHaveCount(0);
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <= innerWidth && scrollY === 0
        )
      ).toBe(true);
    });
  }
}
