#!/usr/bin/env node
/**
 * DX-coverage guard for the dev-facing `@threadplane/*` libraries:
 *   1. Every public exported FUNCTION must carry a non-empty JSDoc summary.
 *   2. Functions on the AUTHORING SURFACE — the ones developers call to wire/use
 *      the framework (`provide*`/`inject*`/`mock*`, the client-tool builders,
 *      and the view-registry helpers) — must additionally carry an `@example`.
 *
 * Symbols tagged `@internal` are exempt (spec-only / implementation exports).
 * Run: `node scripts/check-dx-coverage.mjs` — exits non-zero on violations.
 */
import { Application, TSConfigReader, ReflectionKind } from 'typedoc';
import fs from 'fs';
import path from 'path';

/** Functions a developer calls to wire/use the framework — these must have an @example. */
const AUTHORING_EXACT = new Set([
  'tools', 'action', 'view', 'ask',
  'views', 'withViews', 'withoutViews', 'overrideViews', 'toRenderRegistry',
  'defineAngularRegistry', 'createAgentRef', 'signalStateStore',
]);
const isAuthoringSurface = (name) => /^(provide|inject|mock)/.test(name) || AUTHORING_EXACT.has(name);

const LIBRARIES = [
  { slug: 'chat', entryPoints: ['libs/angular/chat/src/public-api.ts'] },
  { slug: 'ag-ui', entryPoints: ['libs/ag-ui/src/public-api.ts'] },
  { slug: 'langgraph', entryPoints: ['libs/langgraph/src/public-api.ts'] },
  { slug: 'render', entryPoints: ['libs/angular/render/src/public-api.ts'] },
];

function summaryText(comment) {
  if (!comment?.summary) return '';
  return comment.summary.map((p) => p.text ?? '').join('').trim();
}

function isInternal(reflection, signature) {
  const tagged = (c) => !!c?.blockTags?.some((t) => t.tag === '@internal') || !!c?.modifierTags?.has?.('@internal');
  return tagged(reflection.comment) || tagged(signature?.comment);
}

/** A function is documented if either the reflection or its call signature has a summary. */
function functionHasSummary(reflection) {
  const sig = reflection.signatures?.[0];
  return summaryText(reflection.comment).length > 0 || summaryText(sig?.comment).length > 0;
}

const hasExampleTag = (comment) => !!comment?.blockTags?.some((t) => t.tag === '@example');
/** Whether the function (reflection or its call signature) carries an `@example` tag. */
function functionHasExample(reflection) {
  return hasExampleTag(reflection.comment) || hasExampleTag(reflection.signatures?.[0]?.comment);
}

function* walk(reflections) {
  for (const ref of reflections ?? []) {
    yield ref;
    if (ref.children) yield* walk(ref.children);
  }
}

async function main() {
  const summaryViolations = [];
  const exampleViolations = [];
  let checked = 0;
  let authoring = 0;

  for (const lib of LIBRARIES) {
    const missing = lib.entryPoints.filter((p) => !fs.existsSync(p));
    if (missing.length) {
      console.error(`✗ ${lib.slug}: entry point(s) not found: ${missing.join(', ')}`);
      process.exitCode = 1;
      continue;
    }
    const libDir = path.dirname(path.dirname(lib.entryPoints[0]));
    const libTsconfig = fs.existsSync(path.join(libDir, 'tsconfig.lib.json'))
      ? path.join(libDir, 'tsconfig.lib.json')
      : undefined;

    const app = await Application.bootstrapWithPlugins({
      entryPoints: lib.entryPoints,
      skipErrorChecking: true,
      excludeInternal: true,
      ...(libTsconfig ? { tsconfig: libTsconfig } : {}),
    });
    app.options.addReader(new TSConfigReader());
    const project = await app.convert();
    if (!project) throw new Error(`TypeDoc failed to convert ${lib.slug}`);

    for (const ref of walk(project.children)) {
      if (ref.kind !== ReflectionKind.Function) continue;
      if (isInternal(ref, ref.signatures?.[0])) continue;
      checked++;
      const label = `@threadplane/${lib.slug} :: ${ref.name}()`;
      if (!functionHasSummary(ref)) summaryViolations.push(label);
      if (isAuthoringSurface(ref.name)) {
        authoring++;
        if (!functionHasExample(ref)) exampleViolations.push(label);
      }
    }
  }

  if (summaryViolations.length || exampleViolations.length) {
    if (summaryViolations.length) {
      console.error(`\n✗ DX-coverage: ${summaryViolations.length} public function(s) missing a JSDoc summary:\n`);
      for (const v of summaryViolations.sort()) console.error(`   - ${v}`);
    }
    if (exampleViolations.length) {
      console.error(`\n✗ DX-coverage: ${exampleViolations.length} authoring-surface function(s) missing an @example:\n`);
      for (const v of exampleViolations.sort()) console.error(`   - ${v}`);
    }
    console.error(`\nAdd the missing JSDoc (summary, and @example for authoring-surface APIs), or mark the symbol @internal if it is not public API.`);
    process.exit(1);
  }

  console.log(`✓ DX-coverage: all ${checked} public functions have a summary; all ${authoring} authoring-surface functions have an @example (chat/ag-ui/langgraph/render).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
