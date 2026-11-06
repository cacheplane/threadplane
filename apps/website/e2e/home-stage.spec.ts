import { test, expect, type Page } from '@playwright/test';
import { STAGE_CLOSE } from '../src/lib/positioning';
import {
  STAGE_SPAN,
  beatWindows,
  STAGE_BEATS,
  APPROVE_THRESHOLD_P,
  APPROVE_HOLD,
} from '../src/lib/stage-beats';
const demoOrigin =
  process.env['NEXT_PUBLIC_STAGE_DEMO_ORIGIN'] || 'https://demo.threadplane.ai';
const approve = beatWindows()[STAGE_BEATS.indexOf('approve')];
const holdProgress = approve.from + (approve.to - approve.from) * ((APPROVE_HOLD.from + APPROVE_HOLD.to) / 2);

/** Drives the pinned act: the section uses the authored five-beat span; scroll to a fraction of its travel. */
async function scrollAct(page: Page, p: number) {
  await page.evaluate((frac) => {
    const el = document.querySelector('[data-stage-act]') as HTMLElement;
    const top = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({
      top: top + (el.offsetHeight - window.innerHeight) * frac,
      behavior: 'instant',
    });
  }, p);
  // The engine writes `--sc-p` and the cue opacities from `scrollY` on ONE
  // requestAnimationFrame after the scroll event (the 0.18/frame lerp applies
  // to <video> playheads only; this page has none). The scroll event lands in
  // the frame after scrollTo, so two nested frames are past the engine's write.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
}
const progress = (page: Page) =>
  page.evaluate(() =>
    parseFloat(
      (
        document.querySelector('[data-stage-act]') as HTMLElement
      ).style.getPropertyValue('--sc-p')
    )
  );

