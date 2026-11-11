import { test, expect } from '@playwright/test';

test.describe('cockpit interrupts: refund approval', () => {
  test('approval card displays structured payload fields', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Refund a duplicate charge').click();
    const panel = page.locator('.chat-approval-card--inline');
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel).toContainText('Refund approval required');
  });

  test('Approve issues the refund and the run finishes', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Refund a duplicate charge').click();
    const panel = page.locator('.chat-approval-card--inline');
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await panel.getByRole('button', { name: 'Issue refund' }).click();
    // The answered panel shrinks to a one-line record in the transcript.
    await expect(page.locator('.chat-approval-record')).toHaveText(/Approved: Issue refund/);
    await expect(panel).toHaveCount(0);
    await expect(page.getByText(/Refund of \$/i)).toBeVisible({ timeout: 20_000 });
  });

  test('Cancel skips the refund and confirms cancellation', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Refund a duplicate charge').click();
    const panel = page.locator('.chat-approval-card--inline');
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await panel.getByRole('button', { name: "Don't refund" }).click();
    await expect(page.locator('.chat-approval-record')).toHaveText(/Declined: Issue refund/);
    await expect(page.getByText(/Refund cancelled by operator/i)).toBeVisible({ timeout: 20_000 });
  });
});
