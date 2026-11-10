# Chat UI design guide

Internal guide for the Threadplane chat UI. It describes how every part of the
chat library should look and behave, and how status, progress, failure,
approval and receipts are shown.

- **Source of truth:** the Angular library, `@threadplane/chat` (`libs/chat`).
  Its tokens live in `libs/chat/src/lib/styles/chat-tokens.ts`.
- **Borrowed rules:** the design rules from the LiveLoveApp site (no shadows on
  content, no uppercase labels, hairline rules, one moving element, ink primary
  buttons, underlined links, plain voice). We borrow the rules, not the look:
  the chat keeps its neutral default palette and system fonts.
- **Not a source:** the React library (`libs/react`). It is brought into line
  with this guide later, not the other way round.
- **Not published.** This file is for contributors. Public docs describe the
  API; this guide describes the design decisions behind it.

Sections marked **Today** describe the code as it is. Sections marked
**Target** are decisions that the code does not meet yet. The gap list at the
end tracks the work.

## 1. Principles

1. **The conversation is the interface.** Status, approvals, failures and
   receipts appear in the transcript, next to the work they describe. Nothing
   that needs a decision is hidden behind a modal.
2. **Words carry meaning, color supports it.** Every state is named in text.
   Color, icons and motion repeat what the words say, so the UI still reads in
   forced colors, with color blindness, and with a screen reader.
3. **Quiet by default, loud when it matters.** Settled work collapses to one
   line. Panels with tint appear only for something you must read or act on.
4. **One moving element per view.** At most one thing animates at a time, and
   reduced motion stops it.
5. **Never claim what has not happened.** A receipt appears only after the save
   is confirmed. A step is "done" only when its result arrived.
6. **Everything is a token.** No literal colors, shadows, radii, durations or
   z-index values in component styles. Consumers theme the chat by overriding
   `--tplane-chat-*` on `:root`.

## 2. Tokens

Tokens are set on `:root` inside `@layer tplane-chat`, so an unlayered consumer
rule always wins. Dark values apply under `prefers-color-scheme: dark`,
`[data-theme="dark"]` and `[data-threadplane-chat-theme="dark"]`. Every color
token has a light and a dark value; a token with only one value is a bug.

### 2.1 Neutral palette (Today, keep)

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--tplane-chat-bg` | `rgb(255,255,255)` | `rgb(17,17,17)` | Page behind the chat |
| `--tplane-chat-surface` | `rgb(255,255,255)` | `rgb(28,28,28)` | Chat surfaces, menus |
| `--tplane-chat-surface-alt` | `rgb(251,251,251)` | `rgb(44,44,44)` | Hover and selected rows, floating surfaces in dark |
| `--tplane-chat-text` | `rgb(28,28,28)` | `rgb(245,245,245)` | Body text ("ink") |
| `--tplane-chat-text-muted` | `rgb(115,115,115)` | `rgb(160,160,160)` | Secondary text, status words |
| `--tplane-chat-separator` | `rgb(229,229,229)` | `rgb(45,45,45)` | Hairline rules and borders |
| `--tplane-chat-primary` | `rgb(28,28,28)` | `rgb(255,255,255)` | Primary button fill, user bubble |
| `--tplane-chat-on-primary` | `rgb(255,255,255)` | `rgb(28,28,28)` | Text on primary |

`--tplane-chat-text-muted` must meet 4.5:1 on `surface` and `surface-alt` in
both themes, because status words and the progress shimmer use it as text.
Today: 4.7:1 on white, 4.6:1 on `surface-alt`, 6.5:1 on the dark surface and
5.3:1 on dark `surface-alt`.

### 2.2 Status colors (Target)

One family per meaning, each with text, background and border. Today there are
several reds and greens and one undefined token (`--tplane-chat-error`, used by
tool activity with a `#b42318` fallback).

| Meaning | Text | Background | Border | Used for |
| --- | --- | --- | --- | --- |
| Danger | `--tplane-chat-error-text` | `--tplane-chat-error-bg` | `--tplane-chat-error-border` | Failed calls, run errors, destructive approvals |
| Warning | `--tplane-chat-warning-text` | `--tplane-chat-warning-bg` | `--tplane-chat-warning-border` (new) | Waiting for approval, stopped |
| Success | `--tplane-chat-success-text` | `--tplane-chat-success-bg` (new) | `--tplane-chat-success-border` (new) | Receipts after a confirmed save |

