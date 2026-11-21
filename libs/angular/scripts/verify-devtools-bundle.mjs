// Verify the development-only devtools hook is absent from production bundles.
//
// Bundles a consumer of the built packages the way an application build does —
// the Angular provider, the backend packages' session factories and the chat
// package's devtools hooks, with Angular's production constant
// `ngDevMode = false` — and asserts that nothing of the
// hook survives: not its report event, not the scripted-run arm/disarm/ack
// events, not the render report (chat's reporter and render's element
// tracker), not its opt-out flag. The same bundle with
// `ngDevMode` left to the runtime must contain them all, so the check cannot pass by
// bundling the wrong thing. Run after building angular, langgraph and ag-ui.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const dist = (path) => resolve('dist/libs', path);
const local = {
  '@threadplane/angular/render': dist('angular/fesm2022/threadplane-angular-render.mjs'),
  '@threadplane/angular/chat': dist('angular/fesm2022/threadplane-angular-chat.mjs'),
  '@threadplane/angular': dist('angular/fesm2022/threadplane-angular.mjs'),
  // The backend packages are framework-neutral ES modules, not APF bundles.
  '@threadplane/langgraph': dist('langgraph/src/public-api.js'),
  '@threadplane/ag-ui': dist('ag-ui/src/public-api.js'),
};
for (const file of Object.values(local)) {
  assert(existsSync(file), `${file} is missing; build angular, langgraph and ag-ui first`);
}

const entry = `
  export { provideAgent, injectAgent } from '@threadplane/angular';
  export { createSession as createLangGraphSession } from '@threadplane/langgraph';
  export { createSession as createAgUiSession, FakeAgent } from '@threadplane/ag-ui';
  export {
    ɵcreateDevtoolsEmitter,
    ɵdevtoolsScriptedRuns,
    ɵcreateRenderDevtoolsReporter,
    ɵprovideRenderDevtools,
    A2uiSurfaceComponent,
    ChatGenerativeUiComponent,
  } from '@threadplane/angular/chat';
  export { RenderSpecComponent, RenderElementComponent } from '@threadplane/angular/render';
`;

/** The Threadplane packages come from dist; every other import stays external, as a CDN would leave it. */
const resolveThreadplane = {
  name: 'threadplane-dist',
  setup(builder) {
    builder.onResolve({ filter: /^@threadplane\/(render|chat|angular|langgraph|ag-ui)$/ }, (args) => ({ path: local[args.path] }));
    builder.onResolve({ filter: /^[@#a-z]/ }, (args) =>
      local[args.path] ? undefined : { path: args.path, external: true });
  },
};

async function bundle(define) {
  const result = await build({
    stdin: { contents: entry, resolveDir: process.cwd(), loader: 'js' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    minify: true,
    define,
    plugins: [resolveThreadplane],
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

// `threadplane:devtools` alone would also match the scripted-run events; they
// are listed so a failure names the one that survived.
const markers = [
  'threadplane:devtools',
  'threadplane:devtools:arm',
  'threadplane:devtools:disarm',
  'threadplane:devtools:ack',
  // The render report: chat's reporter builds `{ v: 1, kind: 'render', … }`;
  // render's element tracker ranks states in `{ …, unresolved: 1, … }`.
  'kind:"render"',
  'unresolved:1',
  '__THREADPLANE_DEVTOOLS_DISABLED__',
];

const development = await bundle({});
for (const marker of markers) {
  assert(development.includes(marker), `positive control: the development bundle lacks ${marker}`);
}

const production = await bundle({ ngDevMode: 'false' });
for (const marker of markers) {
  assert(!production.includes(marker), `the production bundle still contains ${marker}`);
}
assert(
  production.length < development.length,
  'the production bundle is not smaller than the development bundle',
);

console.log(
  `Devtools bundle verification passed: production strips the hook (${development.length - production.length} bytes smaller); development keeps it.`,
);
