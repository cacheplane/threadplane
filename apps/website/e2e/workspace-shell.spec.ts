import { expect, test, type Locator, type Page } from '@playwright/test';

const streamingDocsPath = '/docs/langgraph/guides/streaming';
const persistenceDocsPath = '/docs/langgraph/guides/persistence';
const mappedDocsOnlyPath = '/docs/langgraph/getting-started/introduction';
const unmappedDocsOnlyPath = '/docs/langgraph/getting-started/installation';
const durableExecutionDocsPath = '/docs/langgraph/guides/durable-execution';
const RUN_RAIL_ITEM = /^Run(?:,|$)/;

declare global {
  interface Window {
    __websiteAboutBlankMounted?: boolean;
    __websiteRuntimePhases?: string[];
  }
}

const modeButton = (page: Page, mode: 'Docs' | 'Run' | 'Code' | 'API') =>
  page.locator('[data-workspace-desktop-navigation]').getByRole('button', {
    name: mode === 'Run' ? RUN_RAIL_ITEM : mode,
    exact: mode !== 'Run',
  });

const visiblePanel = (page: Page, mode: 'Docs' | 'Run' | 'Code' | 'API') =>
  page.locator(`[data-workspace-panel-target="${mode}"]`).filter({
    visible: true,
  });

async function expectMode(page: Page, mode: 'Docs' | 'Run' | 'Code' | 'API') {
  const shell = page.locator('[data-workspace-shell]');
  await expect(shell).toHaveAttribute('data-hydrated', 'true');
  await expect(shell).toHaveAttribute('data-workspace-mode', mode);
  await expect(visiblePanel(page, mode)).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  );
  expect(overflow, label).toBeLessThanOrEqual(1);
}

async function markRuntimeFrame(frame: Locator) {
  await frame.evaluate((element) => {
    element.setAttribute('data-e2e-runtime-frame', crypto.randomUUID());
  });
  return frame.getAttribute('data-e2e-runtime-frame');
}

async function installRuntimeObservation(page: Page) {
  await page.addInitScript(() => {
    window.__websiteAboutBlankMounted = false;
    window.__websiteRuntimePhases = [];

    const recordPhase = (phase: string | null) => {
      if (phase && !window.__websiteRuntimePhases?.includes(phase)) {
        window.__websiteRuntimePhases?.push(phase);
      }
    };
    const inspectElement = (element: Element) => {
      const frames = element.matches('iframe')
        ? [element]
        : Array.from(element.querySelectorAll('iframe'));
      for (const frame of frames) {
        if (frame.getAttribute('src') === 'about:blank') {
          window.__websiteAboutBlankMounted = true;
        }
      }
      const statuses = element.matches('[data-runtime-phase]')
        ? [element]
        : Array.from(element.querySelectorAll('[data-runtime-phase]'));
      for (const status of statuses) {
        recordPhase(status.getAttribute('data-runtime-phase'));
      }
    };
    const inspectCurrent = () => {
      for (const element of document.querySelectorAll(
        'iframe, [data-runtime-phase]'
      )) {
        inspectElement(element);
      }
    };

    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes' && record.target instanceof Element) {
          if (
            record.attributeName === 'src' &&
            record.target.matches('iframe') &&
            record.oldValue === 'about:blank'
          ) {
            window.__websiteAboutBlankMounted = true;
          }
          if (record.attributeName === 'data-runtime-phase') {
            recordPhase(record.oldValue);
          }
          inspectElement(record.target);
        } else if (record.type === 'childList') {
          for (const node of record.addedNodes) {
            if (node instanceof Element) inspectElement(node);
          }
        }
      }
      inspectCurrent();
    }).observe(document, {
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ['src', 'data-runtime-phase'],
      childList: true,
      subtree: true,
    });
    inspectCurrent();
    document.addEventListener('DOMContentLoaded', inspectCurrent, {
      once: true,
    });
  });
}

