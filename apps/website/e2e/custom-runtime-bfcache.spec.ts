import { expect, test, type Page } from '@playwright/test';

const LANGGRAPH_PATH = '/docs/angular/langgraph/guides/streaming';
const FIXTURE_ORIGIN = 'http://127.0.0.1:4399';
const FIXTURE_KEY = 'test-key-redact-me';

const desktopControlPlane = (page: Page) =>
  page.locator('[data-workspace-desktop-navigation]');

async function openSettings(page: Page): Promise<void> {
  await desktopControlPlane(page)
    .getByRole('button', { name: 'Settings', exact: true })
    .click();
  await expect(page.locator('[data-runtime-target-settings]')).toBeVisible();
}

test('clears its memory-only target on an actual persisted BFCache restore', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  await request.delete(`${FIXTURE_ORIGIN}/__bfcache`);
  await page.addInitScript(
    (fixture) => {
      addEventListener('pageshow', (event) => {
        if (event.persisted) {
          setTimeout(() => {
            const settings = document.querySelector(
              '[data-runtime-target-settings]'
            );
            const targetKind =
              settings?.getAttribute('data-runtime-target-kind') === 'shared'
                ? 'shared'
                : 'other';
            const sensitiveState = [
              location.href,
              JSON.stringify(history.state),
              JSON.stringify(localStorage),
              JSON.stringify(sessionStorage),
              document.cookie,
              document.documentElement.outerHTML,
            ].join('\n');
            const privacy = sensitiveState.includes(fixture.key)
              ? 'dirty'
              : 'clean';
            void fetch(`${fixture.origin}/__bfcache/${targetKind}/${privacy}`, {
              mode: 'no-cors',
              cache: 'no-store',
            });
          }, 0);
        }
      });
    },
    { origin: FIXTURE_ORIGIN, key: FIXTURE_KEY }
  );
  // Stay in Docs mode so no runtime iframe or pending child navigation can
  // make the top-level page ineligible for BFCache. The provider and Settings
  // lifecycle are mounted identically in Docs and Run.
  await page.goto(LANGGRAPH_PATH);
  await openSettings(page);
  const settings = page.locator('[data-runtime-target-settings]');
  await settings.getByRole('radio', { name: 'Custom LangSmith' }).check();
  await settings
    .locator('input[name="rtu"]')
    .fill(`${FIXTURE_ORIGIN}/case/bfcache/langgraph/success`);
  await settings.locator('input[name="rts"]').fill(FIXTURE_KEY);
  await settings.getByRole('button', { name: 'Use custom target' }).click();
  await expect(settings).toHaveAttribute(
    'data-runtime-target-kind',
    'langsmith'
  );
  const runtimeFrame = page.locator(
    'iframe[title="LangGraph Streaming live example"]'
  );
  await expect(runtimeFrame).toHaveAttribute(
    'src',
    /^http:\/\/localhost:4300\//
  );
  await expect(
    desktopControlPlane(page).getByRole('button', {
      name: /^Run, runtime ready$/,
    })
  ).toBeVisible({ timeout: 15_000 });
  // The lifecycle under test is the top-level memory provider. Detach the
  // already-proven child after its real handshake so Chromium does not reject
  // the top page merely because an embedded frame is still navigating.
  await runtimeFrame.evaluate((frame) => frame.remove());

  // A cross-site top-level navigation forces Chromium to create a distinct
  // browsing instance; same-site Next routes are intentionally not BFCache
  // candidates (`BrowsingInstanceNotSwapped`).
  await page.goto('http://localhost:4300/');
  // Playwright intentionally does not support BFCache restores because they
  // have no network navigation event. Trigger the browser history operation
  // natively and verify the persisted pageshow beacon out-of-band instead of
  // asking Playwright to synchronize to the restored page.
  await page.evaluate(() => history.back());
  await expect
    .poll(async () => {
      const response = await request.get(`${FIXTURE_ORIGIN}/__bfcache`);
      return response.json();
    })
    .toEqual({ persisted: true, targetKind: 'shared', privacy: 'clean' });
});
