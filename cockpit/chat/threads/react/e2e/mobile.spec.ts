import { expect, test } from '@playwright/test';

test('mobile A/B/A preserves drafts and a usable transcript after viewport reduction', async ({
  page,
  request,
}) => {
  await request.post('/__reset');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/chat/threads/react/');
  const input = () =>
    page.getByRole('textbox', { name: 'Message', exact: true });
  const transcript = page.getByRole('region', {
    name: 'Conversation',
    exact: true,
  });
  const picker = page
    .getByRole('navigation', { name: 'Conversations' })
    .getByRole('button');
  await input().fill('A first');
  await input().press('Enter');
  await expect(page.getByRole('status')).toHaveText('Response saved.');
  await input().fill('A mobile draft');
  await page
    .getByRole('button', { name: 'New conversation', exact: true })
    .click();
  await input().fill('B first');
  await input().press('Enter');
  await expect(page.getByRole('status')).toHaveText('Response saved.');
  await input().fill('B mobile draft');
  await picker.nth(0).click();
  await expect(page.getByRole('status')).toHaveText('Conversation loaded.');
  await expect(input()).toHaveValue('A mobile draft');
  await expect(transcript).toContainText('A first');
  await expect(transcript).not.toContainText('B first');
  await input().focus();
  await page.setViewportSize({ width: 375, height: 450 });
  await expect(input()).toBeFocused();
  await expect(input()).toHaveValue('A mobile draft');
  expect((await transcript.boundingBox())?.height).toBeGreaterThan(80);
  await picker.nth(1).click();
  await expect(page.getByRole('status')).toHaveText('Conversation loaded.');
  await expect(input()).toHaveValue('B mobile draft');
  await expect(transcript).toContainText('B first');
  await expect(transcript).not.toContainText('A first');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth && scrollY === 0
    )
  ).toBe(true);
});
