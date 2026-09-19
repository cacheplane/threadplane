/**
 * NOT a test. Captures the phone-width companion to
 * `record-hero-poster.record.ts`: the same walkthrough beat rendered at phone
 * dimensions, rather than cropped out of the 1200x720 desktop capture.
 *
 * Beat: the FIRST STREAMED REPLY, the same beat as the desktop poster, so
 * crossing the 768px breakpoint swaps the source without changing the story.
 * The approval-interrupt beat was the other candidate and was rejected twice
 * over: at phone height the panel slices the user's prompt bubble behind it,
 * and a still of a live Accept / Edit / Respond dialog invites taps that do
 * nothing.
 *
 * The wait is about the scripted cursor, not the text. Until the resumed answer
 * finishes and HOLD_AFTER_ANSWER_MS elapses the cursor stays parked where it
 * pressed Accept, which at phone width drops the arrowhead onto the
 * `delete_backups` tool chip. It then glides to the composer for CURSOR_MOVE_MS
 * and typing starts the moment it arrives, so the only clean frame is mid-glide:
 * cursor en route, composer still empty. Measured against the 2026-09-05
 * recording by sampling the DOM every 250ms after the panel detaches: parked
 * until ~4.6s, gliding until ~5.3s, typing from ~5.4s, send at ~8.5s. 5000ms
 * is late in the glide, past the answer text and above the composer. Runs drift
 * by up to a second, so if a capture shows
 * the arrowhead back on the chip, re-run rather than retune. (7400ms landed
 * AFTER the second prompt had been sent, which the assertions below cannot
 * catch: the composer has cleared again by then.) The desktop recorder keeps
 * its own value because its Accept spot is empty space. Re-measure whenever
 * `public/hero-replay.json` changes.
 *
 * THE HEIGHT BUDGET IS DERIVED FROM THE REPLAY, not chosen. The timeline is
 * pinned to the BOTTOM, so the frame's top edge — the top of the chat's own
 * scroll container, NOT y=0 — falls wherever (capture height) puts it, and it
 * must land in a GAP between blocks or the poster opens mid-block. Growing the
 * capture height therefore reveals more ABOVE; the bottom of the story (answer,
 * composer, "Take control ↗") stays put at every height.
 *
 * The windows below were MEASURED from the DOM at h=866, AFTER the responsive
 * backup table landed (the `@media (max-width: 479px)` block in
 * `examples/chat/angular/src/app/backup-table.component.ts`, which stacks each
 * backup into a two-line block instead of a four-line-wrapped row and took the
 * table from 583px to 268px tall). They are NOT projections, and they must be
 * re-measured if EITHER that table layout OR `public/hero-replay.json` changes.
 *
 * The four `chat-message` boxes, in viewport coordinates at h=866 (the edge
 * sits at y=62 and does NOT move with the height):
 *
 *   user prompt                 -54 ..  10
 *   list_backups result table    34 .. 388
 *   `delete_backups` chip       412 .. 455
 *   "Deleted 3 backups (...)"   479 .. 705
 *
 * Because the timeline is bottom-pinned, raising h by Δ shifts every box down
 * by Δ while the edge stays at 62, so a candidate height h clears the edge iff
 * 62 falls in a gap once shifted — i.e. h = 928 - e for an edge position e in
 * the h=866 coordinates above. That gives:
 *
 *   h ∈ (449, 473)   edge in the gap below the `delete_backups` chip
 *   h ∈ (516, 540)   edge in the gap below the table
 *   h ∈ (894, 918)   edge in the gap ABOVE the table  ← this one
 *   h ≥ 983         edge above the user's prompt too (whole conversation)
 *
 * 906 is the middle of the third window: Δ=40 puts the prompt's bottom at 50,
 * wholly above the edge and so cleanly scrolled out, and the table's top at 74,
 * clear below it. It frames the WHOLE backup table — the result the approval
 * beat is about — and, because this height also governs the live autoplaying
 * iframe below 768px, it gives the phone demo more viewport than it has ever
 * had. (526, the middle of the second window, framed the story but shrank the
 * live stage; that trade was rejected.) 906 is even, so it halves to an integer
 * at the 1.5x ship scale.
 *
 * 650 was the budget until the approval tools became executable (#1011). That
 * commit replaced a short prose answer with a run that streams a backup TABLE,
 * and 650 straddled that table's bottom edge — the poster shipped opening on a
 * table cut through horizontally, with its path column wrapped to four lines.
 * The old rule of thumb ("the answer's opening line has to fit on ONE line at
 * 390px") no longer decides anything on its own. The guard in the test body
 * fails loudly with the measured numbers when it drifts again.
 *
 * Geometry: 390 is the phone design width the reviews already use. The ratio is
 * therefore 390:906, which reduces to 65:151 — `.hero-demo-stage` below 768px
 * and POSTER_MOBILE_W/H in HeroDemo.tsx carry the same pair so `object-fit:
 * cover` still crops nothing, and all three must move together. The frame is
 * captured at deviceScaleFactor 2 for crisp glyph rasterisation and shipped
 * resized to 585x1359 (1.5x, and 585:1359 is the same 65:151): the poster is
 * displayed ~348 CSS px wide on a phone, and 2x would cost far more against the
 * desktop poster's ~37KB.
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

test.use({ viewport: { width: 390, height: 906 }, deviceScaleFactor: 2 });

test('capture mobile hero poster', async ({ page }) => {
  await page.goto('/hero');
  // The scripted cursor types prompt 1, sends, and the replay pauses on the
  // approval interrupt; the script then presses Accept.
  const interruptPanel = page.locator('chat-interrupt-panel');
  await interruptPanel.waitFor({ timeout: 60_000 });
  await interruptPanel.waitFor({ state: 'detached', timeout: 60_000 });
  await page.waitForTimeout(5000);
  // Guards the beat: `.hero__take` ships in normal flow, and a composer with
  // the next prompt already typed into it means the wait has drifted late. The
  // a2ui check catches a capture that drifted PAST typing into the second run,
  // where the composer has cleared again and would satisfy the check above.
  await expect(page.locator('.hero__take')).toBeVisible();
  await expect(page.locator('[data-hero-surface] textarea')).toHaveValue('');
  await expect(page.locator('a2ui-surface')).toHaveCount(0);
  // Guards the TOP EDGE, which none of the checks above can see. The clipping
  // edge is NOT the viewport's y=0: the timeline lives in its own scroll
  // container (`.chat-scroll` in libs/chat's chat composition), whose top sits
  // below the `.hero__bar` at about y=62. A block scrolled off the top is
  // clipped there, so a message with a positive y can still be sliced.
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
  const png = await page.screenshot({ type: 'png', fullPage: false });
  // quality 40, not the 55 this used to ship at. Going from a 526-tall capture
  // to 906 added ~72% more pixels and pushed q55 to 39,016 bytes, over the
  // 36,000-byte assertion in apps/website/src/components/landing/HeroDemo.spec.tsx.
  // Measured from one capture, single-encode: q55 39,050 / q50 37,880 /
  // q45 36,394 / q40 34,094 / q35 32,264. q45 still misses the budget by ~400
  // bytes; q40 clears it with ~1.9KB of headroom and is indistinguishable from
  // q55 at 1:1 in the densest text (the table's monospace ids and s3 paths),
  // let alone at the ~348 CSS px the poster is actually displayed at. Lower the
  // quality before raising that budget: this poster is the LCP element on
  // phones, and mobile autoplay was justified partly on LCP not regressing.
  await sharp(png).resize({ width: SHIP_WIDTH }).webp({ quality: 40, effort: 6 }).toFile(OUT);
  console.log(`wrote ${OUT}`);
});
