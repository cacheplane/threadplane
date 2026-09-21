# Messaging — Threadplane

> Operational doc. Hero copy, proof rows, comparison framing, launch lines. Edited by humans as we iterate. The durable category claim lives in [gtm.md §2](../../gtm.md).

## Positioning statement (durable)

> For Angular teams building AI agents on LangGraph, AG-UI, or custom backends, Threadplane is the open-source thread-plane for agents: it turns streaming agent events into production-ready Angular experiences: chat, durable threads, interrupts, subagents, planning, memory, generative UI, fallbacks, observability, and tests. Unlike React-first agent UI stacks or raw streaming SDKs, Threadplane is Angular-native, DI-friendly, design-system-first, self-hostable, and built for enterprise Angular apps.

## Hero (as shipped)

**H1:** The open-source thread-plane for Angular agents.

**Eyebrow:** `LangGraph & AG-UI`

**Subhead:** Make agent work persistent, durable, visible, reviewable, and resumable. (Each capability links to its documentation.)

**Primary CTA:** `Install Threadplane` — opens the install dialog, which carries
the per-runtime commands. Fires `marketing:cta_click` with
`cta_id=hero_install_open`, `track=developer`, `surface=home`.

**Secondary CTA:** `See it running in the docs →` — routes to
`/docs/chat/guides/generative-ui?mode=run`, fires `marketing:cta_click` with
`cta_id=hero_live_demo`, `track=developer`, `surface=home`, and the destination
URL.

**Trust line:** `MIT · Angular <range> · no account, no cloud` (the range is
generated from the supported majors, not typed). It is not rendered in the hero
itself: it appears in the install dialog the primary CTA opens, on the proof
masthead, and on the live stage.

> Copy is single-sourced in `apps/website/src/lib/positioning.ts`. Change it
> there; this section records what ships, and is not itself the source.
>
> This replaces an earlier locked hero — H1 "Ship production agent UIs in
> Angular." with a `Talk to our engineers` enterprise CTA fork — which the site
> had drifted away from. The drift was resolved deliberately in
> `docs/superpowers/specs/2026-09-18-mobile-above-fold-design.md` §4: keep the
> category claim and add the stack to it.

## The five durable differentiation points

Repeat across the site, comparison pages, and content.

1. **Angular-native, not React-translated.** Signals, DI, OnPush, standalone components, Angular testing patterns, design-system ownership.
2. **Complete agent UI, not just stream plumbing.** Messages, status, errors, tool progress, interrupts, branching/history, thread persistence, reload, fallbacks, tests.
3. **Generative UI that respects the enterprise design system.** Approved components from your design system; no arbitrary code shipping.
4. **Enterprise OSS posture.** MIT, no app/runtime content telemetry by default, no required cloud, self-hosting, optional paid support/SLA.
5. **Production patterns, not demo candy.** Real auth, real backends, observability, error boundaries, fallback strategies, CI/CD, load/chaos patterns, runbooks.

## Risk-cleanup copy changes (Spec 2)

- "No telemetry" → "**App telemetry off by default**" with link to `libs/telemetry/README.md` for the minimal opt-out package install ping.
- "All Angular versions" (pricing) → **real compatibility matrix** with supported/experimental/planned/unsupported.
- A2UI: present Threadplane's support as **"A2UI v0.9 (stable)"** — the implementation targets Google's A2UI v0.9.1 stable release, and every envelope carries `"version": "v0.9"` on the wire.
- "Threadplane" → **"Threadplane"** (category sweep, with care for substring overlap per existing memory note).

## Contact page (Direction A.v2, locked)

**Headline:** Talk to an engineer.

**Subhead:** *Tell us what you're shipping. We'll reply within one business day — usually with code, not a calendar invite.*

**SLA card:** *Brian or someone on the team replies personally — from a real inbox, not `noreply@`. We read every message.*

**Alt-channel row (below form):** docs · GitHub issues · Discord.

**Trust signal:** GitHub star count pill. No logo wall.

**Fields:** email (required) + name, company, message (all optional). No stack dropdown, no company size, no "how did you hear." Optional fields feed enterprise-qualification when present.

Hidden attribution fields (populated by URL params + referrer): `source_page`, `track`, `cta_id`, `paper`, `referrer_host`.

## Comparison page framing (Spec 3)

| Alternative           | Threadplane positioning vs. them |
|-----------------------|---------------------------------|
| `@langchain/angular`  | "Use it for the stream. Use Threadplane for the production Angular UI, design-system rendering, fallbacks, thread UX, testing, and enterprise patterns." |
| Hashbrown             | "Hashbrown is great for browser-running agents and LLM-driven frontend tools; Threadplane is for LangGraph/AG-UI/A2UI-backed enterprise agent workflows with production chat, approvals, threads, observability, and runtime adapters." |
| A2UI renderer         | "A2UI renderer support is table stakes; Threadplane adds Angular app integration, fallback behavior, design-system registry patterns, thread/chat UX, and enterprise hardening." |

## Launch narrative (Spec 6 spine)

> Angular teams are building agents, but the last mile is still messy: streaming state, tool progress, interrupts, durable threads, subagents, planning, memory, generated UI, fallbacks, and tests. React has mature examples. Backend agent frameworks have protocols. Angular teams need something that speaks Signals, DI, templates, standalone components, and enterprise design systems. Threadplane is the MIT-licensed thread-plane for agents: it connects LangGraph, AG-UI, A2UI, and custom backends to production-ready Angular surfaces.

## Avoid

- "The Threadplane for LangChain." (Competes directly with `@langchain/angular`; narrows the story.)
- "Enterprise Angular agent framework." (Reads sales-first.)
- "We're building the React of Angular agents." (Doesn't land for our buyer.)
- Logo walls of unrelated F500s on the contact page.
- Progressive multi-step qualification forms.