test.describe('workspace shell', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const hideDevelopmentIndicator = () => {
        document
          .querySelectorAll<HTMLElement>('nextjs-portal')
          .forEach((portal) => {
            portal.style.setProperty('display', 'none', 'important');
          });
      };
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          hideDevelopmentIndicator();
          new MutationObserver(hideDevelopmentIndicator).observe(
            document.documentElement,
            { childList: true, subtree: true }
          );
        },
        { once: true }
      );
    });
  });
  test('moves Docs to Run to Code to API to Docs without replacing the runtime frame', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(streamingDocsPath);
    await expectMode(page, 'Docs');

    await modeButton(page, 'Run').click();
    await expect(page).toHaveURL(`${streamingDocsPath}?mode=run`);
    await expectMode(page, 'Run');
    await expect(page.getByText('Ready', { exact: true })).toBeVisible();

    const frame = page.locator(
      'iframe[title="LangGraph Streaming live example"]'
    );
    await expect(frame).toBeVisible();
    const frameIdentity = await markRuntimeFrame(frame);
    expect(frameIdentity).toBeTruthy();

    for (const mode of ['Code', 'API', 'Docs'] as const) {
      await modeButton(page, mode).click();
      await expect(page).toHaveURL(
        mode === 'Docs'
          ? streamingDocsPath
          : `${streamingDocsPath}?mode=${mode.toLowerCase()}`
      );
      await expectMode(page, mode);
      await expect(
        page.locator(`iframe[data-e2e-runtime-frame="${frameIdentity}"]`)
      ).toBeAttached();
    }
  });

  test('runtime observer captures transient blank and unresponsive mutations', async ({
    page,
  }) => {
    await installRuntimeObservation(page);
    await page.goto(streamingDocsPath);

    await page.evaluate(() => {
      const frame = document.createElement('iframe');
      frame.src = 'about:blank';
      document.body.append(frame);
      frame.src = 'https://runtime.test/ready';

      const status = document.createElement('span');
      status.setAttribute('data-runtime-phase', 'ready');
      document.body.append(status);
      status.setAttribute('data-runtime-phase', 'unresponsive');
      status.setAttribute('data-runtime-phase', 'ready');
    });

    await expect
      .poll(() => page.evaluate(() => window.__websiteAboutBlankMounted))
      .toBe(true);
    await expect
      .poll(() => page.evaluate(() => window.__websiteRuntimePhases))
      .toContain('unresponsive');
  });

  test('reports Ready and Recheck activity without blank or unresponsive runtime phases', async ({
    page,
  }) => {
    await installRuntimeObservation(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${streamingDocsPath}?mode=run`);
    await expectMode(page, 'Run');
    await expect(page.getByText('Ready', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__websiteAboutBlankMounted)).toBe(
      false
    );
    expect(
      await page.evaluate(() => window.__websiteRuntimePhases)
    ).not.toContain('unresponsive');

    await page.getByRole('button', { name: 'Activity', exact: true }).click();
    await expect(
      page.locator('[data-activity-kind="runtime_check_requested"]')
    ).toHaveCount(1);
    await expect(
      page.locator('[data-activity-kind="runtime_ready"]')
    ).toHaveCount(1);
    await page.getByRole('button', { name: 'Close Activity' }).click();

    await page.getByRole('button', { name: 'Recheck' }).click();
    await expect(page.getByText('Ready', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Activity', exact: true }).click();
    await expect(
      page.locator('[data-activity-kind="runtime_check_requested"]')
    ).toHaveCount(2);
    await expect(
      page.locator('[data-activity-kind="runtime_ready"]')
    ).toHaveCount(2);
    expect(
      await page.evaluate(() => window.__websiteRuntimePhases)
    ).not.toContain('unresponsive');
  });

  test('restores mode and capability navigation through Back and Forward', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(streamingDocsPath);
    const shell = page.locator('[data-workspace-shell]');
    await shell.evaluate((element) => {
      element.setAttribute('data-e2e-shell-lifetime', 'original');
    });

    await modeButton(page, 'Run').click();
    await expect(page).toHaveURL(`${streamingDocsPath}?mode=run`);
    await expectMode(page, 'Run');
    await modeButton(page, 'Code').click();
    await expect(page).toHaveURL(`${streamingDocsPath}?mode=code`);
    await expectMode(page, 'Code');

    await page.goBack();
    await expect(page).toHaveURL(`${streamingDocsPath}?mode=run`);
    await expectMode(page, 'Run');
    await page.goForward();
    await expect(page).toHaveURL(`${streamingDocsPath}?mode=code`);
    await expectMode(page, 'Code');

    await page.getByRole('link', { name: 'Persistence', exact: true }).click();
    await expect(page).toHaveURL(persistenceDocsPath);
    await expectMode(page, 'Docs');
    await expect(shell).toHaveAttribute('data-e2e-shell-lifetime', 'original');
    await page
      .locator('[data-workspace-desktop-navigation]')
      .getByRole('button', { name: 'Activity', exact: true })
      .click();
    await expect(page.getByText('Mode changed to Code')).toBeVisible();
    await expect(
      page.locator('[data-activity-capability]').first()
    ).toContainText('streaming');
    await page
      .locator('[data-workspace-desktop-navigation]')
      .getByRole('button', { name: 'Activity', exact: true })
      .click();
    await page.goBack();
    await expect(page).toHaveURL(`${streamingDocsPath}?mode=code`);
    await expectMode(page, 'Code');
    await expect(shell).toHaveAttribute('data-e2e-shell-lifetime', 'original');
    await page.goForward();
    await expect(page).toHaveURL(persistenceDocsPath);
    await expectMode(page, 'Docs');
    await expect(shell).toHaveAttribute('data-e2e-shell-lifetime', 'original');
  });

  for (const query of ['mode=run&mode=code', 'mode=invalid']) {
    test(`normalizes ${query} to the canonical Docs URL`, async ({ page }) => {
      await page.goto(`${streamingDocsPath}?${query}`);
      await expect(page).toHaveURL(streamingDocsPath);
      await expectMode(page, 'Docs');
      await modeButton(page, 'Code').click();
      await expect(page).toHaveURL(`${streamingDocsPath}?mode=code`);
      await expectMode(page, 'Code');
      await page.goBack({ waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(streamingDocsPath);
      await expectMode(page, 'Docs');
    });
  }

  test('normalizes a valid but unavailable mode and explains docs-only controls', async ({
    page,
  }) => {
    await page.goto(`${mappedDocsOnlyPath}?mode=run`);
    await expect(page).toHaveURL(mappedDocsOnlyPath);
    await expectMode(page, 'Docs');
    await expect(modeButton(page, 'Run')).toHaveAttribute(
      'aria-disabled',
      'true'
    );

    await page.goto(`${unmappedDocsOnlyPath}?mode=api`);
    await expect(page).toHaveURL(unmappedDocsOnlyPath);
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
      'data-workspace-kind',
      'docs-only'
    );
    await expectMode(page, 'Docs');
    for (const mode of ['Run', 'Code', 'API'] as const) {
      await expect(modeButton(page, mode)).toHaveAttribute(
        'aria-disabled',
        'true'
      );
      await expect(modeButton(page, mode)).toHaveAccessibleDescription(
        new RegExp(
          `${mode} is unavailable because this page has no workspace capability`,
          'i'
        )
      );
    }
  });

  test('docs-only /docs/choosing-an-adapter keeps operational modes focusable and local', async ({
    page,
  }) => {
    const path = '/docs/choosing-an-adapter';
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(path);

    const controlPlane = page.locator('[data-docs-control-plane]');
    await expect(controlPlane).toBeVisible();
    for (const mode of ['Run', 'Code', 'API'] as const) {
      const control = controlPlane.getByRole('button', {
        name: mode,
        exact: true,
      });
      await expect(control).toHaveAttribute('aria-disabled', 'true');
      await expect(control).toHaveAccessibleDescription(
        new RegExp(
          `${mode} is unavailable because this page has no workspace capability`,
          'i'
        )
      );
      await expect(control).not.toHaveAttribute('href', /.+/);
      await expect(control).not.toHaveAttribute('target', /.+/);
      await control.focus();
      await expect(control).toBeFocused();
      await control.click({ force: true });
      await expect(page).toHaveURL(path);
    }
    await expect(
      controlPlane.getByRole('button', { name: 'Search docs' })
    ).toBeVisible();
  });

  test('docs-only /docs keeps Code and API disabled but Run is a live link to the canonical example', async ({
    page,
  }) => {
    const path = '/docs';
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(path);

    const controlPlane = page.locator('[data-docs-control-plane]');
    await expect(controlPlane).toBeVisible();

    for (const mode of ['Code', 'API'] as const) {
      const control = controlPlane.getByRole('button', {
        name: mode,
        exact: true,
      });
      await expect(control).toHaveAttribute('aria-disabled', 'true');
      await expect(control).toHaveAccessibleDescription(
        new RegExp(
          `${mode} is unavailable because this page has no workspace capability`,
          'i'
        )
      );
      await expect(control).not.toHaveAttribute('href', /.+/);
      await expect(control).not.toHaveAttribute('target', /.+/);
    }

    await expect(
      controlPlane.getByRole('button', { name: 'Search docs' })
    ).toBeVisible();

    const run = controlPlane.getByRole('link', { name: 'Run', exact: true });
    await expect(run).toHaveAttribute(
      'href',
      '/docs/langgraph/guides/streaming?mode=run'
    );
    // Match the destination document; hydration can also update history.
    const [response] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().isNavigationRequest() &&
          response.request().frame() === page.mainFrame() &&
          response.url() ===
            new URL(
              '/docs/langgraph/guides/streaming?mode=run',
              page.url()
            ).href
      ),
      run.click(),
    ]);
    expect(response.status()).toBe(200);
    await expect(page).toHaveURL('/docs/langgraph/guides/streaming?mode=run');
    await expectMode(page, 'Run');
    await expect(page.locator('iframe')).toBeVisible();
  });

  test('serves the formerly workspace-only capabilities as docs pages with Run available', async ({
    page,
  }) => {
    const response = await page.goto(durableExecutionDocsPath);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(durableExecutionDocsPath);
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
      'aria-label',
      'Documentation workspace'
    );
    await expectMode(page, 'Docs');
    await modeButton(page, 'Run').click();
    await expect(page).toHaveURL(`${durableExecutionDocsPath}?mode=run`);
    await expect(
      page.locator('iframe[title="LangGraph Durable Execution live example"]')
    ).toBeAttached();

    const missing = await page.goto('/workspace/langgraph/durable-execution');
    expect(missing?.status()).toBe(404);
  });

  test('renders the full desktop rail and context at the 64rem breakpoint', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto(streamingDocsPath);
    await expectNoHorizontalOverflow(page, 'desktop workspace');

    const desktop = page.locator('[data-workspace-desktop-navigation]');
    await expect(desktop).toBeVisible();
    await expect(desktop.locator('[data-control-plane-rail]')).toBeVisible();
    await expect(desktop.locator('[data-control-plane-pane]')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Open context' })
    ).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'Open navigation' })
    ).toBeHidden();
  });

  for (const viewport of [
    { width: 1440, height: 900, surface: 'wide desktop' },
    { width: 1024, height: 900, surface: 'desktop breakpoint' },
    { width: 768, height: 900, surface: 'tablet breakpoint' },
    { width: 320, height: 844, surface: 'compact mobile' },
  ] as const) {
    test(`${viewport.surface} keeps workspace controls reachable without overflow`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto(`${streamingDocsPath}?mode=run`);
      await expectMode(page, 'Run');
      await expectNoHorizontalOverflow(page, `Website at ${viewport.width}px`);

      const desktopNavigation = page.locator(
        '[data-workspace-desktop-navigation]'
      );
      const mobileTrigger = page.getByRole('button', {
        name: 'Open navigation',
      });
      if (viewport.width >= 1024) {
        await expect(desktopNavigation).toBeVisible();
        await expect(mobileTrigger).toBeHidden();
        await expect(
          page.getByRole('button', { name: 'Runtime', exact: true })
        ).toBeVisible();
        await expect(
          desktopNavigation.getByRole('button', {
            name: RUN_RAIL_ITEM,
          })
        ).toBeVisible();
        await desktopNavigation
          .getByRole('button', { name: 'Activity' })
          .click();
        await expect(
          page.getByRole('heading', { name: 'Activity' })
        ).toBeVisible();
      } else if (viewport.width === 768) {
        await expect(desktopNavigation).toBeVisible();
        await expect(mobileTrigger).toBeHidden();
        const contextTrigger = page.getByRole('button', {
          name: 'Open context',
        });
        await expect(contextTrigger).toBeVisible();
        await contextTrigger.click();
        const dialog = page.getByRole('dialog', {
          name: 'Documentation control plane context',
        });
        await expect(
          dialog.getByRole('button', { name: 'Runtime', exact: true })
        ).toBeVisible();
        await desktopNavigation
          .getByRole('button', { name: 'Activity' })
          .click();
        await expect(
          dialog.getByRole('heading', { name: 'Activity' })
        ).toBeVisible();
      } else {
        await expect(desktopNavigation).toBeHidden();
        await expect(mobileTrigger).toBeVisible();
        const triggerBox = await mobileTrigger.boundingBox();
        expect(triggerBox?.width).toBeGreaterThanOrEqual(44);
        expect(triggerBox?.height).toBeGreaterThanOrEqual(44);
        await mobileTrigger.click();
        const dialog = page.getByRole('dialog', {
          name: 'Documentation control plane',
        });
        await expect(
          dialog.getByRole('button', { name: RUN_RAIL_ITEM })
        ).toBeVisible();
        await expect(
          dialog.getByRole('button', { name: 'Runtime', exact: true })
        ).toBeVisible();
        await dialog.getByRole('button', { name: 'Activity' }).click();
        await expect(
          dialog.getByRole('heading', { name: 'Activity' })
        ).toBeVisible();
      }
    });
  }

  test('uses tablet disclosure, focuses destinations, and restores utility focus', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto(streamingDocsPath);
    await expectNoHorizontalOverflow(page, 'tablet workspace');

    const desktop = page.locator('[data-workspace-desktop-navigation]');
    await expect(desktop.locator('[data-control-plane-rail]')).toBeVisible();
    await expect(desktop.locator('[data-control-plane-pane]')).toBeHidden();
    const contextTrigger = page.getByRole('button', { name: 'Open context' });
    await expect(contextTrigger).toBeVisible();

    const activity = desktop.getByRole('button', { name: 'Activity' });
    await activity.click();
    const dialog = page.getByRole('dialog', {
      name: 'Documentation control plane context',
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('heading', { name: 'Activity' })
    ).toBeFocused();

    const settings = desktop.getByRole('button', { name: 'Settings' });
    await settings.click();
    await expect(
      dialog.getByRole('heading', { name: 'Settings' })
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(
      dialog.getByRole('heading', { name: 'Settings' })
    ).toBeHidden();
    await expect(settings).toBeFocused();

    await modeButton(page, 'Code').click();
    await expect(dialog).toBeHidden();
    await expectMode(page, 'Code');
    await expect(visiblePanel(page, 'Code')).toBeFocused();

    await contextTrigger.click();
    await dialog
      .getByRole('link', { name: 'Persistence', exact: true })
      .click();
    await expect(page).toHaveURL(persistenceDocsPath);
    await expect(dialog).toBeHidden();
    await expectMode(page, 'Docs');
    await expect(visiblePanel(page, 'Docs')).toBeFocused();
  });

  test('uses a modal control plane below 48rem and restores Escape focus', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 767, height: 844 });
    await page.goto(streamingDocsPath);
    await expectNoHorizontalOverflow(page, 'mobile workspace');

    await expect(
      page.locator('[data-workspace-desktop-navigation]')
    ).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeHidden();
    const trigger = page.getByRole('button', { name: 'Open navigation' });
    await expect(trigger).toBeVisible();
    await page.evaluate(() => {
      const element = document.createElement('div');
      element.className = 'toast-root';
      element.setAttribute('data-announcement-toast', '');
      element.setAttribute('data-mounted', '');
      element.textContent = 'Visible announcement fixture';
      document
        .querySelector('[data-announcement-region]')
        ?.appendChild(element);
    });
    const announcement = page.locator('[data-announcement-toast]');
    const announcementRegion = page.locator('[data-announcement-region]');
    await expect(announcement).toBeVisible();
    await trigger.click();

    const dialog = page.getByRole('dialog', {
      name: 'Documentation control plane',
    });
    const globalNavigation = page.locator('[data-site-navigation]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(globalNavigation).toHaveAttribute('inert', '');
    await expect(announcementRegion).toHaveAttribute('inert', '');
    await expect(announcementRegion).toHaveAttribute(
      'data-workspace-modal-hidden',
      ''
    );
    await expect(announcement).toBeHidden();
    await page.evaluate(() => {
      const lateToast = document.createElement('button');
      lateToast.setAttribute('data-late-announcement', '');
      lateToast.textContent = 'Late announcement fixture';
      document
        .querySelector('[data-announcement-region]')
        ?.appendChild(lateToast);
    });
    const lateAnnouncement = page.locator('[data-late-announcement]');
    await expect(lateAnnouncement).toBeHidden();
    await expect(page.locator('[data-workspace-surface]')).toHaveAttribute(
      'inert',
      ''
    );

    await dialog.getByRole('button', { name: RUN_RAIL_ITEM }).click();
    await expect(dialog).toBeHidden();
    await expectMode(page, 'Run');
    await expect(visiblePanel(page, 'Run')).toBeFocused();

    await trigger.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveAttribute('data-state', 'closing');
    await expect(globalNavigation).toHaveAttribute('inert', '');
    await expect(announcementRegion).toHaveAttribute('inert', '');
    await expect(lateAnnouncement).toBeHidden();
    await expect(dialog).toHaveCount(0);
    await expect(globalNavigation).not.toHaveAttribute('inert', '');
    await expect(announcementRegion).not.toHaveAttribute('inert', '');
    await expect(announcementRegion).not.toHaveAttribute(
      'data-workspace-modal-hidden',
      ''
    );
    await expect(announcement).toBeVisible();
    await expect(lateAnnouncement).toBeVisible();
    await expect(trigger).toBeFocused();
    await announcement.evaluate((element) => element.remove());
    await lateAnnouncement.evaluate((element) => element.remove());
  });

  test('defers mobile Learn navigation and focuses each destination heading', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(streamingDocsPath);

    await page.getByRole('button', { name: 'Open navigation' }).click();
    let dialog = page.getByRole('dialog', {
      name: 'Documentation control plane',
    });
    await dialog.getByRole('link', { name: 'Streaming', exact: true }).click();
    await expect(page).toHaveURL(streamingDocsPath);
    await expect(dialog).toHaveCount(0);
    await expect(visiblePanel(page, 'Docs')).toBeFocused();

    await page.getByRole('button', { name: 'Open navigation' }).click();
    dialog = page.getByRole('dialog', {
      name: 'Documentation control plane',
    });
    await dialog
      .getByRole('link', { name: 'Persistence', exact: true })
      .click();
    await expect(page).toHaveURL(persistenceDocsPath);
    await expect(dialog).toHaveCount(0);
    await expect(visiblePanel(page, 'Docs')).toBeFocused();

    await page.getByRole('button', { name: 'Open navigation' }).click();
    dialog = page.getByRole('dialog', {
      name: 'Documentation control plane',
    });
    await dialog
      .getByRole('link', { name: 'Choosing an adapter', exact: true })
      .click();
    await expect(page).toHaveURL('/docs/choosing-an-adapter');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('main h1').first()).toBeFocused();
  });

  test('keeps Learn and visible Search in mapped and unmapped mobile Docs context', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    for (const path of [streamingDocsPath, unmappedDocsOnlyPath]) {
      await page.goto(path);
      await page.getByRole('button', { name: 'Open navigation' }).click();
      const dialog = page.getByRole('dialog', {
        name: 'Documentation control plane',
      });
      await expect(dialog.getByText('Learn', { exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: 'Search docs' }).click();
      await expect(dialog).toHaveCount(0);
      await expect(
        page.getByRole('dialog', { name: 'Search documentation' })
      ).toBeVisible();
      await expect(
        page.getByRole('combobox', { name: 'Search documentation...' })
      ).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(
        page.getByRole('dialog', { name: 'Search documentation' })
      ).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Open navigation' })
      ).toBeFocused();
    }
  });

  test('preserves visible boundaries and focus in forced colors', async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto(streamingDocsPath);

    const run = modeButton(page, 'Run');
    await run.focus();
    const styles = await run.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        borderWidth: style.borderTopWidth,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      };
    });
    expect(Number.parseFloat(styles.borderWidth)).toBeGreaterThan(0);
    expect(styles.outlineStyle).not.toBe('none');
    expect(Number.parseFloat(styles.outlineWidth)).toBeGreaterThan(0);

    await run.click();
    await expect(page.getByText('Ready', { exact: true })).toBeVisible();
    const runtime = page.getByRole('button', { name: 'Runtime', exact: true });
    await runtime.focus();
    const runtimeStyles = await runtime.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        borderWidth: style.borderTopWidth,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      };
    });
    expect(Number.parseFloat(runtimeStyles.borderWidth)).toBeGreaterThan(0);
    expect(runtimeStyles.outlineStyle).not.toBe('none');
    expect(Number.parseFloat(runtimeStyles.outlineWidth)).toBeGreaterThan(0);
  });

  test('removes mobile control-plane motion when reduced motion is requested', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // The loader is on screen only while the runtime is still being
    // configured, so refuse the runtime frame itself. Match it by the session
    // params Run mode stamps on every runtime URL rather than by host: against
    // the deployed site the frame loads from the production runtime origin,
    // and a `localhost:4300` route lets it reach ready before the assertion.
    await page.route(
      (url) => url.searchParams.has('cockpit_cap'),
      (route) => route.abort()
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${streamingDocsPath}?mode=run`);
    await page.getByRole('button', { name: 'Open navigation' }).click();

    const dialog = page.getByRole('dialog', {
      name: 'Documentation control plane',
    });
    await expect(dialog).toBeVisible();
    const motion = await dialog.evaluate((element) => {
      const panel = element.querySelector(
        '.workspace-mobile-control-plane-panel'
      );
      const overlayStyle = getComputedStyle(element);
      const panelStyle = panel ? getComputedStyle(panel) : null;
      return {
        overlayAnimation: overlayStyle.animationName,
        overlayTransition: overlayStyle.transitionDuration,
        panelAnimation: panelStyle?.animationName,
        panelTransition: panelStyle?.transitionDuration,
      };
    });
    const loader = dialog.locator('.workspace-runtime-status-loader');
    await expect(loader).toBeVisible();
    expect(
      await loader.evaluate(
        (element) => getComputedStyle(element).animationName
      )
    ).toBe('none');
    expect(motion).toEqual({
      overlayAnimation: 'none',
      overlayTransition: '0s',
      panelAnimation: 'none',
      panelTransition: '0s',
    });
  });
});
