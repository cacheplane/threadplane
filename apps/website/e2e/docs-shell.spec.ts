import { test, expect } from '@playwright/test';

const ARTICLE = '/docs/langgraph/getting-started/introduction';
const PAGE_ACTION_LABELS = [
  'On this page',
  'Copy page as Markdown',
  'Open in ChatGPT',
  'View as Markdown',
  'Edit on GitHub',
];

async function expectWorkspaceReady(page: import('@playwright/test').Page) {
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
    'data-hydrated',
    'true',
  );
}

/**
 * The docs shell is one reading pane: a sticky control plane on the left, one
 * prose column, and a sticky TOC rail on the right. These guard the parts of
 * that whose failure mode is silence — a rail that stops tracking, a column
 * that stops sharing its measure — and which jsdom cannot see.
 */

test.describe('DocsTOC rail', () => {
  test('tracks the reading position on a hard load', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(ARTICLE);
    await expectWorkspaceReady(page);
    // In development the article streams after the shell hydrates.
    await expect(page.locator('article #connect-with-angular')).toBeVisible();
    await expect(page.locator('.docs-toc-link').first()).toBeVisible();

    // Nothing is active at the top: the first heading is below the reading line.
    await expect(page.locator('.docs-toc-link[data-active]')).toHaveCount(0);

    // The reading line lands a heading as "active" once its top crosses
    // scrollRoot.top + scrollRoot.clientHeight * 0.25 (see DocsTOC.tsx). A
    // hard-coded `scrollTop: 4000` broke the last time this page's content
    // grew (a callout pushed everything below it further down the article),
    // so compute the scroll offset that puts a specific heading right at
    // that line instead of relying on a pixel constant that content edits
    // keep invalidating.
    const targetHeadingId = 'connect-with-angular';
    const articleScroller = page.locator('.docs-workspace-article');
    const scrollTop = await articleScroller.evaluate((scrollRoot, headingId) => {
      const heading = document.getElementById(headingId);
      if (!heading) throw new Error(`missing heading #${headingId}`);
      // Heading's distance from the top of the scroller's content, i.e.
      // where its rect top would be if scrollTop were 0.
      const headingTopAtZero =
        heading.getBoundingClientRect().top -
        scrollRoot.getBoundingClientRect().top +
        scrollRoot.scrollTop;
      const line = scrollRoot.clientHeight * 0.25;
      // A couple of extra pixels so the heading's top is unambiguously at
      // or above the line, matching DocsTOC's `<=` comparison.
      return Math.max(0, Math.round(headingTopAtZero - line + 2));
    }, targetHeadingId);
    await articleScroller.evaluate(
      (element, top) => element.scrollTo({ top, behavior: 'instant' }),
      scrollTop,
    );
    await expect
      .poll(() =>
        page
          .locator('.docs-toc-link[data-active]')
          .evaluateAll((els) => els.map((e) => e.getAttribute('href'))),
      )
      .toEqual([`#${targetHeadingId}`]);

    // ...and it follows the scroll rather than latching on the first match.
    await articleScroller.evaluate((element) =>
      element.scrollTo({ top: 0, behavior: 'instant' }),
    );
    await expect.poll(() => page.locator('.docs-toc-link[data-active]').count()).toBe(0);
  });

  test('every rail link resolves to a heading in the article', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(ARTICLE);
    await expect(page.locator('article #connect-with-angular')).toBeVisible();

    const unresolved = await page.evaluate(() =>
      [...document.querySelectorAll('.docs-toc-link')]
        .map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? '')
        .filter((href) => !document.getElementById(href.slice(1))),
    );
    expect(unresolved).toEqual([]);
  });

  test('the library-neutral adapter page gets the same rail', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/docs/choosing-an-adapter');
    await expect(page.locator('.docs-toc')).toBeVisible();
    expect(await page.locator('.docs-toc-link').count()).toBeGreaterThan(3);
  });
});

