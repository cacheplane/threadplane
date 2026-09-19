/**
 * NOT a test. Captures one still per beat from the committed stage replay, at
 * desktop and phone widths, for the website's non-pinned fallback (spec §8).
 *   npx playwright test --config examples/chat/angular/e2e/record-stage.config.ts record-stage-stills
 *
 * Each still is taken at a SETTLED moment of its beat (the beat's end, or the
 * middle of the authored hold for approve), read from `window.__stageTimeline`
 * so a re-recorded fixture moves the capture points with it. The recorder
 * waits on `window.__stageApplied.t` reaching the target: the controller
 * clamps a seek to `[0, totalMs]` and every target here is inside that range,
 * so equality is the right wait.
 *
 * Geometry: the desktop frame is the 1200x720 the stage is authored for, with
 * the devtools docked right. Below 768px the stage renders NO devtools (see
 * `readStageDock` — the phone path is chat only, a docked panel would eat the
 * transcript), so the phone still is the chat at 390x650 (3:5). This is the
 * stage stills' OWN ratio and is no longer shared with the hero poster, which
 * moved to 390x906 (65:151) so its capture frames the streamed backup table
 * whole; the two assets are independent now. `deviceScaleFactor: 2` applies to BOTH sizes:
 * the desktop still is a 2400-wide raster downscaled to 1200, and the phone
 * still a 780-wide raster downscaled to 585 — crisp downscales rather than a
 * 1x raster shipped as-is or a 1.5x upscale of a 390px one.
 */
import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import sharp from 'sharp';
import type { StageBeat } from '../src/app/stage/stage-recording.types';
import type { StageTimeline } from '../src/app/stage/stage-timeline';

const OUT_DIR = resolve(__dirname, '../../../../apps/website/public/screenshots');
const SIZES = [
  { suffix: '', width: 1200, height: 720, ship: 1200 },
  { suffix: '-mobile', width: 390, height: 650, ship: 585 },
];
/** The website's budget per still; the hero poster ships well under it too. */
const MAX_BYTES = 120 * 1024;

test.use({ deviceScaleFactor: 2 });

test('capture stage stills', async ({ page }) => {
  await page.goto('/stage?t=0');
  await page.waitForFunction(() => !!window.__stageTimeline);
  const tl = await page.evaluate(() => window.__stageTimeline as StageTimeline);
  const endOf = (b: StageBeat) => {
    const hit = tl.beats.find((x) => x.beat === b);
    if (!hit) throw new Error(`recording has no "${b}" beat`);
    return hit.endMs;
  };
  const settle: Record<string, number> = {
    stream: endOf('stream'),
    subagents: endOf('subagents'),
    persist: endOf('persist'),
    approve: tl.hold.startMs + Math.round((tl.hold.endMs - tl.hold.startMs) / 2),
    render: tl.totalMs,
  };
  // Collected, not asserted per file: a throw mid-loop would leave the set
  // half rewritten. Every offender is listed once after both loops.
  const oversized: string[] = [];
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const [beat, t] of Object.entries(settle)) {
      await page.goto(`/stage?t=${t}`);
      await page.waitForFunction((target) => window.__stageApplied?.t === target, t, {
        timeout: 60_000,
      });
      await page.waitForTimeout(400);
      if (beat === 'subagents') {
        const card = page.locator('chat-subagent-card').last();
        await expect(card).toBeAttached();
        const collapsed = card.locator('[aria-expanded="false"]');
        if (await collapsed.count()) await collapsed.first().click();
        await card.scrollIntoViewIfNeeded();
        await expect(card).toContainText(/120/);
      }
      // What keeps a mistimed capture from shipping silently.
      if (beat === 'approve') {
        await expect(page.locator('chat-interrupt-panel')).toBeAttached();
        await expect(page.locator('app-backup-table [data-state="rows"]')).toBeAttached();
      }
      if (beat === 'render') {
        await expect(page.locator('a2ui-surface').first()).toBeAttached();
        await expect(page.getByRole('textbox', { name: 'Follow-up notes' })).toBeVisible();
        await expect(page.locator('a2ui-surface').first()).not.toContainText('Building UI');
        await expect(page.locator('chat-interrupt-panel')).toHaveCount(0);
      }
      const png = await page.screenshot({ type: 'png', fullPage: false });
      const out = resolve(OUT_DIR, `stage-${beat}${size.suffix}.webp`);
      const info = await sharp(png)
        .resize({ width: size.ship })
        .webp({ quality: 60, effort: 6 })
        .toFile(out);
      if (info.size > MAX_BYTES) oversized.push(`${out} (${info.size} bytes)`);
      console.log(`wrote ${out} (${Math.round(info.size / 1024)} KB)`);
    }
  }
  expect(oversized, `stills over ${MAX_BYTES} bytes:\n${oversized.join('\n')}`).toEqual([]);
});
