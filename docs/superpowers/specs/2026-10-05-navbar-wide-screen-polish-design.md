# Navbar wide-screen polish — design

Date: 2026-10-05
Status: approved, ready for an implementation plan
Surface: `apps/website` desktop bar (`lg` and up) and its hover panels, every route
Builds on: `2026-09-08-navbar-redesign-design.md`

## Problem

On a wide screen the bar and its panels spread across the whole viewport.

Measured on the homepage at 1920×1000:

| Element | Today |
| --- | --- |
| Bar row | 1920px wide; logo at x=32, link cluster starts at x=1315 |
| Docs panel | 1920px wide; each of its three columns is 607px for ~250px of content |
| Libraries panel | 1920px wide; each of its four cards is ~460px |
| Page sections below | 1200px, centered (x=360 to x=1560) |

Even at the 1440px design viewport the panel is a full-width sheet, because
`.nav-panel-shell` is positioned `left: 0; right: 0` against `.nav-bar > div`, and that
row has no max-width.

Two things drifted from the approved redesign. The spec cited the shadcn
`navigation-menu` pattern, whose viewport is intrinsic-width and anchored to the trigger
list, but the panel shipped full-bleed. The spec described the row as "logo, the four
triggers, then right-aligned GitHub mark and Talk to Us", but the four triggers shipped
inside the right-hand cluster.

The UI/UX Pro guideline `container-width` asks for one consistent desktop max-width across
the page; the page body already has one (1200px) and the bar ignores it.

## Decisions

| Question | Decision |
| --- | --- |
| Bar width on marketing routes | Constrained to the page container: 1200px of content, centered, same edges as the sections below |
| Bar width on docs routes | Unchanged, full-bleed. The docs shell is full-bleed (rail at x=56), and the logo sits over the rail |
| Row layout | Logo, then the four triggers on the left; GitHub mark and Talk to Us on the right. Every route |
| Panel width | Intrinsic: as wide as its columns, never the bar |
| Panel anchor | Left edge under its trigger, clamped so the panel never leaves the row's content box |
| Libraries panel below 1200px | Its four cards drop to a 2×2 grid; at 1200px and above they stay four across |
| Panel surface, caret, hover timing, bridge, mobile drawer | Unchanged |

Rejected, and why:

- **Links grouped right, panels right-aligned** — the smallest change, but it keeps the
  logo and the links at opposite ends of the row, which is the complaint.
- **Links centered** — reads well on a short bar, but the panels then need to center
  under a cluster that sits nowhere near the container edges, so the widest panel
  (Libraries) must overflow one side or the other and be clamped anyway.
- **Pure-CSS per-trigger anchoring** — wrap each trigger in a `position: relative` box
  and let `left: 0` do the anchoring. It works at 1440px and above, but the Docs panel
  (~900px) overflows the viewport from the Docs trigger below ~1180px, and the only
  CSS tool that clamps that is anchor positioning, which is not yet safe to rely on.
- **Shrinking the columns until every panel fits from its trigger at 1024px** — the
  Libraries labels (`@threadplane/langgraph`) do not wrap, so the floor is ~225px per
  card, and four of them is still 966px.
- **Container-wide panels (1200px)** — tighter than today, but a 1200px sheet for the
  two-column Solutions panel is still three times its content.

## Design

### Row

`Nav.tsx` keeps one row. On marketing routes the row gets a max-width equal to the
container plus its own horizontal padding, centered:

```css
.nav-bar[data-route='marketing'] > div {
  max-width: calc(1200px + 2 * 32px); /* content box lines up with the sections */
  margin-inline: auto;
}
```

The docs row keeps its existing flat padding and full width.

`NavDesktop` renders two groups inside its flex box instead of one:

- `.nav-desktop-primary` — the four triggers, placed after the logo with a 40px lead
  (`margin-left: 40px`), 32px between triggers as today.
- `.nav-desktop-actions` — GitHub mark and Talk to Us, pushed right with
  `margin-left: auto`.

