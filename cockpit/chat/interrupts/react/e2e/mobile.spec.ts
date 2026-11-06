import { expect, test } from '@playwright/test';

for (const height of [450, 812]) {
  for (const action of ['Confirm', 'Cancel']) {
    test(`mobile approval remains in transcript and completes: ${height}px ${action}`, async ({
      page,
      request,
    }) => {
      await request.post('/__reset');
      expect((await request.post('/__ready')).ok()).toBe(true);
      await page.setViewportSize({ width: 375, height });
      await page.goto('/chat/interrupts/react/');
      await page
        .getByRole('textbox', { name: 'Message', exact: true })
        .fill('Book padded flight.');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      const transcript = page.getByRole('region', {
        name: 'Conversation',
        exact: true,
      });
      const decision = transcript.getByRole('button', {
        name: action,
        exact: true,
      });
      await expect(decision).toBeEnabled();
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
      await expect(page.getByRole('status')).toHaveText('Response saved.');
      await expect(
        transcript.getByRole('button', { name: action, exact: true })
      ).toHaveCount(0);
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <= innerWidth && scrollY === 0
        )
      ).toBe(true);
      const wire = await (await request.get('/__requests')).json();
      expect(
        wire
          .filter((r: { path: string }) => r.path.endsWith('/runs/stream'))
          .map(
            (r: { body: { command?: { resume?: string } } }) =>
              r.body.command?.resume
          )
      ).toEqual([undefined, action === 'Confirm' ? 'confirm' : 'cancel']);
    });
  }
}
