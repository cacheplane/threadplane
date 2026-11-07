import { test, expect } from '@playwright/test';

test.describe('Blog landing page', () => {
  test('renders brand header + tag filter + at least one post card', async ({
    page,
  }) => {
    await page.goto('/blog');

    await expect(
      page.getByRole('heading', {
        level: 1,
        name: /Notes from the flight deck/i,
      })
    ).toBeVisible();

    await page.locator('.blog-topic-picker summary').click();
    // The topic picker contains the "All" chip in active state.
    await expect(page.getByText('All', { exact: true })).toBeVisible();

    // At least one post link rendered
    await expect(page.locator('a[href^="/blog/"]').first()).toBeVisible();
  });

  test('clicking a tag chip filters the list via ?tag=', async ({ page }) => {
    await page.goto('/blog');
    await page.locator('.blog-topic-picker summary').click();

    // Click the "tutorial" chip — assumes at least one post is tagged tutorial.
    await page
      .getByRole('link', { name: 'tutorial', exact: true })
      .first()
      .click();

    // URL reflects the filter
    await expect(page).toHaveURL(/[?&]tag=tutorial(&|$)/);

    // The active chip uses aria-current=page
    await expect(
      page.locator('[aria-current="page"]').filter({ hasText: 'tutorial' })
    ).toBeVisible();
  });

  test('unknown tag renders empty state with a view-all link', async ({
    page,
  }) => {
    await page.goto('/blog?tag=__no_such_tag__');

    await expect(page.getByText(/No posts tagged/i)).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'View all posts' })
    ).toBeVisible();
  });
});
