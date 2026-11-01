// SPDX-License-Identifier: MIT
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { readApiIndex, readApiSymbol } from './api-reference';
import { describe, expect, it } from 'vitest';

import {
  BANNED_CLAIMS,
  NARRATIVE_MENTIONS,
  RETIRED_ROUTE_PATTERN,
  allBarredPatterns,
  findBarredCopy,
} from './public-copy-contract';

const WEBSITE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONTENT_ROOT = join(WEBSITE_ROOT, 'content');
const SOURCE_ROOT = join(WEBSITE_ROOT, 'src');
const WORKSPACE_ROOT = join(WEBSITE_ROOT, '..', '..');
const LIBS_ROOT = join(WORKSPACE_ROOT, 'libs');

function publicContentFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...publicContentFiles(path));
    } else if (/\.(?:mdx|json)$/u.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

function offenders(
  patterns: ReadonlyArray<readonly [string, RegExp]>
): string[] {
  const hits: string[] = [];
  for (const path of publicContentFiles(CONTENT_ROOT)) {
    const lines = readFileSync(path, 'utf8').split('\n');
    lines.forEach((line, index) => {
      for (const [label, pattern] of patterns) {
        if (pattern.test(line)) {
          hits.push(`${relative(WEBSITE_ROOT, path)}:${index + 1} — ${label}`);
        }
      }
    });
  }
  return hits;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Copy rendered from source, not from `content/**`.
 *
 * WHY THIS EXISTS. The scan above reads `content/**` only, so every word a
 * component renders was invisible to it. That is not theoretical: the homepage
 * rebuild shipped an FAQ answer asserting "Installation is inert" and linking
 * `/docs/telemetry/guides/browser`. Lint, types and the whole unit suite were
 * green; only the production crawl in `e2e/public-copy.spec.ts` caught it, and
 * that crawl runs against a deployed preview — days of feedback latency for a
 * claim the repo had already decided not to make.
 *
 * HOW IT WORKS. Reading the file bytes would be useless here: this repository
 * discusses the barred phrases in prose. `HomeFAQ.tsx` carries a comment naming
 * the exact retired claim so the next author does not reintroduce it, and
 * `FinalCTA.tsx` does the same. A byte scan flags both, someone adds an
 * ignore-comment, and the gate is dead within a month.
 *
 * So the scan parses each file with the TypeScript compiler and looks only at
 * the nodes whose text can reach a visitor:
 *   - string literals (which is how `href="/docs/telemetry/…"` is spelled),
 *   - template literals, static chunks only,
 *   - JSX text.
 * Everything else in the AST — identifiers, comments, regex literals, JSX
 * element and attribute names — is skipped by construction, not by an ignore
 * list. That is what makes the exclusions below short.
 *
 * WHAT IT CATCHES. A banned claim or a retired route written literally into any
 * shipped `.ts`/`.tsx`/`.mjs` under `src/`, in a string, a template chunk, a JSX
 * attribute value, or JSX body text — including copy modules such as
 * `lib/positioning.ts` and route handlers such as `app/llms.txt/route.ts`.
 *
 * WHAT IT STILL CANNOT CATCH, and the e2e crawl remains the backstop for:
 *   - copy assembled at runtime across a substitution — `Installation is
 *     ${state}`, or `${DOCS_BASE}/telemetry/guides/browser` — since only the
 *     static chunks are compared;
 *   - copy that arrives from outside this tree: MDX frontmatter rendered by a
 *     template, the API-docs generator, a CMS or fetch response;
 *   - `content:` strings in `src/styles/*.css`, alt text baked into an image,
 *     anything in `public/`;
 *   - a claim rephrased so it matches no pattern. The contract is a list of
 *     known-bad sentences, never a semantic judge.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Files excluded from the source scan, and why each one is not public copy.
 *
 * Kept to a rule rather than a path list so it cannot quietly grow:
 *   - `public-copy-contract.ts` — defines the bans. (Its phrases live in regex
 *     literals, which the extractor skips anyway, so this is for clarity, not
 *     for coverage.)
 *   - `*.spec.ts` / `*.spec.tsx` — assert on the bans. `app/api/ingest/
 *     route.spec.ts` names a payload "browser telemetry" in a test title; test
 *     titles are not served to anyone.
 * There is no per-line allowlist and none is needed: on the current tree the
 * scan reports zero hits, so any future entry would be a real new occurrence
 * that deserves an argument in review rather than a suppression.
 */
function isExcludedFromSourceScan(fileName: string): boolean {
  return (
    fileName === 'public-copy-contract.ts' ||
    /\.spec\.(?:ts|tsx)$/u.test(fileName)
  );
}

function renderedCopyFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...renderedCopyFiles(path));
    } else if (
      /\.(?:tsx?|mjs)$/u.test(entry.name) &&
      !isExcludedFromSourceScan(entry.name)
    ) {
      found.push(path);
    }
  }
  return found;
}

