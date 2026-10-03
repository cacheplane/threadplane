import { test, expect } from '@playwright/test';

const topics = [
  {
    path: '/docs/langgraph/guides/deployment',
    react:
      /(?:localhost:4608(?:[/?#]|$)|\/langgraph\/deployment-runtime\/react\/?(?:[?#]|$))/,
    angular:
      /(?:localhost:4307(?:[/?#]|$)|\/langgraph\/deployment-runtime\/?(?:[?#]|$))/,
  },
  {
    path: '/docs/ag-ui/reference/event-mapping',
    react:
      /(?:localhost:4609(?:[/?#]|$)|\/ag-ui\/streaming\/react\/?(?:[?#]|$))/,
    angular: /(?:localhost:4321(?:[/?#]|$)|\/ag-ui\/streaming\/?(?:[?#]|$))/,
  },
];

for (const topic of topics) {
  test(`${topic.path} keeps rapid mode and frontend changes in browser history`, async ({
    page,
  }) => {
    const writes: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (
        !['GET', 'HEAD'].includes(request.method()) &&
        /\/agent(?:\/|$)|\/api\/native(?:\/|$)|\/threads(?:\/|$)/.test(
          new URL(request.url()).pathname
        )
      ) {
        writes.push(request.url());
      }
    });
    await page.goto(`${topic.path}?frontend=react`);
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
      'data-hydrated',
      'true'
    );

    const modeRequests: string[] = [];
    const documentRequests: string[] = [];
    page.on('request', (request) => {
      if (
        request.isNavigationRequest() &&
        request.frame() === page.mainFrame()
      ) {
        documentRequests.push(request.url());
      }
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        url.pathname === topic.path &&
        url.searchParams.has('_rsc') &&
        ['code', 'run'].includes(url.searchParams.get('mode') ?? '')
      ) {
        modeRequests.push(request.url());
        const completed = new Promise<void>((resolve) => {
          const done = (candidate: typeof request) => {
            if (candidate !== request) return;
            page.off('requestfinished', done);
            page.off('requestfailed', done);
            resolve();
          };
          page.on('requestfinished', done);
          page.on('requestfailed', done);
        });
        await gate;
        await route.continue();
        await completed;
      } else {
        await route.continue();
      }
    });

    try {
      const navigation = page.locator('[data-workspace-desktop-navigation]');
      await navigation
        .getByRole('button', { name: 'Code', exact: true })
        .click();
      await navigation.getByRole('button', { name: /^Run(?:,|$)/ }).click();
      await expect(page.locator('iframe')).toBeVisible();
      await page.getByLabel('Example UI').selectOption('angular');
      release();
      await page.unrouteAll({ behavior: 'wait' });

      await expect(page).toHaveURL(`${topic.path}?mode=run`);
      await expect(page.getByLabel('Example UI')).toHaveValue('angular');
      await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
        'data-workspace-mode',
        'Run'
      );
      await expect(page.locator('iframe')).toBeVisible();
      await expect(page.locator('iframe')).toHaveAttribute(
        'src',
        topic.angular
      );
      expect(modeRequests).toEqual([]);
      expect(documentRequests).toEqual([]);

      await page.goBack({ waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(`${topic.path}?mode=run&frontend=react`);
      await expect(page.getByLabel('Example UI')).toHaveValue('react');
      await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
        'data-workspace-mode',
        'Run'
      );
      await expect(page.locator('iframe')).toBeVisible();
      await expect(page.locator('iframe')).toHaveAttribute('src', topic.react);
      expect(documentRequests).toEqual([]);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(`${topic.path}?mode=run&frontend=react`);
      await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
        'data-workspace-mode',
        'Run'
      );
      await expect(page.locator('iframe')).toBeVisible();
      await expect(page.locator('iframe')).toHaveAttribute('src', topic.react);
    } finally {
      release();
      await page.unrouteAll({ behavior: 'wait' });
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
    }
  });
}
