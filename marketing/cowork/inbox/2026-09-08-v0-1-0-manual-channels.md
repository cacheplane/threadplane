# Threadplane 0.1.0 — manual-channel copy

> Channels without a built adapter. Post by hand. Campaign: `threadplane-0-1-0`.
> Voice: `docs/gtm/voice.md` — social register, contractions fine. Blog register is stricter.
> Guardrails: no competitor comparisons, no absolute telemetry claims, "free" always paired
> with what the paid tiers actually sell.
> Sequencing and rationale: `2026-09-08-v0-1-0-launch-plan.md`.
> Status: **awaiting-brian**.

---

## Hacker News (Day 4) — Brian submits, stays in comments

Submit as a **link to the blog post**. Not a Show HN — there is no interactive demo at that
URL. Lead with the versioning confession, not the release: a version-bump title gets flagged
as promotion, and the semver angle is the one HN will actually argue about.

**Title candidates (pick one — neutral, no version number):**

1. `We shipped 55 breaking changes under a patch version number`
2. `Our version number was lying, so we changed how we release`
3. `A feature list is a sales document unless it says where it stops`

My pick is (1). It is the most specific, it is self-critical, and it does not read as an
announcement. (3) is the better essay but the weaker headline — it sounds like a blog about
blogging.

**First comment (paste immediately after submitting):**

> Author here. The uncomfortable detail behind this post: through v0.0.66 we only ever
> incremented the patch digit. Fifty-five commits of breaking changes went out under a
> counter that told people nothing had broken, and by the end the published packages were
> contradicting our own documentation.
>
> Nobody decided to do that. It happened the way most versioning problems happen — the
> release command had a default, the default was `patch`, and no one owned the question of
> when it should be something else. It only became visible when a consumer upgraded and the
> types moved underneath them.
>
> What we changed: the six packages now version as one fixed group, because an adapter and
> the UI surface it feeds are not independently upgradable in practice — pretending
> otherwise just relocates the breakage to someone's `npm install`. And 1.0.0 is gated
> behind an explicit decision rather than a command-line flag.
>
> Happy to argue about whether 0.x gives you a free pass on this. I do not think it does,
> and I think the "anything goes below 1.0" reading is how projects end up here.

Submission URL:
https://threadplane.ai/blog/threadplane-0-1-0?utm_source=hackernews&utm_medium=community&utm_campaign=threadplane-0-1-0

---

## r/Angular (Day 4) — practical question first, release as the answer

Check the subreddit's self-promotion rules before posting; they change. Engage in the
comments — a drive-by is worse than not posting.

**Title:** `What does your Angular app still owe you after you drop in an agent chat library?`

**Body:**

> I maintain an MIT Angular framework for agent UIs (LangGraph and AG-UI backends), and we
> just cut 0.1.0. Rather than list features, I want to put up the part of our release notes
> that I think is more useful — the list of things the library deliberately does *not* do:
>
> - The agent endpoint sits behind your proxy. The browser shouldn't talk to your graph
>   server directly.
> - API keys never reach the bundle. There's no config option that makes this safe, so
>   there's no config option.
> - Thread IDs are server-generated. Never mint one client-side.
> - CORS is yours.
> - The interrupt panel is yours to compose. `<chat>` gives you primitives; what "review
>   this action" looks like is a product decision.
> - Tracing and evaluation are yours — those belong to tools built for them, not a UI library.
>
> What *is* in the box: `<chat>` plus 15 components, streaming markdown, durable threads with
> checkpoints and time travel, interrupts, client tools, generative UI (json-render and
> A2UI), subagents, classified errors with retry, and a test path that runs with no model and
> no API key. Signals and DI throughout, your design system stays yours, CSS custom
> properties and no `!important`.
>
> All MIT. No paid tier holding anything back — the paid offerings are support time, not code.
>
> https://threadplane.ai/blog/threadplane-0-1-0?utm_source=reddit&utm_medium=community&utm_campaign=threadplane-0-1-0
>
> Genuinely interested in what people think belongs on the "still yours" list that I left off.

---

## Discord (Day 0) — #announcements

> ✈️ **Threadplane 0.1.0 is out.**
>
> The last mile is done: chat, durable threads, human approvals, client tools, subagents,
> generative UI, classified errors with retry, and tests that run without a model. Six
> packages, all MIT, no paid tier holding anything back.
>
> The honest part is the version number. Through 0.0.66 we only bumped the patch digit — 55
> commits of breaking changes shipped under a counter that said nothing had broken. 0.1.0 is
> where that stops.
>
> Write-up → https://threadplane.ai/blog/threadplane-0-1-0?utm_source=discord&utm_medium=community&utm_campaign=threadplane-0-1-0
>
> If you have been running it from `main`, this is the one to pin. And if something breaks on
> upgrade, ping here — I would rather hear it than not.

---

## LinkedIn (Day 5) — business register, no jargon dump

> Threadplane 0.1.0 is out today, and I want to be direct about the business model, because
> "open source" gets used loosely.
>
> Every capability ships in the free tier. There is no open-core split, no seat count, no
> activation, no account to create. The software is MIT — commercial use, modification, and
> redistribution, without asking me.
>
> There are paid offerings. They sell review time, a private channel, and a response
> commitment. They sell my attention. They do not sell code you cannot otherwise have.
>
> That distinction matters more than it sounds. The moment a capability moves behind a
> paywall, architectural decisions start getting made by the pricing page — and you can feel
> that in the code long before you see it on an invoice.
>
> What 0.1.0 actually delivers: the last mile of building an agent interface in Angular.
> Everything between "my agent streams tokens" and "my team can put this in front of a
> customer" — durable conversations, human approval steps, generated UI constrained to your
> own design system, and a test path that runs without calling a model.
>
> https://threadplane.ai/blog/threadplane-0-1-0?utm_source=linkedin&utm_medium=social&utm_campaign=threadplane-0-1-0

---

## Newsletter pitch (Day 6–7) — Angular Weekly et al.

**Subject:** Angular agent framework hits 0.1.0 — and a versioning confession

**Body:**

> Hi [name],
>
> Quick one for [newsletter]. Threadplane — an MIT-licensed Angular framework for building
> agent UIs on LangGraph and AG-UI — just cut 0.1.0, with the full last mile: durable threads,
> human approvals, client tools, subagents, generative UI constrained to your own design
> system, and a test path that runs with no model and no API key.
>
> The angle I think your readers would actually enjoy is the versioning part. Through v0.0.66
> we only ever bumped the patch digit, so 55 commits of breaking changes shipped under a
> counter claiming nothing had broken. The post is candid about how that happens and what we
> changed.
>
> https://threadplane.ai/blog/threadplane-0-1-0?utm_source=newsletter&utm_medium=referral&utm_campaign=threadplane-0-1-0
>
> No worries if it is not a fit. Thanks for the great newsletter.
> — Brian