test.describe('docs shell layout', () => {
  test('the workspace navigation and TOC hold through a full article scroll', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(ARTICLE);
    await expectWorkspaceReady(page);

    const navH = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')),
    );
    const tops = async () => ({
      plane: await page.locator('[data-workspace-desktop-navigation]').evaluate((el) => Math.round(el.getBoundingClientRect().top)),
      toc: await page.locator('.docs-toc').evaluate((el) => Math.round(el.getBoundingClientRect().top)),
    });

    const initial = await tops();
    const articleScroller = page.locator('.docs-workspace-article');

    expect(initial.plane).toBe(navH);
    expect(initial.toc).toBeGreaterThan(navH);
    await articleScroller.evaluate((element) =>
      element.scrollTo({ top: 4000, behavior: 'instant' }),
    );
    expect(await tops()).toEqual(initial);
    await articleScroller.evaluate((element) =>
      element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }),
    );
    expect(await tops()).toEqual(initial);
  });

  test('breadcrumb, prose and prev/next share one right edge', async ({ page }) => {
    // The header block used to stretch to the full content width while the
    // article and the prev/next rail sat at max-w-3xl, so PageActions floated
    // ~500px right of the column it belongs to.
    await page.setViewportSize({ width: 1920, height: 1000 });
    await page.goto(ARTICLE);
    await expectWorkspaceReady(page);
    const docsPanel = page.getByRole('region', { name: 'Docs workspace panel' });

    const right = (selector: string) =>
      docsPanel.locator(selector).evaluate((el) => Math.round(el.getBoundingClientRect().right));

    const header = await right('.docs-page-header');
    const article = await right('article');
    const prevNext = await right('.docs-prevnext');

    // The header and prev/next sit inside the article's horizontal padding.
    expect(article - header).toBeLessThanOrEqual(48);
    expect(header).toBe(prevNext);
  });
});

