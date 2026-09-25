import '@angular/compiler';
import {
  Component,
  inject,
  InjectionToken,
  provideZonelessChangeDetection,
} from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import React, { useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useAgent } from '@threadplane/react';
import { observeAgent } from '@threadplane/angular';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Private source is composed only into this local review bundle, never a package export.
import {
  createSession,
  type Session,
} from '../../../libs/ag-ui/src/runtime/create-session';

const sequence = [
  'First',
  'Remove React',
  'Advance first',
  'Mount React',
  'Second',
  'Remove Angular',
  'Complete second',
  'Mount Angular',
  'Start other',
  'Cancelable',
  'Stop A',
  'Dispose',
  'Try disposed',
];
const reviewId = crypto.randomUUID();
const owner = (role: 'a' | 'b') =>
  createSession({
    threadId: `${reviewId}-${role}`,
    url: `${location.origin}/agent?review=${reviewId}&owner=${role}`,
  });
const a = owner('a'),
  b = owner('b');
const SESSION = new InjectionToken<Session>('review owner');
type Snapshot = ReturnType<Session['getSnapshot']>;
const records: { owner: string; text: string; outcome?: string }[] = [];
const saved: { value: Snapshot; json: string }[] = [];
let reactSnapshot: Snapshot | undefined,
  angularSnapshot: Snapshot | undefined,
  bSnapshot: Snapshot | undefined;
let reactRoot: Root | undefined,
  angularApp: Awaited<ReturnType<typeof bootstrapApplication>> | undefined;
let stable = true,
  disposed = false,
  busy = true,
  next = 0,
  failure = '';

document.body.innerHTML = `
<style>
body{font:16px/1.5 system-ui,sans-serif;color:#142435;background:#f5f7fa;margin:0;padding:24px;max-width:1500px;margin-inline:auto}
h1{font-size:clamp(24px,4vw,38px);margin-bottom:8px}h2{font-size:20px;margin-top:0}.panels{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:16px}
section{background:white;border:1px solid #d3dce5;border-radius:10px;padding:18px;margin-block:16px}pre{font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:400px;overflow:auto}
button{font:inherit;padding:9px 14px;margin:4px;border:1px solid #879bab;border-radius:6px;background:#173f65;color:white;cursor:pointer}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:3px solid #dd8800;outline-offset:2px}#failure{color:#9c2525}a{color:#164d79}
</style>
<header><h1>One native owner, two framework views</h1><p>React and Angular borrow the same private AG-UI session. Removing a view releases observation; only owner controls submit, stop or dispose work.</p><p>These are synthetic protocol review views, not public components or a hosted provider demonstration. Reload starts a separate review. <a href="/provenance" target="_blank" rel="noreferrer">Bundle provenance</a></p></header>
<section aria-label="Review controls"><h2>Walkthrough</h2><p id="next" aria-live="polite"></p><div id="actions"></div><p id="failure" role="alert"></p></section>
<div class="panels"><section><h2>React · owner A</h2><div id="react-a"></div></section><section><h2>Angular · owner A</h2><div id="angular-slot"></div></section><section><h2>React · independent owner B</h2><div id="react-b"></div></section></div>
<section><h2>Ownership and command evidence</h2><p>Both mounted A views must hold the identical current snapshot. Native arguments remain raw strings. Prior snapshots must stay unchanged.</p><pre id="state"></pre></section>`;

