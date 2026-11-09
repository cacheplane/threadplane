/**
 * NOT a test. Captures a frame of the hero walkthrough as the website's
 * server-rendered poster (1200x720, webp). Run through record-hero.config.ts:
 *   npx playwright test --config examples/chat/angular/e2e/record-hero.config.ts record-hero-poster
 *
 * Capture the completed first answer during the replay's two-second hold.
 * Wait for its final sentence and data-streaming=false, not elapsed time from
 * approval. Load fonts before that critical beat. The still omits the scripted
 * cursor and inert takeover control; the website supplies the real action.
 * Immediate empty-composer and absent-A2UI checks before and after screenshot
 * prevent a capture that crosses into the second prompt from being written.
 */
import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import sharp from 'sharp';

const OUT = resolve(__dirname, '../../../../apps/website/public/screenshots/hero-walkthrough-poster.webp');

test('capture hero poster', async ({ page }) => {
  await page.goto('/hero');
  await expect(page.locator('.hero__take')).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // The scripted cursor types prompt 1, sends, and the replay pauses on the
  // approval interrupt; the script then presses Accept.
  const interruptPanel = page.locator('chat-interrupt-panel');
  await interruptPanel.waitFor({ timeout: 60_000 });
  await interruptPanel.waitFor({ state: 'detached', timeout: 60_000 });
  const answer = page.locator('[data-hero-surface] chat-message[data-role="assistant"]').last();
  await expect(answer).toContainText('and any others not older than 90 days.');
  await expect(answer).toHaveAttribute('data-streaming', 'false');
  // Confirm the live control and replay beat before preparing the still image.
  await expect(page.locator('.hero__take')).toBeVisible();
  expect(await page.locator('[data-hero-surface] textarea').inputValue()).toBe('');
  expect(await page.locator('a2ui-surface').count()).toBe(0);
  expect(await page.locator('[data-hero-surface] chat-message[data-role="user"]').count()).toBe(1);
  // The website supplies the real Play/Takeover control. Exclude its inert
  // recorded counterpart while preserving exactly the live frame's geometry.
  const takeover = page.locator('.hero__take');
  const takeoverBox = await takeover.boundingBox();
  await takeover.evaluate((element) => { element.style.visibility = 'hidden'; });
  await page.locator('hero-cursor').evaluate((element) => { element.style.visibility = 'hidden'; });
  await expect(takeover).toBeHidden();
  expect(await takeover.boundingBox()).toEqual(takeoverBox);
  const png = await page.screenshot({ type: 'png', fullPage: false });
  // A capture that crosses into the next prompt must not replace the asset.
  expect(await page.locator('[data-hero-surface] textarea').inputValue()).toBe('');
  expect(await page.locator('a2ui-surface').count()).toBe(0);
  expect(await page.locator('[data-hero-surface] chat-message[data-role="user"]').count()).toBe(1);
  await sharp(png).webp({ quality: 82 }).toFile(OUT);
  console.log(`wrote ${OUT}`);
});