Rules:

- Status text must meet 4.5:1 on its own background in both themes.
- `--tplane-chat-destructive` and `--tplane-chat-success` stay as aliases for
  icons only (3:1 is enough for non-text). Never use them for text.
- `--tplane-chat-error` is removed from component styles; use
  `--tplane-chat-error-text`.
- The accent (`--tplane-chat-citation-accent`) is for links, focus and
  selection. It is never a status color.

Starting values for the new tokens: success bg `#f0fdf4`, success border
`#bbf7d0`, warning border `#fde68a` in light. Dark values follow the existing
dark error pair (tinted dark background, light text) and are measured before
they land.

### 2.3 Focus (Target)

- One ring: `outline: 2px solid var(--tplane-chat-focus-ring); outline-offset: 2px;`
  on `:focus-visible` only.
- New token `--tplane-chat-focus-ring`, defaulting to `--tplane-chat-primary`.
- Today there are three focus colors (`primary`, `text-muted`, `error-text`)
  plus the a2ui ring. All chat components move to the one token; the a2ui ring
  aliases to it.
- Never remove a focus outline without replacing it.

### 2.4 Shape (Today, tighten)

| Token | Value | Use |
| --- | --- | --- |
| `--tplane-chat-radius-sm` | 4px | Inline code, small icons, task boxes |
| `--tplane-chat-radius-button` | 8px | Every button except pills and the launcher |
| `--tplane-chat-radius-card` | 8px | Panels, cards, menus |
| `--tplane-chat-radius-bubble` | 15px | Message bubbles |
| `--tplane-chat-radius-input` | 20px | Composer |
| `--tplane-chat-radius-launcher` | 9999px | Launcher, pills |

Target: component styles use these tokens only. Today there are literal 5, 6,
8, 10 and 12px radii across components.

### 2.5 Elevation (Target)

Content never has a shadow: messages, panels, cards and tool activity sit on
the surface with hairline borders.

Floating UI (menus, popovers, the select dropdown, the drawer, dialogs) gets a
hairline border plus one elevation token:

- `--tplane-chat-elevation-float`, light:
  `0 1px 2px rgb(0 0 0 / .04), 0 6px 16px rgb(0 0 0 / .08)`.
- Dark: a stronger, darker shadow, with the floating surface one step lighter
  than the page (`surface-alt` on `surface`). In dark mode the lighter surface
  does most of the separating.

The three `--tplane-chat-shadow-*` tokens and the literal shadows in the
confirm dialog, approval card, sidenav and popup collapse into this one token.

### 2.6 Motion (Target)

| Token | Value |
| --- | --- |
| `--tplane-chat-motion-duration` | 150ms |
| `--tplane-chat-motion-duration-slow` | 250ms (drawers and panels that travel) |
| `--tplane-chat-motion-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` (ease-out) |

- Animate only `opacity` and `transform`.
- One moving element per view (see Principles).
- Reduced motion: the existing global switch in `chat-tokens.ts` stays. Every
  infinite animation is listed in `REDUCED_MOTION_LOOP_SELECTORS` and shows a
  static, fully visible state.

### 2.7 Layers (Today, enforce)

Use `--tplane-chat-z-*` only. Today several components use literal z-index
values (50, 59, 60, 70, 71, 100, 1000). Each one either maps to an existing
layer or gets a named layer token.

### 2.8 Units

Type sizes, spacing inside text and max widths use rem. Hairlines stay 1px.
Spacing tokens (`--tplane-chat-space-*`) are the only spacing values in
component styles.

## 3. Typography

- **Fonts:** `--tplane-chat-font-family` (system sans) and
  `--tplane-chat-font-mono` (system mono). No bundled web fonts.
- **Scale:** `--tplane-chat-font-size` 1rem (messages),
  `--tplane-chat-font-size-sm` 0.875rem (tool activity, panels, buttons),
  `--tplane-chat-font-size-xs` 0.75rem (status words, timers, metadata).
  No other sizes in component styles.
