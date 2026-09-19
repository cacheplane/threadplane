# Mobile above-the-fold rework — homepage hero

> Design spec. Status: IMPLEMENTED on branch blove/sharp-shaw-c45f8c.
> Two things stayed open and are named in §8: a CI check on the committed
> poster, and an equality guard across the card eyebrow surfaces.
> Scope: `apps/website` hero at phone widths. Desktop rendering is unchanged.

## 1. Why

PostHog project 406826, 30 days of homepage entry sessions to 2026-09-18, median
session duration by device:

| Browser | Device | Sessions | Median duration |
| --- | --- | --- | --- |
| Chrome | Desktop | 116 | 6.0s |
| Safari | Desktop | 51 | 275.0s |
| Mobile Safari | Mobile | 25 | 3.0s |
| Chrome | Mobile | 16 | 2.0s |

The mobile sample is ~41 sessions over 30 days, so the numbers are directional
only. They are not the justification on their own, and this is not a bounce
emergency: homepage bounce rate has fallen from 82.5% in May to 50.7% in
September, already below the 56% Technology-sector median (see
`2026-09-18-posthog-instrumentation-fix-design.md`, "Baseline and cutover").

The justification is the four defects below, each observed directly in a browser
at 375x812 against production. They stand without the analytics.

## 2. Defects, as measured

Measured at 375x812. The hero column is 335px wide.

1. **The H1 is four lines, 207px tall** — 25% of the fold. `--text-h1` resolves
   to 48px, at which "thread-plane" alone nearly fills the 335px column. The
   first span, "The open-source", wraps, breaking the word across its hyphen as
   "The open-" / "source".
2. **The mobile poster is sliced across its top edge.** A tool-result table is
   cut through horizontally, and its path column wraps to four lines
   (`3977/acme-db-backu` / `ps/prod/2` / `025-12-3` / `1.dump.gz`).
3. **No autoplay below 768px.** `MIN_AUTOPLAY_WIDTH = 768` in `HeroDemo.tsx`
   means phones get a static poster and a "Play walkthrough" button.
4. **"Angular" appears only in a small eyebrow.** It is not in the H1 and not in
   `<title>`. `docs/gtm/icp.md` puts a senior Angular engineer at 30 seconds to
   recognise fit.

### 2.1 Two corrections to the initial diagnosis

Recorded because both changed the shape of the fix.

**The mobile poster is purpose-built, not a scaled desktop capture.**
`HERO_POSTER_MOBILE` is a 390x650 CSS-pixel capture at `deviceScaleFactor: 2`,
shipped resized to 585x975 (1.5x). Displayed in a 335px stage it renders at
335/390 = 0.86 scale. Legibility is degraded but that is not the main fault.

**The slicing is drift from the chosen beat, not the chosen beat.**
`record-hero-poster-mobile.record.ts` deliberately captures the *first streamed
reply*, matching the desktop poster, and its header explicitly rejects the
approval-interrupt beat twice over: at phone height the interrupt panel slices
the user's prompt bubble behind it, and a still of a live Accept / Edit /
Respond dialog invites taps that do nothing. The same header warns that the
recorded answer's opening line must fit one line at 390px "or the whole block
shifts up and the first line is sliced off the top edge. Re-check it on every
re-record." That is what has happened. The recorder's guards — `.hero__take`
visible, composer empty, no `a2ui-surface` — cannot catch it, because none of
them inspects the top edge.

Consequence: keep the documented beat, fix the framing, and add the missing
guard. Note that the second objection to the interrupt beat dissolves once
mobile autoplays (the frame becomes live), but the first stands, so the beat
does not change.

## 3. The measurement the design rests on

Probed in-page at 375x812 with the real font, real column width and natural
wrapping, sweeping `font-size` against candidate wordings:

| Wording | 48px | 40px | 36px |
| --- | --- | --- | --- |
| `The open-source thread-plane for agents.` (today) | 4L / 207px | 4L | 3L / 117px |
| `The open-source thread-plane for Angular agents.` | 5L / 259px | 4L | **3L / 117px** |
| `The open-source thread-plane for Angular.` | 4L | 4L | 3L / 117px |
| `Angular's open-source thread-plane for agents.` | 4L | 4L | 3L / 117px |

At 36px every candidate is three lines. The H1 can therefore gain a word and
still shrink. **The type size, not the wording, is the binding constraint.** No
wording change fixes defect 1 at 48px.

The table's 48px column is measured against the shipped 3-span block layout, in
which each span gets its own line before wrapping. §5.2 also flows the spans
inline below 767px, so the real post-change figure is the 36px column: three
lines, 117px. See §5.2 for the two baselines this is measured against.

## 4. Resolving the messaging drift

`docs/gtm/messaging.md` locks a hero the site does not ship: H1 "Ship production
agent UIs in Angular." with a `Talk to our engineers` enterprise CTA fork. The
shipped hero is "The open-source thread-plane for agents." with an install
dialog.

**Decision:** keep the shipped category claim and add the stack to it. The H1
becomes `The open-source thread-plane for Angular agents.` — "Angular" is added
rather than traded for something, so the category claim survives intact.
`messaging.md` is updated to record this as the current hero, including the CTAs
as they actually ship. Rejected alternatives: restoring the documented H1 (drops
the category claim from the hero) and `Angular's open-source thread-plane…`
(the possessive implies an Angular-team endorsement we do not have).

This spec is the deliberate resolution the drift required; it does not leave a
third undocumented variant behind.

## 5. Changes

### 5.1 Copy — `apps/website/src/lib/positioning.ts`

Copy is single-sourced here and changed nowhere else.

| Constant | To |
| --- | --- |
| `HERO_H1` | `The open-source thread-plane for Angular agents.` |
| `HERO_H1_LINES` | `['The open-source', 'thread-plane for', 'Angular agents.']` |
| `HERO_EYEBROW` | `LangGraph & AG-UI` |
| `PRIMARY_TAGLINE` | `Threadplane — The open-source thread-plane for Angular agents` |

`HERO_H1_LINES` **stays three spans**, re-split to absorb the new word. This was
measured rather than assumed, because the array is also the line-breaking for
two generated card images. Canvas-measured widths in Archivo Black at the OG
card's 60px, with its -0.02em tracking:

| Line | Width @60px | Width @62px (GitHub card) |
| --- | --- | --- |
| `The open-source` | 538px | 556px |
| `thread-plane for` | 513px | 530px |
| `Angular agents.` | 507px | 524px |

The OG card's H1 column is ~536px wide and the GitHub card's ~588px. The widest
new line, `The open-source`, is a line that **already ships today** — so the
worst case is unchanged, the line count is unchanged, and neither card's
vertical rhythm moves.

A two-span split was considered first and rejected on this measurement:
`The open-source thread-plane` is 964px at 60px, nearly double the OG card's
column, and the cards are centred at fixed height, so overflow collides with the
pills below rather than pushing them down.

The invariant that the spans join back to `HERO_H1` with single spaces is
preserved, and `toHaveLength(3)` in `positioning.spec.ts` stays 3.

`HERO_EYEBROW` loses "Angular ·" because the H1 now carries it; repeating it
immediately above the H1 wastes the one line above the fold that is cheapest to
read.

`PRIMARY_TAGLINE` feeds `<title>` via `layout.tsx` and the site-wide OG/Twitter
defaults. Changing it is what resolves defect 4 in metadata rather than only on
screen. `HOME_TITLE` derives from it and follows automatically.

`HERO_SUBHEAD`, the CTA labels and `LONG_SUBHEAD` are unchanged.

Consumers to update, all mechanical: `opengraph-image.tsx`,
`github-card/route.tsx`, `site-metadata.spec.ts`, `positioning.spec.ts`,
`Hero.spec.tsx`, `card/card.spec.ts`.