test.describe('Page actions', () => {
  for (const width of [320, 768, 1024, 1440]) {
    test(`stays aligned and contained at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(ARTICLE);
      await expectWorkspaceReady(page);

      const header = page.locator('.docs-page-header');
      const trigger = page.getByRole('button', { name: 'Page actions' });
      await expect(header).toBeVisible();
      await expect(trigger).toBeVisible();

      const [headerBox, triggerBox] = await Promise.all([
        header.boundingBox(),
        trigger.boundingBox(),
      ]);
      expect(headerBox).not.toBeNull();
      expect(triggerBox).not.toBeNull();
      if (!headerBox || !triggerBox) throw new Error('Expected Page actions geometry');

      expect(triggerBox.width).toBeGreaterThanOrEqual(44);
      expect(triggerBox.height).toBeGreaterThanOrEqual(44);
      expect(triggerBox.x).toBeGreaterThanOrEqual(headerBox.x);
      expect(triggerBox.x + triggerBox.width).toBeLessThanOrEqual(
        headerBox.x + headerBox.width,
      );
      expect(
        Math.abs(
          triggerBox.x + triggerBox.width -
            (headerBox.x + headerBox.width),
        ),
      ).toBeLessThanOrEqual(1);
      expect(triggerBox.y).toBeGreaterThanOrEqual(headerBox.y);
      expect(triggerBox.y + triggerBox.height).toBeLessThanOrEqual(
        headerBox.y + headerBox.height,
      );
      expect(
        Math.abs(
          triggerBox.y + triggerBox.height / 2 -
            (headerBox.y + headerBox.height / 2),
        ),
      ).toBeLessThanOrEqual(1);

      await trigger.click();
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      await expect
        .poll(() =>
          menu
            .getByRole('menuitem')
            .evaluateAll((items) => items.map((item) => item.textContent?.trim())),
        )
        .toEqual(PAGE_ACTION_LABELS);

      const menuBox = await menu.boundingBox();
      expect(menuBox).not.toBeNull();
      if (!menuBox) throw new Error('Expected open Page actions menu geometry');
      const viewport = await page.evaluate(() => ({
        height: window.visualViewport?.height ?? window.innerHeight,
        width: window.visualViewport?.width ?? window.innerWidth,
        x: window.visualViewport?.offsetLeft ?? 0,
        y: window.visualViewport?.offsetTop ?? 0,
      }));
      const safeInset = 8;
      expect(menuBox.x).toBeGreaterThanOrEqual(viewport.x + safeInset);
      expect(menuBox.y).toBeGreaterThanOrEqual(viewport.y + safeInset);
      expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(
        viewport.x + viewport.width - safeInset,
      );
      expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(
        viewport.y + viewport.height - safeInset,
      );

      const documentGeometry = await page.evaluate(() => {
        const articleScroller = document.querySelector('.docs-workspace-article');
        if (!(articleScroller instanceof HTMLElement)) {
          throw new Error('Expected docs article scroller');
        }
        return {
          articleClientWidth: articleScroller.clientWidth,
          articleScrollWidth: articleScroller.scrollWidth,
          rootClientWidth: document.documentElement.clientWidth,
          rootScrollWidth: document.documentElement.scrollWidth,
        };
      });
      expect(documentGeometry.articleScrollWidth).toBeLessThanOrEqual(
        documentGeometry.articleClientWidth,
      );
      expect(documentGeometry.rootScrollWidth).toBeLessThanOrEqual(
        documentGeometry.rootClientWidth,
      );
    });
  }

  test('reveals its tooltip for fine-pointer hover and keyboard focus', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto(ARTICLE);
    await expectWorkspaceReady(page);
    expect(await page.evaluate(() => matchMedia('(pointer: fine)').matches)).toBe(true);

    const trigger = page.getByRole('button', { name: 'Page actions' });
    const tooltip = page.getByRole('tooltip', { name: 'Page actions' });
    await expect(tooltip).toBeHidden();

    await trigger.hover();
    await expect(tooltip).toBeVisible();
    await page.mouse.move(1, 1);
    await expect(tooltip).toBeHidden();

    await trigger.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(trigger).toBeFocused();
    expect(await trigger.evaluate((element) => element.matches(':focus-visible'))).toBe(
      true,
    );
    await expect(tooltip).toBeVisible();

    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page.getByRole('tooltip')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(tooltip).toBeVisible();
  });

  test('keeps a visible system-color trigger boundary and focus indicator', async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto(ARTICLE);
    await expectWorkspaceReady(page);

    const trigger = page.getByRole('button', { name: 'Page actions' });
    await trigger.focus();
    await expect(page.getByRole('tooltip', { name: 'Page actions' })).toBeVisible();
    const styles = await trigger.evaluate((element) => {
      const reference = document.createElement('div');
      reference.style.color = 'CanvasText';
      reference.style.backgroundColor = 'Canvas';
      reference.style.outline = '2px solid Highlight';
      reference.style.forcedColorAdjust = 'none';
      document.body.append(reference);

      const style = getComputedStyle(element);
      const referenceStyle = getComputedStyle(reference);
      const result = {
        system: {
          canvas: referenceStyle.backgroundColor,
          canvasText: referenceStyle.color,
          highlight: referenceStyle.outlineColor,
        },
        trigger: {
          backgroundColor: style.backgroundColor,
          borderColor: style.borderTopColor,
          borderStyle: style.borderTopStyle,
          borderWidth: style.borderTopWidth,
          outlineColor: style.outlineColor,
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
        },
      };
      reference.remove();
      return result;
    });

    expect(styles.trigger.backgroundColor).toBe(styles.system.canvas);
    expect(styles.trigger.borderColor).toBe(styles.system.canvasText);
    expect(styles.trigger.borderColor).not.toBe(styles.trigger.backgroundColor);
    expect(styles.trigger.borderStyle).not.toBe('none');
    expect(Number.parseFloat(styles.trigger.borderWidth)).toBeGreaterThan(0);
    expect(styles.trigger.outlineColor).toBe(styles.system.highlight);
    expect(styles.trigger.outlineStyle).not.toBe('none');
    expect(Number.parseFloat(styles.trigger.outlineWidth)).toBeGreaterThan(0);
  });

  test('removes the tooltip transition when reduced motion is requested', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto(ARTICLE);
    await expectWorkspaceReady(page);

    const trigger = page.getByRole('button', { name: 'Page actions' });
    await trigger.focus();
    const tooltip = page.getByRole('tooltip', { name: 'Page actions' });
    await expect(tooltip).toBeVisible();
    expect(
      await tooltip.evaluate((element) => getComputedStyle(element).transitionDuration),
    ).toBe('0s');
  });
});