- **Weight:** 400 body, 500 for lead sentences, labels and buttons, 600 for
  headings in dialogs and generated UI only.
- **No uppercase or letter-spaced labels.** Sentence case everywhere.
- **Numbers:** counts and timers use `font-variant-numeric: tabular-nums` so
  they don't jitter while updating.
- **Mono** is for code, tool names in arguments and identifiers. Not for labels.

## 4. Buttons and links

- **Primary:** ink fill (`--tplane-chat-primary`), `--tplane-chat-on-primary`
  text. Never the accent color.
- **Secondary:** transparent, hairline border (`--tplane-chat-separator`), ink
  text.
- **Destructive primary:** used only inside a destructive approval (see 6.4).
  It keeps the ink fill; the panel around it carries the danger tint.
- **Targets:** 44px minimum height on coarse pointers, 32px on fine pointers.
- **Labels name the action and its object:** "Retry toSorted read",
  "Save note", "Delete 12 drafts". Never "OK", "Yes" or "Submit".
- **Links:** always underlined (the underline can be a softened color). Color
  alone never marks a link.

## 5. Voice in UI strings

- Sentence case. No exclamation points. No em-dashes.
- Status leads are short statements ending in a period: "UA999 lookup failed.",
  "Waiting for your approval.", "Saved."
- Name the thing, not the system: "toSorted read failed", not "Tool error".
- Say what happens next when there is something to do: "Answer the approval
  to continue".
- Never say something happened before it did.
- Counts use numbers ("Used 3 tools · 1 failed"), and the middle dot separates
  summary parts.

## 6. Patterns

### 6.1 Status panel

The one container for anything you must read or act on: a failed call, a run
error, an approval, a receipt.

- Tinted background, 1px border, `--tplane-chat-radius-card`, padding
  `space-3` by `space-2`.
- Content: a **lead sentence** in the status text color, weight 500, then the
  detail in ink, then actions in a row.
- Failed call and run error: danger. Approval: warning. Destructive approval:
  danger. Receipt: success.
- Roles: failures use `role="alert"`; approvals and receipts are announced
  through the group's polite live region, not as alerts.
- Forced colors: the border stays visible (`border-color: CanvasText`), and the
  lead sentence keeps the meaning.

### 6.2 Tool activity

Settled (Today, keep): one collapsed line, "Used 3 tools" or
"Used 2 tools · 1 failed". Expanding shows one row per call.

Rows (Target):

- The row label names what the call did, from its arguments:
  "Read Array.prototype.toSorted", "Look up UA999". Repeated calls to one tool
  no longer share a label. This needs `toolLabel` to receive the call's
  arguments as well as its name (today it gets the name only).
- After the label, a status word in muted text ("Complete", "Failed",
  "Stopped"). Failed uses the danger text color. The row never repeats the
  failure message.
- Sources sit directly under the row that produced them.

Failure (Target):

- A failed call gets one danger status panel **below the group**. It stays in
  that one place whether the group is open or closed, and it does not move
  when you expand.
- Lead: "toSorted read failed." Then the app's message. Then Retry, after the
  explanation, naming its target: "Retry toSorted read".
- Several failures: one panel, one line per failed call, each with its own
  Retry. Identical messages are listed once (the library already
  de-duplicates).

### 6.3 Progress

Running work is collapsed by default and can be expanded.

- **Collapsed:** the summary line is the current step in the call's own words,
  "Reading Array.prototype.toSorted", with a shimmer on that text, the elapsed
  time (tabular, muted) and a Stop button.
- **Expanded:** the summary turns static, "Working · 1 of 3 done", with the
  elapsed time and Stop. Below it the step list: finished steps with a tick,
  the current step with the shimmer, upcoming steps dimmed. Upcoming steps
  appear only when the agent declared a plan; otherwise the list shows finished
  steps and the current one.
- **Finished:** collapses to the settled line ("Used 3 tools").
- The shimmer is the view's one moving element. It runs only on the current
  step's text, in either view. The spinner ring on the current row does not
  rotate.
- The shimmer sweeps between `--tplane-chat-text-muted` and
  `--tplane-chat-text`, so its faintest point still meets 4.5:1.
