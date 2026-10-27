import React, { useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { bootstrapApplication } from '@angular/platform-browser';
import {
  provideZonelessChangeDetection,
  type ApplicationRef,
} from '@angular/core';
import { useAgent } from '@threadplane/react';
import { AngularView } from './angular';
import {
  selected,
  generations,
  selectNext,
  views,
  mounted,
  state,
  sequence,
  create,
  root,
  model,
  commit,
  draw,
  element,
} from './state';

let reactRoot: Root | undefined, angularApp: ApplicationRef | undefined;
function ReactView({ observer }: { observer: typeof selected.react }) {
  const snapshot = useAgent(observer);
  useLayoutEffect(() => {
    views.react = snapshot;
    draw();
    return () => {
      delete views.react;
    };
  }, [snapshot]);
  return (
    <section aria-label="React A2UI observation">
      <pre>{JSON.stringify(snapshot)}</pre>
    </section>
  );
}
function renderReact() {
  reactRoot?.render(
    <React.StrictMode>
      <ReactView observer={selected.react} />
    </React.StrictMode>
  );
}
function mountReact() {
  reactRoot = createRoot(element('react'));
  mounted.react = true;
  renderReact();
}
function removeReact() {
  reactRoot?.unmount();
  reactRoot = undefined;
  mounted.react = false;
}
async function mountAngular() {
  element('angular').replaceChildren(document.createElement('a2ui-observer'));
  angularApp = await bootstrapApplication(AngularView, {
    providers: [provideZonelessChangeDetection()],
  });
  mounted.angular = true;
}
function removeAngular() {
  angularApp?.destroy();
  angularApp = undefined;
  mounted.angular = false;
  element('angular').replaceChildren();
}
async function switchOwner() {
  removeAngular();
  selectNext();
  renderReact();
  await mountAngular();
}
function teardown() {
  removeReact();
  removeAngular();
  for (const generation of generations)
    if (!generation.counts.dispose) generation.dispose();
}
const actions: (() => void | Promise<void>)[] = [
  () => {
    selected.apply(create());
    selected.apply(model('staged'));
  },
  () => selected.apply(root()),
  () => selected.apply(model('updated')),
  () =>
    selected.apply({
      version: 'v0.9',
      deleteSurface: { surfaceId: 'surface' },
    }),
  () => commit('recreated'),
  switchOwner,
  () => generations[0].apply(model('old-alive')),
  () => commit('second'),
  switchOwner,
  () => generations[1].apply(model('second-old-alive')),
  () => commit('third'),
  removeReact,
  () => selected.apply(model('absent-react')),
  mountReact,
  removeAngular,
  () => selected.apply(model('absent-angular')),
  mountAngular,
  () => selected.dispose(),
  () => {
    try {
      selected.apply(model('forbidden'));
    } catch (error) {
      state.error = String(error);
    }
    if (!state.error) throw new Error('Disposed apply accepted');
  },
  teardown,
];
sequence.forEach((label, index) => {
  const button = document.createElement('button');
  button.textContent = label;
  button.addEventListener('click', async () => {
    if (state.busy || state.step !== index) return;
    state.busy = true;
    draw();
    try {
      await actions[index]();
      state.step++;
    } catch (error) {
      state.error = String(error);
      throw error;
    } finally {
      state.busy = false;
      draw();
    }
  });
  element('controls').append(button);
});
window.addEventListener('pagehide', teardown);
mountReact();
void mountAngular().then(() => {
  state.ready = true;
  draw();
});