interface CopyFragment {
  /** Literal text as authored, minus the quotes or braces around it. */
  readonly text: string;
  /** One-based line the fragment starts on. */
  readonly line: number;
  /** Which of the three copy-bearing node shapes this came from. */
  readonly kind: 'string' | 'template' | 'jsx';
}

/**
 * The visitor-visible text of one source file.
 *
 * Module specifiers are dropped: `from './TelemetryHowItFits'` is an identifier
 * that happens to be spelled with quotes, and nothing renders it.
 */
function extractRenderedCopy(
  source: string,
  fileName: string
): CopyFragment[] {
  const parsed = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const fragments: CopyFragment[] = [];

  const isModuleSpecifier = (node: ts.Node): boolean => {
    const parent = node.parent;
    if (!parent) return false;
    return (
      (ts.isImportDeclaration(parent) && parent.moduleSpecifier === node) ||
      (ts.isExportDeclaration(parent) && parent.moduleSpecifier === node) ||
      ts.isImportTypeNode(parent) ||
      ts.isExternalModuleReference(parent) ||
      (ts.isCallExpression(parent) &&
        parent.expression.kind === ts.SyntaxKind.ImportKeyword)
    );
  };

  const copyKind = (node: ts.Node): CopyFragment['kind'] | null => {
    if (ts.isJsxText(node)) return 'jsx';
    if (ts.isStringLiteral(node)) return 'string';
    if (
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      return 'template';
    }
    return null;
  };

  const visit = (node: ts.Node): void => {
    const kind = copyKind(node);

    if (kind && !isModuleSpecifier(node)) {
      // `getStart()` skips leading trivia, which for JSX text is part of the
      // text itself, so locate the literal text in the raw source instead and
      // fall back to the node start when escapes make it unfindable.
      const nodeStart = node.getStart(parsed);
      const rawStart = source.indexOf((node as ts.LiteralLikeNode).text, node.pos);
      const textStart =
        rawStart >= node.pos && rawStart < node.end ? rawStart : nodeStart;
      fragments.push({
        text: (node as ts.LiteralLikeNode).text,
        line: parsed.getLineAndCharacterOfPosition(textStart).line + 1,
        kind,
      });
    }
    ts.forEachChild(node, visit);
  };

  visit(parsed);
  return fragments;
}

/**
 * Parse every scanned file once. Three assertions read the same fragments, and
 * re-parsing the tree for each one tripled the cost of the gate for nothing.
 */
let parsedTree: ReadonlyArray<{
  readonly path: string;
  readonly fragments: readonly CopyFragment[];
}> | null = null;

function renderedCopy(): ReadonlyArray<{
  readonly path: string;
  readonly fragments: readonly CopyFragment[];
}> {
  parsedTree ??= renderedCopyFiles(SOURCE_ROOT).map((path) => ({
    path,
    fragments: extractRenderedCopy(readFileSync(path, 'utf8'), path),
  }));
  return parsedTree;
}