- Reduced motion and forced colors: the shimmer becomes plain ink text.
- Screen readers hear the step change through the polite live region, not the
  animation.

### 6.4 Approvals

Approvals are inline status panels in the conversation. No modal. (Today
`ChatApprovalCardComponent` is a modal `<dialog>` with a blurred backdrop and a
literal shadow; it moves to this pattern.)

- Warning panel. Lead: "Waiting for your approval." Then the request in plain
  words: "Save the comparison note to your workspace?"
- The tool and its arguments in mono, muted: `save_note · folder: Comparisons`.
- Actions: an ink primary naming the action ("Save note") and a secondary
  naming the alternative ("Don't save").
- The composer shows "Answer the approval to continue" while the panel waits.
- After you answer, the panel shrinks to a one-line record in the transcript:
  "Approved: save note" or "Declined: save note".
- **Destructive approvals:** when the app marks a tool as destructive, the
  panel uses the danger tint, leads with "This can't be undone.", and the
  primary button states the exact effect: "Delete 12 drafts". This needs a way
  for the app to mark a tool as destructive.
- Focus moves to the panel's first action when it appears, and back to the
  composer after you answer.

### 6.5 Retry

- Retry belongs to one call and says which: "Retry toSorted read".
- It sits after the explanation, never before it.
- A retry re-runs only the failed call. While it runs, the panel's lead becomes
  "Retrying toSorted read" and follows the progress rules.
- A run-level error ("The run stopped with an error.") offers
  "Retry response".

### 6.6 Receipts

- A success status panel that appears only after the write is confirmed.
- Lead: "Saved." Then what and where: "Note #4821 in Comparisons."
- A receipt is a record, not a prompt: no actions unless there is a useful
  next step (for example "Open note").

### 6.7 Messages and composer (Today, keep)

- Assistant messages have no bubble. User messages are an ink bubble
  (`--tplane-chat-primary` fill, `--tplane-chat-on-primary` text,
  `--tplane-chat-radius-bubble`).
- Max line width `--tplane-chat-max-width` (48rem).
- The composer uses `--tplane-chat-radius-input` and a hairline border. Its
  focus ring follows 2.3.

### 6.8 Floating UI

Menus, the model select, the history palette, the overflow menu and the
drawer: `surface`, hairline border, `--tplane-chat-radius-card`,
`--tplane-chat-elevation-float`, layer tokens from 2.7. Hover and selected rows
use `surface-alt`. Scrims stay as today.

## 7. Accessibility checklist

Every component change checks:

- Text contrast 4.5:1, non-text 3:1, both themes.
- `:focus-visible` ring per 2.3, visible in forced colors.
- Each state named in text; nothing by color alone.
- Live regions: polite for progress, approvals and receipts; `role="alert"` for
  failures only.
- Reduced motion: no animation, static final state.
- Targets per section 4.
- Human assistive-technology and comprehension testing is tracked separately
  and is untested until it is recorded.

## 8. Gap list (Angular)

| Area | Today | Target section |
| --- | --- | --- |
| Status reds and greens | `#b42318` fallback for undefined `--tplane-chat-error`; `#22c55e` in sidenav; `#d33d55` in a2ui catalog controls alongside `--a2ui-error` | 2.2 |
| Focus ring | Three focus colors plus the a2ui ring | 2.3 |
| Radii | Literal 5, 6, 8, 10, 12px | 2.4 |
| Shadows | Three shadow tokens plus literal shadows in dialog, approval card, sidenav, popup | 2.5 |
| Motion | Literal 100, 120, 150, 200ms with `ease` | 2.6 |
| Layers | Literal z-index values | 2.7 |
| Forced colors | Handled in tool activity, markdown and input only | 6.1, 7 |
| Undefined tokens | `viewport-height`, `viewport-top`, `sidebar-width-drawer`, `welcome-*` are read with fallbacks but never declared | 2 |
| Tool rows | Generic labels; failure text repeats when expanded; sources not under their call | 6.2 |
| Progress | No step list, no elapsed time, no Stop in the activity group | 6.3 |
| Approvals | Modal dialog | 6.4 |
| Retry and receipts | Not provided by the library | 6.5, 6.6 |

React follows once the Angular gaps close, using this guide as its spec.