`.nav-desktop` becomes `flex: 1` so the actions group can reach the row's right edge.
Hover close-on-leave stays on the outer `.nav-desktop`, so moving from a trigger to the
CTA still closes the panel.

### Panel anchoring

`.nav-panel-shell` keeps `.nav-bar > div` as its containing block (the `position:
static` on `.nav-desktop` and the comment explaining it stay). It loses `right: 0` and
gains `left: var(--nav-panel-left, 0)`. `.nav-panel` becomes `width: max-content`.

`NavDesktop` sets `--nav-panel-left` on the shell in a layout effect when a panel opens,
and again on window resize while it is open:

```
left = clamp(trigger.offsetLeft,
             row.paddingLeft,
             row.clientWidth - row.paddingRight - panel.offsetWidth)
```

The clamp is a pure function in `nav-panel-position.ts` so jsdom can test the
arithmetic. `offsetLeft` is relative to `.nav-bar > div` because that is the nearest
positioned ancestor, which is why `.nav-desktop` must stay `position: static`.

A layout effect runs before paint, so the panel never flashes at `left: 0` first.

### Panel sizing

- `.nav-panel-cols`: `grid-auto-columns: 16.5rem` (264px) and a 20px column gap. Longer
  descriptions wrap to a second line; no description today needs more than two.
- Libraries (`data-columns='1'`): the four cards are 16.5rem tracks too. Below 1200px
  (`@media (max-width: 1199px)`) the card grid becomes `grid-template-columns: 1fr 1fr`
  with `grid-auto-flow: row`.
- `.nav-panel`: `max-width: calc(100vw - 48px)` as a last-resort guard.

Resulting panel widths (padding included). At 1440px the row's content box runs from
x=120 to x=1320 and the Docs trigger sits at x≈423, so 423 + 880 = 1303 stays inside:

| Panel | Width | Notes |
| --- | --- | --- |
| Libraries | ~1122px | Spans most of the 1200px container; clamps to its right edge at 1440px |
| Docs | ~880px | Opens under the Docs trigger at 1440px and up; clamped to the content box below that |
| Solutions | ~596px | Opens under the Solutions trigger at every width from 1024px up |

### What does not change

The bar's translucent surface, `--nav-h` ladder, the docs CTA demotion, the hover
open/close delays, the transparent bridge in `.nav-panel-shell`, keyboard handling,
focus movement into the panel, the no-border rule inside panels, and the mobile drawer.

## Testing

Unit (vitest, jsdom):

- `nav-panel-position.spec.ts` covers the clamp: a trigger with room keeps its own
  offset; a trigger near the right edge is pulled left to the content box; a panel wider
  than the row pins to the left padding.
- `Nav.spec.tsx` keeps passing; the trigger and CTA roles are unchanged.

Browser (`apps/website/e2e/nav-panels.spec.ts`, Playwright):

- At 1440px, each panel's left edge sits within 2px of its trigger's left edge
  (Docs, Solutions) or at the row's right-edge clamp (Libraries), and no panel's right
  edge passes the row's content box.
- At 1920px, the panel is narrower than the viewport, and the logo's left edge equals
  the first homepage section's content left edge (both 360px).
- At 1024px, the Docs panel still fits inside the viewport.
- Existing assertions (four libraries side by side, columns stacked, no borders, focus
  into panel, hover bridge) stay as they are.

`e2e/nav-height.spec.ts` is unaffected: the row's height is set by its padding and the
40px CTA, neither of which moves.

## Files

| File | Change |
| --- | --- |
| `apps/website/src/components/shared/NavDesktop.tsx` | Two groups; layout effect that positions the open shell |
| `apps/website/src/components/shared/nav-panel-position.ts` | `clampPanelLeft()` |
| `apps/website/src/components/shared/nav-panel-position.spec.ts` | Unit tests for the clamp |
| `apps/website/src/styles/chrome.css` | Row max-width on marketing; shell `left` var; panel `max-content`; column tracks; Libraries 2×2 step |
| `apps/website/e2e/nav-panels.spec.ts` | Anchoring and container-alignment assertions |
