import { test, expect, type Page } from '@playwright/test';

/**
 * jsdom has no layout engine, so the unit tests cannot see a panel that renders
 * into a quarter of its own width — which is exactly what shipped when the
 * Libraries grid's tracks were put on the wrong element. These assertions are
 * about geometry, so they only mean anything in a real browser.
 */
test.describe('desktop nav panels', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
  });

  test('lays the four libraries out side by side, not stacked', async ({ page }) => {
    await page.getByRole('button', { name: 'Libraries' }).click();

    const items = page.locator('.nav-panel .nav-panel-item');
    await expect(items).toHaveCount(5); // four libraries plus the footer link
    // The panel's entrance animation translates it into place over 140ms; the
    // boxes below are read one at a time, so sampling mid-animation would
    // catch each item at a different point along that transform. Let it settle
    // first so the geometry assertions below reflect the resting layout.
    await page.locator('.nav-panel').evaluate((el) =>
      Promise.all(el.getAnimations().map((animation) => animation.finished)),
    );

    const boxes = [];
    for (let index = 0; index < 4; index += 1) {
      const box = await items.nth(index).boundingBox();
      if (!box) throw new Error(`Library item ${index} has no box`);
      boxes.push(box);
    }

    // Four distinct columns: every item starts to the right of the previous one
    // and shares its vertical position.
    for (let index = 1; index < boxes.length; index += 1) {
      expect(boxes[index].x).toBeGreaterThan(boxes[index - 1].x);
      expect(Math.abs(boxes[index].y - boxes[0].y)).toBeLessThanOrEqual(2);
    }

    // And together they occupy most of the panel rather than one track of it.
    const panel = await page.locator('.nav-panel').boundingBox();
    if (!panel) throw new Error('Panel has no box');
    const spanned = boxes[3].x + boxes[3].width - boxes[0].x;
    expect(spanned).toBeGreaterThan(panel.width * 0.8);
  });

  test('stacks the items within each column of a multi-column panel', async ({ page }) => {
    await page.getByRole('button', { name: 'Solutions' }).click();

    const firstColumn = page.locator('.nav-panel .nav-panel-col').first();
    const items = firstColumn.locator('.nav-panel-item');
    await expect(items).toHaveCount(3);

    const first = await items.nth(0).boundingBox();
    const second = await items.nth(1).boundingBox();
    if (!first || !second) throw new Error('Column items have no box');
    expect(second.y).toBeGreaterThan(first.y);
    expect(Math.abs(second.x - first.x)).toBeLessThanOrEqual(2);
  });

  test('draws no borders or dividers inside a panel', async ({ page }) => {
    await page.getByRole('button', { name: 'Docs' }).click();

    const bordered = await page.locator('.nav-panel *').evaluateAll((nodes) =>
      nodes.filter((node) => {
        const style = getComputedStyle(node as Element);
        return (
          parseFloat(style.borderTopWidth) > 0 ||
          parseFloat(style.borderRightWidth) > 0 ||
          parseFloat(style.borderBottomWidth) > 0 ||
          parseFloat(style.borderLeftWidth) > 0
        );
      }).length,
    );
    expect(bordered).toBe(0);
  });

  test('moves focus into the panel it just opened', async ({ page }) => {
    await page.getByRole('button', { name: 'Libraries' }).click();
    await page.keyboard.press('Tab');

    const focusedInsidePanel = await page.evaluate(() =>
      Boolean(document.activeElement?.closest('.nav-panel')),
    );
    expect(focusedInsidePanel).toBe(true);
  });

  test('opens on hover after a grace period and survives the move into the panel', async ({ page }) => {
    const trigger = page.getByRole('button', { name: 'Libraries' });
    // A plain `.hover()` jumps the pointer straight to the target's center in
    // one step, so it never actually crosses the dead zone below the trigger
    // row — the exact gap this test exists to cover. `mouse.move` with
    // `steps` dispatches intermediate mousemove events along the path, which
    // is what makes the dead zone's mouseleave/mouseenter pair fire for real.
    const triggerBox = await trigger.boundingBox();
    if (!triggerBox) throw new Error('Trigger has no box');
    await page.mouse.move(
      triggerBox.x + triggerBox.width / 2,
      triggerBox.y + triggerBox.height / 2,
    );
    await expect(page.locator('.nav-panel')).toBeVisible({ timeout: 2000 });

    // Read the resting geometry: the entrance animation translates the panel
    // by 4px, so an un-settled box would move the waypoints below.
    await page.locator('.nav-panel').evaluate((el) =>
      Promise.all(el.getAnimations().map((animation) => animation.finished)),
    );
    const rowBox = await page.locator('.nav-desktop').boundingBox();
    const panelBox = await page.locator('.nav-panel').boundingBox();
    const itemBox = await page
      .locator('.nav-panel .nav-panel-item')
      .first()
      .boundingBox();
    if (!rowBox || !panelBox || !itemBox)
      throw new Error('Nav geometry has no box');

    // The band between the trigger row's bottom edge and the panel's top edge
    // is the row's own `py-4 md:py-5` padding. It is real space the pointer
    // has to cross, and it used to belong to neither element: leaving the row
    // scheduled a close, and only arriving at the panel could cancel it.
    const gapTop = rowBox.y + rowBox.height;
    const gapBottom = panelBox.y;
    expect(gapBottom).toBeGreaterThan(gapTop);

    // Cross that band DELIBERATELY SLOWLY — three stops of 120ms, ~360ms in
    // total, comfortably past NavDesktop's CLOSE_DELAY_MS of 150ms. A quick
    // traverse merely outruns the close timer, so it passes on fast hardware
    // whether or not the gap is bridged (that is how this shipped red on CI
    // and green locally). Dwelling longer than the grace asserts the thing
    // that actually keeps the panel open: .nav-panel-shell's transparent
    // top padding makes the band part of the shell, so the pointer never
    // leaves the panel's own subtree and no close is ever scheduled.
    const x = triggerBox.x + triggerBox.width / 2;
    for (const y of [gapTop + 1, (gapTop + gapBottom) / 2, gapBottom - 1]) {
      await page.mouse.move(x, y, { steps: 5 });
      await page.waitForTimeout(120);
    }
    await expect(page.locator('.nav-panel')).toBeVisible();

    await page.mouse.move(
      itemBox.x + itemBox.width / 2,
      itemBox.y + itemBox.height / 2,
      { steps: 15 },
    );
    await page.waitForTimeout(400);
    await expect(page.locator('.nav-panel')).toBeVisible();
  });
});