function sourceOffenders(
  patterns: ReadonlyArray<readonly [string, RegExp]>
): string[] {
  const hits: string[] = [];
  for (const { path, fragments } of renderedCopy()) {
    for (const fragment of fragments) {
      for (const [label, pattern] of patterns) {
        const match = fragment.text.match(pattern);
        if (!match) continue;
        const line =
          fragment.line +
          (fragment.text.slice(0, match.index).match(/\n/gu)?.length ?? 0);
        hits.push(`${relative(WEBSITE_ROOT, path)}:${line} — ${label}`);
      }
    }
  }
  return hits;
}

describe('public copy', () => {
  it('makes none of the barred absolute claims', () => {
    expect(offenders(BANNED_CLAIMS)).toEqual([]);
  });

  it('carries no narrative telemetry positioning', () => {
    expect(offenders(NARRATIVE_MENTIONS)).toEqual([]);
  });

  it('links no retired documentation route', () => {
    const hits: string[] = [];
    for (const path of publicContentFiles(CONTENT_ROOT)) {
      const lines = readFileSync(path, 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (RETIRED_ROUTE_PATTERN.test(line)) {
          hits.push(`${relative(WEBSITE_ROOT, path)}:${index + 1}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });

  /**
   * The counterpart to the bans: the field is real, so it stays documented.
   * Without this, a future cleanup could satisfy the rules above by deleting
   * the API rows and leaving developers with an undocumented option.
   */
  it('still documents the telemetry config field on every adapter', () => {
    for (const [entrypoint, name] of [
      ['ag-ui', 'AgentConfig'],
      ['ag-ui', 'ToAgentOptions'],
      ['langgraph', 'AgentConfig'],
    ]) {
      const symbol = readApiSymbol(entrypoint, name);
      expect(symbol, `${entrypoint}/${name} must document the field`).not.toBeNull();
      const fields = symbol!.declarations.flatMap(declaration => declaration.members);
      const telemetry = fields.find(field => field.name === 'telemetry');
      expect(telemetry, `${entrypoint}/${name} must document the field`).toBeDefined();
      expect(telemetry!.excerptTokens.map(token => token.text).join('')).toBe('telemetry?: AgentRuntimeTelemetrySink | false;');
    }
  });
});

const RETIRED_ROUTE_RULE: ReadonlyArray<readonly [string, RegExp]> = [
  ['retired documentation route', RETIRED_ROUTE_PATTERN],
];

/* ────────────────────────────────────────────────────────────────────────────
 * The npm package pages.
 *
 * `libs/*\/README.md` is the body of every package listing on npmjs.com, which
 * is a more public surface than most of this website and had no copy gate of
 * any kind. It showed: `libs/telemetry/README.md` shipped "Installation is
 * inert", "Browser telemetry is opt-in", and a "never collects …" absolute —
 * three barred claims, live on npm, while the website scan next to it was
 * green. Markdown is not linted here, and the only checks that read these
 * files are `scripts/verify-angular-support.mjs` (the Angular badge and peer
 * block) and `scripts/mit-cutover.spec.mjs`.
 *
 * No overlap with `mit-cutover.spec.mjs`: it looks for the retired *licensing*
 * vocabulary — read its own `retiredTerms` list for the exact strings — and
 * only in `README.md` and `libs/chat/README.md`. Different words, different
 * concern, seven READMEs it never opens. Nothing here is reported twice.
 *
 * Do not spell those terms out here. That spec bans them anywhere under
 * `apps/website/src`, so naming them in this comment turns it red — which is
 * why it assembles its own list with `.join('')` rather than writing the
 * literals. This comment did exactly that and broke CI.
 *
 * These are prose, so they get the plain line scan that `content/**` gets —
 * none of the AST machinery above, which exists only because `src/**` mixes
 * copy with code. The scan reads fenced code blocks too. That is deliberate: a
 * false positive in a README is an argument in review, whereas a miss is a
 * claim on npm, and the failure mode this whole file guards against is the
 * silent one.
 *
 * What it cannot catch: a README not under `libs/*` (an `examples/*` one, say),
 * a `NOTICE.md` or `CHANGELOG.md`, and the `description` field of a
 * `package.json`, which npm also renders. Nothing scans those yet.
 * ──────────────────────────────────────────────────────────────────────────── */
function packageReadmeFiles(): string[] {
  const libraryReadmes = readdirSync(LIBS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(LIBS_ROOT, entry.name, 'README.md'))
    .filter((path) => existsSync(path));
  return [join(WORKSPACE_ROOT, 'README.md'), ...libraryReadmes];
}

function readmeOffenders(
  patterns: ReadonlyArray<readonly [string, RegExp]>
): string[] {
  const hits: string[] = [];
  for (const path of packageReadmeFiles()) {
    readFileSync(path, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        for (const [label, pattern] of patterns) {
          if (pattern.test(line)) {
            hits.push(
              `${relative(WORKSPACE_ROOT, path)}:${index + 1} — ${label}`
            );
          }
        }
      });
  }
  return hits;
}

describe('published package READMEs', () => {
  it('makes none of the barred absolute claims', () => {
    expect(readmeOffenders(BANNED_CLAIMS)).toEqual([]);
  });

  it('carries no narrative telemetry positioning', () => {
    expect(readmeOffenders(NARRATIVE_MENTIONS)).toEqual([]);
  });

  it('links no retired documentation route', () => {
    expect(readmeOffenders(RETIRED_ROUTE_RULE)).toEqual([]);
  });

  /**
   * Anti-vacuity for the walk: `libs/*` is discovered, not listed, so a rename
   * or a moved directory could quietly empty it. The floor and the two named
   * files below make that loud. `telemetry` is named because it is the package
   * whose README carried the shipped violations.
   */
  it('reads the root README and every published package README', () => {
    const files = packageReadmeFiles().map((path) =>
      relative(WORKSPACE_ROOT, path)
    );
    expect(files.length).toBeGreaterThanOrEqual(8);
    expect(files).toContain('README.md');
    expect(files).toContain(join('libs', 'telemetry', 'README.md'));
    expect(files).toContain(join('libs', 'chat', 'README.md'));
  });
});

describe('copy rendered from source', () => {
  it('makes none of the barred absolute claims', () => {
    expect(sourceOffenders(BANNED_CLAIMS)).toEqual([]);
  });

  it('carries no narrative telemetry positioning', () => {
    expect(sourceOffenders(NARRATIVE_MENTIONS)).toEqual([]);
  });

  it('links no retired documentation route', () => {
    expect(sourceOffenders(RETIRED_ROUTE_RULE)).toEqual([]);
  });

  it('actually walks the component tree', () => {
    const files = renderedCopyFiles(SOURCE_ROOT).map((path) =>
      relative(SOURCE_ROOT, path)
    );
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain(join('components', 'landing', 'HomeFAQ.tsx'));
    expect(files).toContain(join('lib', 'positioning.ts'));
    expect(files).toContain(join('app', 'llms.txt', 'route.ts'));
    expect(files).not.toContain(join('lib', 'public-copy-contract.ts'));
  });

  /**
   * Anti-vacuity at the walk, not just the extractor. The fixtures below prove
   * the parser finds violations in a synthetic file; nothing there would notice
   * if the walk started handing every real file back as zero fragments. These
   * floors are far under the current counts, so ordinary editing will not move
   * them — only the extractor going quiet will.
   */
  it('extracts real copy from the real tree, JSX body text included', () => {
    const fragments = renderedCopy().flatMap((file) => file.fragments);
    expect(fragments.length).toBeGreaterThan(2000);
    expect(fragments.filter((f) => f.kind === 'jsx').length).toBeGreaterThan(
      200
    );
    expect(
      renderedCopy().find((file) => file.path.endsWith('HomeFAQ.tsx'))
        ?.fragments.some((f) => f.kind === 'jsx')
    ).toBe(true);
  });
});

/**
 * The gate proves itself against the regression it exists for.
 *
 * `HOMEPAGE_FAQ_REGRESSION` is the shipped answer that got through: a banned
 * claim and a link to a retired route, inside a copy table exactly like the one
 * `HomeFAQ.tsx` renders. If the extractor is ever narrowed until it catches
 * nothing — the failure mode that matters, because a green vacuous gate is
 * worse than no gate — these two assertions go red.
 *
 * The counter-fixture is the other half: the surrounding comments name the same
 * phrases, as the real files do, and must not be reported. A scan that flags
 * them gets suppressed by the next person who trips over it.
 */
const HOMEPAGE_FAQ_REGRESSION = `
export const FAQ = [
  {
    q: 'What does Threadplane report about my application?',
    a: (
      <>
        Nothing you have not asked for. Installation is inert — see the{' '}
        <a href="/docs/telemetry/guides/browser">browser telemetry guide</a>.
      </>
    ),
  },
];
`;

const HOMEPAGE_FAQ_FIXED = `
// The absolute framing this question used to carry ("installation is
// inert", linking the retired telemetry docs library) is barred copy.
export const FAQ = [
  {
    q: 'What does Threadplane report about my application?',
    a: <>See <a href="/privacy">the privacy policy</a>.</>,
  },
];
`;

describe('the source scan is not vacuous', () => {
  function hits(
    source: string,
    patterns: ReadonlyArray<readonly [string, RegExp]>
  ): string[] {
    return extractRenderedCopy(source, 'HomeFAQ.tsx').flatMap((fragment) =>
      patterns
        .filter(([, pattern]) => pattern.test(fragment.text))
        .map(([label]) => label)
    );
  }

  it('flags the banned claim the homepage actually shipped', () => {
    expect(hits(HOMEPAGE_FAQ_REGRESSION, BANNED_CLAIMS)).toContain(
      'installation inertness claim'
    );
  });

  it('flags the retired route the same answer linked', () => {
    expect(hits(HOMEPAGE_FAQ_REGRESSION, RETIRED_ROUTE_RULE)).toEqual([
      'retired documentation route',
    ]);
  });

  it('flags narrative positioning in JSX body text', () => {
    expect(hits(HOMEPAGE_FAQ_REGRESSION, NARRATIVE_MENTIONS)).toContain(
      'browser-telemetry positioning'
    );
  });

  it('reports nothing once the answer is rewritten', () => {
    expect(hits(HOMEPAGE_FAQ_FIXED, allBarredPatterns())).toEqual([]);
    expect(hits(HOMEPAGE_FAQ_FIXED, RETIRED_ROUTE_RULE)).toEqual([]);
  });

  it('ignores the comments and regex literals that discuss the bans', () => {
    const discussion = `
      // "Installation is inert" was retired; do not link /docs/telemetry.
      /** Off by default is a claim we do not make. */
      const BARRED = /installation is inert|off by default/iu;
      export const answer = 'See the privacy policy.';
    `;
    expect(hits(discussion, allBarredPatterns())).toEqual([]);
    expect(hits(discussion, RETIRED_ROUTE_RULE)).toEqual([]);
  });

  it('ignores module specifiers but not the copy beside them', () => {
    const module = `
      import { Diagram } from './docs/telemetry/Diagram';
      export const blurb = 'Telemetry is opt-in.';
    `;
    expect(hits(module, RETIRED_ROUTE_RULE)).toEqual([]);
    expect(hits(module, NARRATIVE_MENTIONS)).toEqual([
      'opt-in telemetry positioning',
    ]);
  });
});

/**
 * Generated API JSON is projected rather than authored, so the guard belongs
 * with the generator. This asserts the projection is actually wired in: the
 * committed output is public, and it is the thing readers see.
 */
describe('generated public API docs', () => {
  it('every generated symbol carries no barred public copy', () => {
    const index = readApiIndex();
    expect(index.symbols.length).toBeGreaterThan(600);
    for (const summary of index.symbols) {
      const symbol = readApiSymbol(summary.entrypointId, summary.name)!;
      expect(findBarredCopy(JSON.stringify(symbol), BANNED_CLAIMS), summary.href).toEqual([]);
    }
  });

  it('no longer ships the retired library', () => {
    expect(
      publicContentFiles(CONTENT_ROOT).filter((path) =>
        path.includes(`${join('docs', 'telemetry')}`)
      )
    ).toEqual([]);
  });
});