function evidence() {
  for (const old of saved) stable &&= JSON.stringify(old.value) === old.json;
  return {
    reviewId,
    a: a.getSnapshot(),
    b: b.getSnapshot(),
    records,
    reactMounted: !!reactRoot,
    angularMounted: !!angularApp,
    reactCurrent: reactSnapshot === a.getSnapshot(),
    angularCurrent: angularSnapshot === a.getSnapshot(),
    sameReference:
      !!reactRoot && !!angularApp && reactSnapshot === angularSnapshot,
    otherCurrent: bSnapshot === b.getSnapshot(),
    stable,
    disposed,
    busy,
    nextAction: sequence[next] ?? 'Complete',
    failure,
  };
}
function element(selector: string) {
  const value = document.querySelector<HTMLElement>(selector);
  if (!value) throw new Error(`Missing fixture element: ${selector}`);
  return value;
}
function renderState() {
  element('#state').textContent = JSON.stringify(evidence(), null, 2);
  element('#next').textContent = failure
    ? 'Review failed; reload for a fresh review.'
    : next === sequence.length
    ? 'Review complete. Four requests have been submitted.'
    : `${busy ? 'Waiting for' : 'Next action:'} ${sequence[next]}`;
  element('#failure').textContent = failure;
  document
    .querySelectorAll<HTMLButtonElement>('#actions button')
    .forEach((button, index) => {
      button.disabled = busy || !!failure || index !== next;
    });
}
const releases = [a, b].map((session) =>
  session.subscribe(() => {
    const value = session.getSnapshot();
    saved.push({ value, json: JSON.stringify(value) });
    renderState();
  })
);
function View({ session, kind }: { session: Session; kind: 'a' | 'b' }) {
  const snapshot = useAgent(session);
  useLayoutEffect(() => {
    if (kind === 'a') reactSnapshot = snapshot;
    else bSnapshot = snapshot;
    renderState();
    return () => {
      if (kind === 'a') reactSnapshot = undefined;
      else bSnapshot = undefined;
    };
  }, [snapshot]);
  return (
    <pre data-view={`react-${kind}`}>{JSON.stringify(snapshot, null, 2)}</pre>
  );
}
class NativeView {
  readonly snapshot = observeAgent(inject(SESSION));
  get json() {
    angularSnapshot = this.snapshot();
    renderState();
    return JSON.stringify(angularSnapshot, null, 2);
  }
}
Component({
  selector: 'native-angular-review',
  standalone: true,
  template: '<pre data-view="angular-a">{{ json }}</pre>',
})(NativeView);
function mountReact() {
  reactRoot = createRoot(element('#react-a'));
  reactRoot.render(
    <React.StrictMode>
      <View session={a} kind="a" />
    </React.StrictMode>
  );
}
async function mountAngular() {
  element('#angular-slot').innerHTML =
    '<native-angular-review></native-angular-review>';
  angularApp = await bootstrapApplication(NativeView, {
    providers: [
      provideZonelessChangeDetection(),
      { provide: SESSION, useValue: a },
    ],
  });
}
function start(session: Session, text: string) {
  const record: (typeof records)[number] = {
    owner: session === a ? 'a' : 'b',
    text,
  };
  records.push(record);
  void session
    .submit(text)
    .then((outcome) => {
      record.outcome = outcome;
      renderState();
    })
    .catch((error: unknown) => {
      failure = String(error);
      renderState();
    });
}
async function waitFor(predicate: () => boolean) {
  const deadline = performance.now() + 10000;
  while (!predicate()) {
    if (failure) throw new Error(failure);
    if (performance.now() > deadline)
      throw new Error(
        'Timed out waiting for this review action. Reload to start a fresh review.'
      );
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
}
async function closed(index: number) {
  const deadline = performance.now() + 10000;
  while (true) {
    const response = await fetch('/stats');
    if (!response.ok) throw new Error('Cannot read fixture evidence');
    const stats = await response.json();
    if (
      stats.errors.some(
        (error: { reviewId: string }) => error.reviewId === reviewId
      )
    )
      throw new Error('The independent server rejected this review');
    if (
      stats.requests.filter(
        (request: { reviewId: string }) => request.reviewId === reviewId
      )[index]?.closed
    )
      return;
    if (performance.now() > deadline)
      throw new Error('Response did not physically close');
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
}
async function control(action: string) {
  const response = await fetch('/control', {
    method: 'POST',
    body: JSON.stringify({ reviewId, action }),
  });
  if (!response.ok) throw new Error((await response.json()).error);
}
const count = (session: Session, expected: number) =>
  JSON.stringify(session.getSnapshot().state) ===
  JSON.stringify({ count: expected });
async function action(index: number) {
  switch (index) {
    case 0:
      start(a, 'First');
      await waitFor(
        () =>
          count(a, 1) &&
          a
            .getSnapshot()
            .transcript.some(
              (message) =>
                message.role === 'assistant' &&
                message.toolCalls?.[0]?.function.arguments === '{"city":'
            )
      );
      break;
    case 1:
      if (!reactRoot) throw new Error('React view is not mounted');
      reactRoot.unmount();
      reactRoot = undefined;
      reactSnapshot = undefined;
      break;
    case 2:
      await control('advance-first');
      await waitFor(
        () => records[0].outcome === 'paused' && evidence().angularCurrent
      );
      await closed(0);
      break;
    case 3:
      mountReact();
      await waitFor(() => evidence().sameReference);
      break;
    case 4:
      start(a, 'Second');
      await waitFor(
        () => a.getSnapshot().transcript.at(-1)?.content === 'Next answer'
      );
      break;
    case 5:
      if (!angularApp) throw new Error('Angular view is not mounted');
      angularApp.destroy();
      angularApp = undefined;
      angularSnapshot = undefined;
      break;
    case 6:
      await control('complete-second');
      await waitFor(
        () => records[1].outcome === 'success' && evidence().reactCurrent
      );
      await closed(1);
      break;
    case 7:
      await mountAngular();
      await waitFor(() => evidence().sameReference);
      break;
    case 8:
      start(b, 'Other');
      await waitFor(() => count(b, 99) && evidence().otherCurrent);
      break;
    case 9:
      start(a, 'Cancelable');
      await waitFor(() => count(a, 3));
      break;
    case 10:
      await a.stop();
      await waitFor(() => records[3].outcome === 'aborted');
      await closed(3);
      break;
    case 11:
      await a.dispose();
      await b.dispose();
      disposed = true;
      await closed(2);
      break;
    case 12:
      start(a, 'Disposed');
      await waitFor(() => records[4].outcome === 'aborted');
      break;
  }
  await waitFor(
    () =>
      (!reactRoot || evidence().reactCurrent) &&
      (!angularApp || evidence().angularCurrent) &&
      evidence().otherCurrent
  );
}
for (const [index, name] of sequence.entries()) {
  const button = document.createElement('button');
  button.textContent = name;
  button.disabled = true;
  button.onclick = async () => {
    if (busy || failure || index !== next) return;
    busy = true;
    renderState();
    try {
      await action(index);
      next += 1;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    busy = false;
    renderState();
  };
  element('#actions').append(button);
}
window.addEventListener('pagehide', () => {
  releases.forEach((release) => release());
  void a.dispose();
  void b.dispose();
});
mountReact();
createRoot(element('#react-b')).render(
  <React.StrictMode>
    <View session={b} kind="b" />
  </React.StrictMode>
);
await mountAngular();
await waitFor(() => evidence().sameReference && evidence().otherCurrent);
busy = false;
renderState();