/**
 * The row's content box: its padding box minus the horizontal padding
 * Tailwind's px-6 / md:px-8 puts on it. Panels and triggers are positioned
 * against this box, so the assertions below are phrased in its terms.
 */
async function rowContentBox(page: Page) {
  const row = page.locator('.nav-bar > div');
  const box = await row.boundingBox();
  if (!box) throw new Error('Nav row has no box');
  const [padLeft, padRight] = await row.evaluate((el) => {
    const style = getComputedStyle(el);
    return [parseFloat(style.paddingLeft), parseFloat(style.paddingRight)];
  });
  return { left: box.x + padLeft, right: box.x + box.width - padRight };
}

test.describe('desktop nav row on a wide screen', () => {
  test('shares the page container and puts the triggers beside the logo', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await page.goto('/');

    const content = await rowContentBox(page);
    const logo = await page.locator('.nav-logo-link').boundingBox();
    // The hero's content box, from the shared Container primitive (data-ui)
    // every section centres: --container-page wide, inset by the
    // --spacing-container-x gutter. At 1920 that is 1200px at x=360 with a
    // 40px gutter, so the text edge is x=400.
    const container = page
      .locator("main [data-ui='container'][data-size='default']")
      .first();
    const containerBox = await container.boundingBox();
    const [containerPadLeft, containerPadRight] = await container.evaluate((el) => {
      const style = getComputedStyle(el);
      return [parseFloat(style.paddingLeft), parseFloat(style.paddingRight)];
    });
    const libraries = await page.getByRole('button', { name: 'Libraries' }).boundingBox();
    const cta = await page.getByRole('link', { name: 'Talk to Us' }).boundingBox();
    if (!logo || !containerBox || !libraries || !cta) throw new Error('Nav row has no box');
    const textLeft = containerBox.x + containerPadLeft;
    const textRight = containerBox.x + containerBox.width - containerPadRight;

    // The bar's content box is the sections' text box. Before this the logo
    // sat at x=32.
    expect(Math.abs(logo.x - textLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(content.left - textLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(content.right - textRight)).toBeLessThanOrEqual(1);

    // The first trigger follows the logo after a 40px lead, not a 1200px one.
    expect(libraries.x - (logo.x + logo.width)).toBeGreaterThanOrEqual(38);
    expect(libraries.x - (logo.x + logo.width)).toBeLessThanOrEqual(42);

    // The CTA still closes the row at the content box's right edge.
    expect(Math.abs(cta.x + cta.width - content.right)).toBeLessThanOrEqual(1);
  });

  test('stays full-bleed on docs, where the shell is full-bleed too', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await page.goto('/docs');

    const row = await page.locator('.nav-bar > div').boundingBox();
    const logo = await page.locator('.nav-logo-link').boundingBox();
    if (!row || !logo) throw new Error('Nav row has no box');
    expect(row.width).toBe(1920);
    expect(logo.x).toBeLessThan(48);
  });
});