Per `project_github_social_preview_pipeline`, the GitHub social preview has no
API and must be re-uploaded by hand after `npm run card:github`. This H1 change
alters that card, so the re-upload is part of the work, not a follow-up.

### 5.2 Type ramp — `apps/website/src/styles/landing.css`

Add, in the existing unlayered region (these rules must stay unlayered or
Tailwind utilities win — see the file header):

```css
@media (max-width: 767px) {
  .hero-heading { font-size: 36px; line-height: 1.08; }
  /* Let the H1 wrap to the column instead of breaking where the desktop
     composition wants. The spans are the desktop and card line-breaking; at
     phone width they would force "The open-source" onto a line of its own,
     which then wraps again — the four-line H1. */
  .hero-heading-line { display: inline; }
}
```

Desktop is untouched. This is the load-bearing change.

Be precise about the baseline, because there are two and both are real. The
4-line / 207px figure in §2 and §3 is what **production shipped**, measured
against the shorter pre-Angular H1. Once §5.1 lengthens the H1, the same
block-span layout at the 48px clamp floor is **6 lines / 311px** — all three
spans wrap, not just the first. Against the copy that now ships, this rule
therefore reclaims ~194px (~24% of an 812px fold), not 90px.

(Confirmed in-browser after §5.1 landed: 116.63px, three lines, with
`[data-hero-demo]` at y=501.42.)

Two coupled parts, and both are needed:

- **36px.** `--text-h1` is `clamp(48px, 6vw, 72px)` in
  `libs/design-tokens/src/lib/theme.css`. At 375px, 6vw is 22.5px, so the
  **clamp floor** of 48px is what actually renders. The token is shared by many
  pages, so the override belongs on `.hero-heading` in the website's
  `landing.css`, not in the token.
- **`display: inline`.** `.hero-heading-line { display: block }` is what forces
  the four lines: span 1 is given its own line and then wraps. Flowing the
  spans at phone width lets the browser break the sentence to fit, which is
  what produces three lines at 36px.

Checked across the clamp's range so the desktop composition cannot regress: the
widest line scales as ~8.97 x font-size, which fits the container at 768px
(430px needed / ~728px available), at 1000px (538 / ~960) and at 1200px+
(646 / 1200).

### 5.3 Demo autoplay — `apps/website/src/components/landing/HeroDemo.tsx`

`MIN_AUTOPLAY_WIDTH` 768 → 0, reducing `autoplayAllowed()` to its
`prefers-reduced-motion` check. `needsClick`, the `playRequested` state and
`.hero-demo-play` all stay: they remain the path for a reduced-motion visitor at
any width.

The 3:5 stage ratio and `HERO_POSTER_MOBILE_MEDIA` **do not move for this
change**. They are coupled to the poster's 390x650 geometry, not to autoplay, so
enabling autoplay does not disturb them. (They may still move for an unrelated
reason if the re-record in 5.4 cannot frame the beat at 390x650; that
contingency is described there.) The triple documented
in `HeroDemo.tsx` and `landing.css` therefore becomes a pair, and both comments
must be rewritten to say so — leaving them claiming a three-way coupling that no
longer exists is how the next person breaks it.

A live iframe lays out at the stage's real width, so its type renders at its
designed size rather than the poster's 0.86. Autoplay improves legibility by
construction; it is not only a motion change.

### 5.4 Poster re-record — `record-hero-poster-mobile.record.ts`

Re-run the recorder against the current `public/hero-replay.json` and add the
guard the header asks for but never encodes: assert the first message block's
top edge sits **below** the stage's top edge, so a shifted block fails the
capture instead of shipping sliced.

If the documented beat cannot be framed whole at 390x650 against the current
replay, the height budget moves; `POSTER_MOBILE_W`, `POSTER_MOBILE_H`, the
`aspect-ratio` in `landing.css` and `SHIP_WIDTH` then move together, preserving
the 3:5 ratio that makes `object-fit: cover` a no-op.

