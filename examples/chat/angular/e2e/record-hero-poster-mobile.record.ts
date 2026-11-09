/**
 * Capture the phone companion to the desktop hero poster at the first streamed
 * reply, after the scripted approval. Wait for the complete first answer during
 * the replay's two-second hold, with fonts already loaded. The still excludes
 * the scripted cursor and inert control; immediate empty-composer and absent-
 * A2UI guards before and after capture keep it on this beat.
 *
 * Framing follows the replay's block boundaries. With the current replay
 * chrome at 390x906, the backup table measured y=29..383 and the scroll edge
 * was y=96: the frame sliced 67px from the table. The preceding user message
 * ended at y=5. Increasing the capture height to 988 adds 82px above the
 * bottom-pinned transcript, placing that user ending at 87 and the table at
 * 111..465, with the edge in the gap. The top-edge guard verifies that framing.
 *
 * Capture at 390x988 with deviceScaleFactor 2 and ship at 585x1482 (1.5x).
 * The matching ratio is 195:494 in HeroDemo.tsx and landing.css. Change all
 * three together when measured replay geometry changes. This ratio also
 * sizes the live mobile iframe; the extra height serves poster framing.
 * Keep the mobile image within the existing 36,000-byte budget.
 *
 *   npx playwright test --config examples/chat/angular/e2e/record-hero.config.ts record-hero-poster-mobile
 */
import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import sharp from 'sharp';

const OUT = resolve(
  __dirname,
  '../../../../apps/website/public/screenshots/hero-walkthrough-poster-mobile.webp',
);
const SHIP_WIDTH = 585;

test.use({ viewport: { width: 390, height: 988 }, deviceScaleFactor: 2 });

test('capture mobile hero poster', async ({ page }) => {
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
  // Guards the beat: `.hero__take` ships in normal flow, and a composer with
  // the next prompt already typed into it means the wait has drifted late. The
  // a2ui check catches a capture that drifted PAST typing into the second run,
  // where the composer has cleared again and would satisfy the check above.
  await expect(page.locator('.hero__take')).toBeVisible();
  expect(await page.locator('[data-hero-surface] textarea').inputValue()).toBe('');
  expect(await page.locator('a2ui-surface').count()).toBe(0);
  expect(await page.locator('[data-hero-surface] chat-message[data-role="user"]').count()).toBe(1);
  // Guards the TOP EDGE, which none of the checks above can see. The clipping
  // edge is NOT the viewport's y=0: the timeline lives in its own scroll
  // container (`.chat-scroll` in libs/chat's chat composition), whose top sits
  // below the `.hero__bar` at y=96 with the current chrome. Blocks scroll out
  // there, so a message with a positive y can still be sliced.
  // A message that is wholly above that edge (the user's prompt, which may
  // legitimately scroll out of frame) is fine; a message that STRADDLES it is
  // the defect — the poster then opens mid-table or mid-sentence.
  // `chat-message` is the element selector exported by libs/chat
  // (primitives/chat-message/chat-message.component.ts).
  await expect(page.locator('[data-hero-surface] chat-message').last()).toBeVisible();
  const straddling = await page.evaluate(() => {
    const surface = document.querySelector('[data-hero-surface]');
    if (!surface) throw new Error('no [data-hero-surface]');
    const scrollableTop = (el: Element): number => {
      for (let n: Element | null = el.parentElement; n; n = n.parentElement) {
        const oy = getComputedStyle(n).overflowY;
        if (oy === 'auto' || oy === 'scroll') return n.getBoundingClientRect().top;
      }
      return 0;
    };
    return [...surface.querySelectorAll('chat-message')]
      .map((m) => {
        const r = m.getBoundingClientRect();
        const edge = scrollableTop(m);
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), edge: Math.round(edge),
          text: (m.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) };
      })
      // 1px of tolerance for sub-pixel layout; anything more is a real slice.
      .filter((m) => m.top < m.edge - 1 && m.bottom > m.edge + 1);
  });
  if (straddling.length > 0) {
    throw new Error(
      `a message is sliced by the frame's top edge: ${JSON.stringify(straddling)} ` +
        `(top/bottom/edge in CSS px). The capture height no longer lands in a gap ` +
        `between blocks. Re-derive the gaps from these numbers and move the ` +
        `viewport height here, POSTER_MOBILE_W/H in ` +
        `apps/website/src/components/landing/HeroDemo.tsx and the ` +
        `.hero-demo-stage aspect-ratio in apps/website/src/styles/landing.css ` +
        `TOGETHER — see this file's header.`,
    );
  }
  // The website supplies the real Play/Takeover control. Exclude its inert
  // recorded counterpart while preserving exactly the guarded frame geometry.
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
  // Quality 40 keeps this capture below the 36KB mobile poster budget.
  // Inspect the text if a future capture needs a lower encoding quality.
  await sharp(png).resize({ width: SHIP_WIDTH }).webp({ quality: 40, effort: 6 }).toFile(OUT);
  console.log(`wrote ${OUT}`);
});