/** Opens a panel, waits for its entrance animation, measures, and closes it. */
async function openAndMeasure(page: Page, name: string) {
  const trigger = page.getByRole('button', { name });
  await trigger.click();
  const panel = page.locator('.nav-panel');
  await expect(panel).toBeVisible();
  await panel.evaluate((el) =>
    Promise.all(el.getAnimations().map((animation) => animation.finished)),
  );
  const triggerBox = await trigger.boundingBox();
  const panelBox = await panel.boundingBox();
  if (!triggerBox || !panelBox) throw new Error(`${name} has no box`);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  return { triggerBox, panelBox };
}

test.describe('desktop nav panels sit under their triggers', () => {
  test('at 1440 every panel opens at its trigger, or flush to the row when it would not fit', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const content = await rowContentBox(page);

    // The row's content box here is 1120px (the 1200px container minus two
    // 40px gutters). Docs (~790px) and Solutions (~580px) have room and sit at
    // their trigger; Libraries (~1080px) is wider than the room right of its
    // trigger and ends flush with the content box instead. One invariant
    // covers all three: the left edge is the trigger's, pulled back only as
    // far as the content box needs.
    for (const name of ['Libraries', 'Docs', 'Solutions']) {
      const { triggerBox, panelBox } = await openAndMeasure(page, name);
      const expectedLeft = Math.max(
        content.left,
        Math.min(triggerBox.x, content.right - panelBox.width),
      );
      expect(Math.abs(panelBox.x - expectedLeft)).toBeLessThanOrEqual(2);
      expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(content.right + 1);
      // Intrinsic width: nowhere near the 1440px sheet this used to be.
      expect(panelBox.width).toBeLessThan(1150);
    }

    for (const name of ['Docs', 'Solutions']) {
      const { triggerBox, panelBox } = await openAndMeasure(page, name);
      expect(Math.abs(panelBox.x - triggerBox.x)).toBeLessThanOrEqual(2);
    }
    const libraries = await openAndMeasure(page, 'Libraries');
    expect(libraries.panelBox.x).toBeLessThan(libraries.triggerBox.x);
    expect(Math.abs(libraries.panelBox.x + libraries.panelBox.width - content.right)).toBeLessThanOrEqual(1);
  });

  test('at 1024 the Docs panel still fits inside the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto('/');
    const content = await rowContentBox(page);

    const { triggerBox, panelBox } = await openAndMeasure(page, 'Docs');
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(content.right + 1);
    expect(panelBox.x).toBeGreaterThanOrEqual(content.left - 1);
    expect(panelBox.x).toBeLessThanOrEqual(triggerBox.x);
  });

  test('at 1920 a panel is narrower than the viewport and starts at its trigger', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await page.goto('/');

    const { triggerBox, panelBox } = await openAndMeasure(page, 'Solutions');
    expect(Math.abs(panelBox.x - triggerBox.x)).toBeLessThanOrEqual(2);
    expect(panelBox.width).toBeLessThan(800);
  });

  test('below 1200 the four library cards fall into two rows of two', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Libraries' }).click();
    const items = page.locator('.nav-panel .nav-panel-col .nav-panel-item');
    await expect(items).toHaveCount(4);
    await page.locator('.nav-panel').evaluate((el) =>
      Promise.all(el.getAnimations().map((animation) => animation.finished)),
    );
    const boxes = [];
    for (let index = 0; index < 4; index += 1) {
      const box = await items.nth(index).boundingBox();
      if (!box) throw new Error(`Library item ${index} has no box`);
      boxes.push(box);
    }
    expect(Math.abs(boxes[1].y - boxes[0].y)).toBeLessThanOrEqual(2);
    expect(boxes[2].y).toBeGreaterThan(boxes[0].y);
    expect(Math.abs(boxes[2].x - boxes[0].x)).toBeLessThanOrEqual(2);
  });
});

/**
 * Vertical centre of an element's visible box. For the logo this is the
 * LogoMark itself, not its link: the link's box is a 25px line box that holds
 * --nav-h steady, so it can look centred while the mark inside it is not.
 */
async function centerY(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`${selector} has no box`);
  return box.y + box.height / 2;
}

test.describe('nav row vertical alignment', () => {
  for (const route of ['/', '/docs']) {
    test(`centres the logo on the same line as the links and actions on ${route}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(route);

      const logo = await centerY(page, ".nav-logo-link [data-ui='logo-mark']");
      const trigger = await centerY(page, '.nav-desktop-primary > button');
      const github = await centerY(page, '.nav-desktop-actions a[aria-label="GitHub repository"]');
      const cta = await centerY(page, ".nav-desktop-actions [data-ui='button']");

      for (const other of [trigger, github, cta]) {
        expect(Math.abs(logo - other)).toBeLessThanOrEqual(0.5);
      }
    });
  }

  test('centres the logo with the menu button on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/');

    const logo = await centerY(page, ".nav-logo-link [data-ui='logo-mark']");
    const menu = await centerY(page, 'button[aria-label="Open menu"] svg');
    expect(Math.abs(logo - menu)).toBeLessThanOrEqual(0.5);
  });
});