Recording command is in the recorder's header.

### 5.5 Tests

- `home-hero.spec.ts` — "mobile shows Play walkthrough instead of the frame"
  inverts: at 390px the iframe must now mount. The desktop test's comment about
  the three-line H1 leaving the stage short of the 25% threshold is re-measured,
  not merely reworded.
- **New fold guard at 375x812**, the assertion defect 1 never had. Two absolute
  budgets, not comparisons against whatever currently renders:
  - `.hero-heading` height **≤ 130px** (three lines at 36px/1.08 measure 117px;
    13px of headroom absorbs font-loading and metric variance).
  - `[data-hero-demo]` top offset **≤ 560px**. Measured at 501.42px after §5.2
    landed, against an 812px fold. Measure `[data-hero-demo]`, not
    `.hero-demo-stage` — the stage sits ~48px lower inside the BrowserFrame
    chrome, so budgeting it at 560 would be a far tighter guard than intended.

  Budgeting absolutely rather than relatively is deliberate, per
  `feedback_guard_coupled_to_moving_artifact`: a guard that compares against the
  current render passes vacuously once the thing it guards drifts. Per
  `feedback_hero_height_breaks_demo_iframe_e2e`, hero height
  and the demo's intersection threshold are already known to be coupled; this
  guard makes that coupling explicit rather than incidental.
- Unit specs listed in 5.1 updated for the new strings.

## 6. Constraints honoured

- Copy changes land in `positioning.ts` only.
- `landing.css` additions stay unlayered.
- No competitor is named in any tracked file.
- Public-copy contract (`public-copy-contract.ts` + `public-copy.spec.ts`): the
  new H1 and tagline make no absolute claim and name no retired route.

## 7. Verification

`nx test website` and `nx lint website` do not typecheck; only
`nx build website` catches a broken production build. All three run.

`nx test` rewrites a generated package-version file — check `git status` before
staging (`feedback_nx_test_regenerates_package_version`).

The binding check is a real 375x812 viewport against a local production build,
not unit tests: measure the rendered H1 height, confirm three lines, confirm the
demo stage's top offset, confirm the iframe mounts, and confirm the poster is
unsliced. Evidence is a screenshot plus the measured numbers, not an assertion
that it looks fine.

## 8. Risks

**Mobile autoplay puts a third-party iframe on phone data and CPU.** The poster
is the LCP element. LCP is measured before and after at 375x812; a regression is
reported rather than shipped quietly, and the fallback is to restore a
`MIN_AUTOPLAY_WIDTH` floor.

**`hero-replay.json` is load-bearing for the poster's framing.** It already was,
silently — that is defect 2.

The top-edge guard narrows this but does not close it, and the distinction
matters: it converts a silent drift into a failing **re-record**, not a failing
CI run. It lives inside the recorder, which only executes when someone
deliberately re-records. So a change to `hero-replay.json` or to the backup
table's phone layout can still land with the committed poster going stale and
nothing red. Closing it properly would mean asserting the committed poster in
CI, which is OPEN.

The guard is also deliberately narrow in a second way: it rejects a message
*straddling* the scroll edge, and allows one wholly above it. If the geometry
ever drifts far enough that the backup table scrolls entirely out of frame, the
capture passes while no longer showing the thing the beat is about.

**The H1 is consumed by two generated images.** `opengraph-image.tsx` and
`github-card/route.tsx` both lay out `HERO_H1_LINES`. The re-split in 5.1 was
measured to keep three lines with an unchanged worst-case width, so this risk is
retired by construction rather than by inspection — but both cards are still
checked visually, and the GitHub card is re-uploaded by hand.

## 9. Out of scope

Below-the-fold mobile layout, the navbar, the stage/pinned-act sequence, and the
`messaging.md` sections other than the hero and its CTAs.
