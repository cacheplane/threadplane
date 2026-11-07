// SPDX-License-Identifier: MIT

/**
 * What the public surfaces of this site may and may not say.
 *
 * One definition, consumed by both the source scan (`public-copy.spec.ts`) and
 * the production crawl (`e2e/public-copy.spec.ts`). Two lists would drift, and
 * the drift would land on the side that is harder to notice: the deployed one.
 */

/**
 * Claims this site does not make.
 *
 * Each asserts something absolute about behavior that nothing keeps true. A
 * published guarantee that quietly stops holding is worse than no guarantee,
 * so `/privacy` describes categories and purposes instead.
 */
export const BANNED_CLAIMS: ReadonlyArray<readonly [string, RegExp]> = [
  ['phone-home claim', /phon(?:e|ing) home/iu],
  ['installation inertness claim', /installation is inert/iu],
  ['off-by-default claim', /off by default/iu],
  ['what-we-wont-do positioning', /what we (?:won'|won’|will not )t? ?do/iu],
  ['nothing-emitted guarantee', /no telemetry is emitted/iu],
  ['never-collected list', /we (?:never|do not) collect/iu],
];

/**
 * Narrative uses of the word, as distinct from the identifier.
 *
 * `telemetry` is the real name of a public config field on `provideAgent()`,
 * `toAgent()`, and both `AgentConfig` types. Banning the word outright would
 * force the API tables to either lie or omit a shipped option, so what is
 * barred is the prose that markets it — not the field itself.
 */
export const NARRATIVE_MENTIONS: ReadonlyArray<readonly [string, RegExp]> = [
  ['opt-in telemetry positioning', /telemetry is opt-in/iu],
  ['browser-telemetry positioning', /browser telemetry/iu],
  ['debugging-and-telemetry aside', /for debugging and telemetry/iu],
  ['we-have-telemetry framing', /we have telemetry/iu],
  ['telemetry hooks aside', /telemetry hooks/iu],
];

/**
 * Positioning we have retired, and must not still be asserting anywhere.
 *
 * Copy on the website is single-sourced through `positioning.ts` and guarded
 * by its own spec. These are the places that are *not*: static SVG banners,
 * generated PDF covers, and the package READMEs — artifacts that keep
 * rendering happily long after the words on them stopped being true. The
 * overview whitepaper cover carried "Agent UI for Angular" for months past
 * that phrase's retirement, because regenerating it meant paying for LLM
 * chapter prose nobody wanted to touch.
 *
 * Add a phrase here in the same change that retires it.
 */
export const RETIRED_POSITIONING: readonly string[] = [
  'AI agent UI framework for Angular',
  'Angular AI Agent UI Framework',
  'Angular AI agent UI framework',
  'Enterprise Angular Agent UI',
  'Production-ready agent UI',
  'thread plane for enterprise agents',
];

/**
 * Routes retired from the public site.
 *
 * `/docs/telemetry` went in favour of the canonical policy. The three chat
 * configuration pages went with `provideChat()` / `CHAT_CONFIG`, which the
 * library no longer ships: `<chat>` is configured through its inputs.
 */
export const RETIRED_ROUTE_PATTERN =
  /\/docs\/telemetry|\/api\/markdown\/telemetry|\/docs\/chat\/api\/provide-chat|\/docs\/chat\/api\/chat-config|\/docs\/chat\/guides\/configuration|\/api\/markdown\/chat\/api\/provide-chat|\/api\/markdown\/chat\/api\/chat-config|\/api\/markdown\/chat\/guides\/configuration/u;

/**
 * Public routes that are intentionally absent from the sitemap.
 *
 * The crawl walks the sitemap, so anything not indexed is invisible to it. A
 * new public route — `/connect`, say — belongs here in the same change that
 * creates it, or it ships unchecked.
 */
export const NON_INDEXED_PUBLIC_ROUTES: readonly string[] = [
  '/AGENTS.md',
  '/CLAUDE.md',
  '/llms.txt',
  '/llms-full.txt',
  '/robots.txt',
  '/api/markdown/angular/langgraph/getting-started/introduction',
  '/api/markdown/angular/ag-ui/concepts/architecture',
  '/api/markdown/react/getting-started/introduction',
  '/api/markdown/shared/middleware/getting-started/introduction',
];

/** Every barred pattern, for callers that do not care which list a hit came from. */
export function allBarredPatterns(): ReadonlyArray<readonly [string, RegExp]> {
  return [...BANNED_CLAIMS, ...NARRATIVE_MENTIONS];
}

/** Report each barred phrase found in `source`, with its line number. */
export function findBarredCopy(
  source: string,
  patterns: ReadonlyArray<readonly [string, RegExp]> = allBarredPatterns()
): string[] {
  const hits: string[] = [];
  source.split('\n').forEach((line, index) => {
    for (const [label, pattern] of patterns) {
      if (pattern.test(line)) hits.push(`line ${index + 1}: ${label}`);
    }
  });
  return hits;
}
