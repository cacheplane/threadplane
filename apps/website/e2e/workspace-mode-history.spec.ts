import { test, expect } from '@playwright/test';
import { frameworkControl } from './fixtures/framework-controls';

const topics = [
  {
    path: '/docs/angular/langgraph/guides/deployment',
    reactPath: '/docs/react/langgraph/guides/deployment',
    react:
      /(?:localhost:4608(?:[/?#]|$)|\/langgraph\/deployment-runtime\/react\/?(?:[?#]|$))/,
    angular:
      /(?:localhost:4307(?:[/?#]|$)|\/langgraph\/deployment-runtime\/?(?:[?#]|$))/,
  },
  {
    path: '/docs/angular/ag-ui/reference/event-mapping',
    reactPath: '/docs/react/ag-ui/reference/event-mapping',
    react:
      /(?:localhost:4609(?:[/?#]|$)|\/ag-ui\/streaming\/react\/?(?:[?#]|$))/,
    angular: /(?:localhost:4321(?:[/?#]|$)|\/ag-ui\/streaming\/?(?:[?#]|$))/,
  },
  {
    path: '/docs/angular/chat/guides/client-tools',
    reactPath: '/docs/react/chat/guides/client-tools',
    hash: '#booking-decisions-and-ownership',
    react:
      /(?:localhost:4603(?:[/?#]|$)|\/langgraph\/client-tools\/react\/?(?:[?#]|$))/,
    angular:
      /(?:localhost:4308(?:[/?#]|$)|\/langgraph\/client-tools\/?(?:[?#]|$))/,
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
    const hash = topic.hash ?? '';
    await page.goto(`${topic.reactPath}${hash}`);
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
        url.pathname === topic.reactPath &&
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
      await (await frameworkControl(page)).selectOption('angular');
      release();
      await page.unrouteAll({ behavior: 'wait' });

      await expect(page).toHaveURL(`${topic.path}?mode=run`);
      await expect(page.getByLabel('Framework')).toHaveValue('angular');
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
      await expect(page).toHaveURL(
        `${topic.reactPath}?mode=run${hash}`
      );
      await expect(page.getByLabel('Framework')).toHaveValue('react');
      await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
        'data-workspace-mode',
        'Run'
      );
      await expect(page.locator('iframe')).toBeVisible();
      await expect(page.locator('iframe')).toHaveAttribute('src', topic.react);
      expect(documentRequests).toEqual([]);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(
        `${topic.reactPath}?mode=run${hash}`
      );
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