test.describe('homepage stage', () => {
  test('gradual playback replaces the render introduction with an editable surface', async ({ page }) => {
    test.skip(process.env['STAGE_LIVE_FRAME'] !== 'true', 'requires the matching stage replay deployment');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const act = page.locator('[data-stage-act]');
    await expect(act).toHaveAttribute('data-state', 'ready');
    const frame = page.frameLocator('.stage-frame-iframe');
    for (const p of [0.87, 0.89, 0.91, 0.93, 0.95, 1]) {
      await scrollAct(page, p);
      await expect(act).toHaveAttribute('data-interactive', '', { timeout: 30_000 });
    }
    const notes = frame.getByRole('textbox', { name: 'Follow-up notes' });
    await notes.fill('Verify the next retention review.');
    await expect(notes).toHaveValue('Verify the next retention review.');
    await expect(frame.locator('a2ui-surface')).toHaveCount(1);
  });

  test('settled replay allows State inspection and form edits; page motion resumes playback', async ({ page }) => {
    test.skip(process.env['STAGE_LIVE_FRAME'] !== 'true', 'requires the matching stage replay deployment');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const act = page.locator('[data-stage-act]');
    await expect(page.locator('html')).toHaveClass(/sc-ready/);
    await scrollAct(page, 0.32);
    await expect(act).toHaveAttribute('data-state', 'ready');
    await expect(act).toHaveAttribute('data-interactive', '', { timeout: 30_000 });
    const iframe = act.locator('iframe');
    await expect(iframe).not.toHaveAttribute('inert');
    await expect(iframe).toHaveAttribute('tabindex', '0');
    const frame = page.frameLocator('.stage-frame-iframe');
    await frame.getByRole('tab', { name: 'State', exact: true }).click();
    await expect(frame.getByRole('tab', { name: 'State', exact: true })).toHaveAttribute('aria-selected', 'true');
    await frame.getByRole('button', { name: 'Dock left', exact: true }).click();
    await expect(frame.locator('.stage')).toHaveAttribute('data-dock', 'left');
    await frame.getByRole('button', { name: 'Dock bottom', exact: true }).click();
    const y = await page.evaluate(() => scrollY);
    await frame.getByRole('tab', { name: 'State', exact: true }).hover();
    await page.mouse.wheel(0, 150);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(y);
    await expect(act).toHaveAttribute('data-interactive', '', { timeout: 30_000 });
    await page.getByRole('button', { name: 'Explore chat', exact: true }).click();
    await expect(act).toHaveAttribute('data-exploring', '');
    const exploringY = await page.evaluate(() => scrollY);
    await frame.getByRole('tab', { name: 'State', exact: true }).hover();
    await page.mouse.wheel(0, 150);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => scrollY)).toBe(exploringY);
    await frame.getByRole('tab', { name: 'State', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(act).not.toHaveAttribute('data-exploring');
    await expect(page.getByRole('button', { name: 'Explore chat', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Explore chat', exact: true }).click();
    await page.getByRole('button', { name: 'Resume walkthrough', exact: true }).click();
    await expect(act).not.toHaveAttribute('data-exploring');
    await page.getByRole('button', { name: 'Explore chat', exact: true }).click();
    await scrollAct(page, 1);
    await expect(act).not.toHaveAttribute('data-exploring');
    await expect(act).toHaveAttribute('data-interactive', '', { timeout: 30_000 });
    await expect(frame.getByRole('tab', { name: 'State', exact: true })).toHaveAttribute('aria-selected', 'true');
    const notes = frame.getByRole('textbox', { name: 'Follow-up notes' });
    await notes.fill('Review the next retention window.');
    await expect(notes).toHaveValue('Review the next retention window.');
    await frame.getByRole('button', { name: 'Close', exact: true }).click();
    await frame.getByRole('button', { name: 'Open chat devtools', exact: true }).click();
    await expect(frame.getByRole('tab', { name: 'State', exact: true })).toHaveAttribute('aria-selected', 'true');
    await scrollAct(page, 0.32);
    await expect(act).toHaveAttribute('data-interactive', '', { timeout: 30_000 });
    await expect(frame.locator('a2ui-surface')).toHaveCount(0);
  });
  test('stills render first and the act upgrades on desktop', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const act = page.locator('[data-stage-act]');
    await expect(act.locator('[data-ui="browser-frame-url"]')).toHaveText('demo.threadplane.ai');
    expect((await act.locator('.stage-frame').boundingBox())?.width).toBeGreaterThan(1000);
    await expect(act).toHaveAttribute('data-sc-span', String(STAGE_SPAN));
    await expect(act.locator('iframe')).toHaveAttribute(
      'src',
      `${demoOrigin}/stage?t=0`
    );
    await expect(act.locator('.stage-pin')).toHaveCSS('position', 'sticky');
    await expect(page.getByTestId('stage-still-beat')).toHaveCount(0);
    // This runs well inside StageAct's 8 s READY_TIMEOUT_MS (after which the
    // act is swapped for the stills and [data-stage-act] disappears).
    // The engine's layout() sets the act's inline height to span × 100vh.
    await expect(page.locator('html')).toHaveClass(/sc-ready/);
    const heights = await page.evaluate(() => ({
      act: (document.querySelector('[data-stage-act]') as HTMLElement)
        .offsetHeight,
      viewport: window.innerHeight,
    }));
    expect(
      Math.abs(heights.act - STAGE_SPAN * heights.viewport)
    ).toBeLessThanOrEqual(4);
  });

  test('scroll drives the act: checklist, hold, and final install action', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    // With the rAF settle this takes ~1-2 s, well inside StageAct's 8 s
    // READY_TIMEOUT_MS after which the act is swapped for the stills.
    await expect(page.locator('html')).toHaveClass(/sc-ready/);
    const act = page.locator('[data-stage-act]');
    const tools = page.locator('[data-stage-segment="stream"]');
    const stream = page
      .getByTestId('stage-rail-beat')
      .and(page.locator('[data-beat="stream"]'));
    const streamCheck = stream.locator('[data-stage-check]');
    // The checklist stays visible while the active row advances.
    await scrollAct(page, 0.05);
    expect(await progress(page)).toBeGreaterThan(0);
    await expect(tools).toHaveAttribute('data-beat-state', 'now');
    await expect(stream).toHaveCSS('opacity', '1');
    await expect(streamCheck).not.toHaveAttribute('data-checked', '');
    // Past the Tools settle point (its window end): done and checked.
    await scrollAct(page, 0.3);
    await expect(tools).toHaveAttribute('data-beat-state', 'done');
    await expect(streamCheck).toHaveAttribute('data-checked', '');
    // The approval hold is derived from the shared beat windows.
    await scrollAct(page, holdProgress);
    await expect(act).toHaveAttribute('data-sc-verify-hold', 'true');
    await expect(page.getByTestId('stage-rail-hold')).toHaveCSS(
      'opacity',
      /^(0\.[5-9]\d*|1)$/
    );
    await scrollAct(page, APPROVE_THRESHOLD_P + 0.02);
    await expect(act).not.toHaveAttribute('data-sc-verify-hold', 'true');
    // The end: the install action is fully in, and every check is
    // filled, and the install command is the one the copy declares.
    await scrollAct(page, 1);
    const close = page.getByTestId('stage-rail-close');
    await expect(close).toHaveCSS('opacity', '1');
    await expect(close).toHaveAttribute('data-active', '');
    await expect(act.locator('[data-stage-check][data-checked]')).toHaveCount(
      5
    );
    await expect(close.locator('code')).toHaveCount(0);
    await close.locator('.stage-install-cta').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('install-command')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('a segment click scrolls the act to its beat', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/sc-ready/);
    await scrollAct(page, 0.05);
    await page.locator('[data-stage-segment="persist"]').click();
    // The click lands inside the saved-thread beat.
    await expect
      .poll(() => progress(page), { timeout: 2_000 })
      .toBeGreaterThan(beatWindows()[2].from);
    expect(await progress(page)).toBeLessThan(beatWindows()[2].to);
  });

  test('tools and subagents links land before their recorded reveals while Docs remain links', async ({ page }) => {
    test.skip(process.env['STAGE_LIVE_FRAME'] !== 'true', 'requires the matching stage replay deployment');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/sc-ready/);
    await scrollAct(page, 0.3);
    const act = page.locator('[data-stage-act]');
    await expect(act).toHaveAttribute('data-state', 'ready');
    for (const beat of ['stream', 'subagents']) {
      const link = page.locator(`[data-stage-segment="${beat}"]`);
      await expect(link).toHaveAttribute('data-stage-target', /[0-9]/);
      const target = Number(await link.getAttribute('data-stage-target'));
      await link.click();
      await expect.poll(() => progress(page)).toBeCloseTo(target, 3);
      await expect(act).toHaveAttribute('data-interactive', '');
      const frame = page.frames().find(f => f.url().startsWith(demoOrigin + '/stage'))!;
      const position = await frame.evaluate((name) => {
        const w = window as unknown as { __stageApplied: { t: number }; __stageTimeline: { beats: { beat: string; startMs: number; revealMs?: number }[] } };
        return { t: w.__stageApplied.t, beat: w.__stageTimeline.beats.find(b => b.beat === name)! };
      }, beat);
      expect(position.t).toBeGreaterThanOrEqual(position.beat.startMs);
      expect(position.t).toBeLessThan(position.beat.revealMs!);
    }
    await expect(page.getByRole('link', { name: 'Tools & citations documentation' })).toHaveAttribute('href', '/docs/angular/chat/components/chat-tool-calls');
    await expect(page.getByRole('link', { name: 'Subagents documentation' })).toHaveAttribute('href', '/docs/angular/langgraph/guides/subgraphs');
  });

  test('the frame answers and the verify state changes between positions', async ({
    page,
  }) => {
    test.skip(
      process.env['STAGE_LIVE_FRAME'] !== 'true',
      'set STAGE_LIVE_FRAME=true with the five-beat demo origin'
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const act = page.locator('[data-stage-act]');
    // After READY_TIMEOUT_MS (8 s) StageAct swaps the act for the stills and
    // [data-stage-act] is gone, so a `ready` that never arrives fails here,
    // on the state attribute, rather than later on a vanished locator.
    await expect(act).toHaveAttribute('data-state', 'ready', {
      timeout: 8_000,
    });
    // `data-state="ready"` only proves the iframe answered; the engine's
    // layout (html.sc-ready) is what sizes the authored act span.
    await expect(page.locator('html')).toHaveClass(/sc-ready/);
    // Once ready arrived the fallback timer is cleared, so the waits below
    // only cover the live frame's own latency.
    await scrollAct(page, 0.1);
    await expect(act).toHaveAttribute('data-sc-verify-state', /^stream:\d+$/, {
      timeout: 10_000,
    });
    const a = await act.getAttribute('data-sc-verify-state');
    for (const p of [0.11, 0.12, 0.13, 0.14]) {
      const before = await act.getAttribute('data-sc-verify-state');
      await scrollAct(page, p);
      await expect(act).not.toHaveAttribute('data-sc-verify-state', before ?? '');
    }
    const subagents = beatWindows()[1];
    await scrollAct(
      page,
      subagents.from + (subagents.to - subagents.from) * 0.8
    );
    await expect(
      act.locator('[data-stage-segment="subagents"]')
    ).toHaveAttribute('data-beat-state', 'now');
    await expect(act).toHaveAttribute('data-sc-verify-state', /^subagents:\d+$/);
    expect(await act.getAttribute('data-sc-verify-state')).not.toBe(a);
    // Approval pauses recorded time until scroll crosses the hold.
    await scrollAct(page, holdProgress);
    await expect(act).toHaveAttribute('data-sc-verify-state', /^pause:\d+$/, {
      timeout: 10_000,
    });
    expect(await act.getAttribute('data-sc-verify-state')).not.toBe(a);
    await scrollAct(page, 1);
    await expect(act).toHaveAttribute('data-sc-verify-state', /^render:\d+$/, {
      timeout: 10_000,
    });
    await scrollAct(page, subagents.from + (subagents.to - subagents.from) * 0.5);
    await expect(act).toHaveAttribute('data-sc-verify-state', /^subagents:\d+$/);
    await expect(act.locator('[data-stage-check][data-checked]')).toHaveCount(1);
    await scrollAct(page, 0.05);
    await expect(act).toHaveAttribute('data-sc-verify-state', /^stream:\d+$/);
    await expect(act.locator('[data-stage-check][data-checked]')).toHaveCount(0);
  });

  test('phones and reduced motion get the stills', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.getByTestId('stage-still-beat')).toHaveCount(5);
    await expect(page.locator('[data-stage-act]')).toHaveCount(0);
    await expect(page.locator('#stage .stage-check[data-checked]')).toHaveCount(
      5
    );
    await expect(
      page.locator('#stage [data-stage-proof], #stage .stage-ledger')
    ).toHaveCount(0);
    for (const still of await page.getByTestId('stage-still-beat').all()) {
      const label = await still.locator('.stage-still-text').boundingBox();
      const visual = await still.locator('.stage-still-visual').boundingBox();
      expect(label!.y + label!.height).toBeLessThanOrEqual(visual!.y);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.getByTestId('stage-still-beat')).toHaveCount(5);
    await expect(page.locator('[data-stage-act]')).toHaveCount(0);
    await expect(page.locator('#stage .stage-check[data-checked]')).toHaveCount(
      5
    );
    await expect(
      page.locator('#stage [data-stage-proof], #stage .stage-ledger')
    ).toHaveCount(0);
    for (const still of await page.getByTestId('stage-still-beat').all()) {
      const label = await still.locator('.stage-still-text').boundingBox();
      const visual = await still.locator('.stage-still-visual').boundingBox();
      expect(label!.y + label!.height).toBeLessThanOrEqual(visual!.y);
    }
  });
  test('short desktops keep every stage element within view', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-stage-act]')).toHaveCount(0);
    await expect(page.getByTestId('stage-still-beat')).toHaveCount(5);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/sc-ready/);
    await scrollAct(page, 1);
    const pin = await page.locator('.stage-pin').boundingBox();
    const inner = await page.locator('.stage-pin-inner').boundingBox();
    if (!pin || !inner) throw new Error('Pinned stage geometry is missing');
    expect(inner.y).toBeGreaterThanOrEqual(pin.y);
    expect(inner.y + inner.height).toBeLessThanOrEqual(pin.y + pin.height);
    await expect(page.getByTestId('stage-rail-close')).toHaveCSS('opacity', '1');
  });

  test('without JavaScript the five stills and their documentation remain available', async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(test.info().project.use.baseURL + '/');
    await expect(page.getByTestId('stage-still-beat')).toHaveCount(5);
    await expect(page.locator('#stage .stage-doc')).toHaveCount(5);
    await expect(page.locator('#stage iframe')).toHaveCount(0);
    await context.close();
  });
});
