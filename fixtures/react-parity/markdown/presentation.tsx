import React, { useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { bootstrapApplication } from '@angular/platform-browser';
import {
  provideZonelessChangeDetection,
  type ApplicationRef,
} from '@angular/core';
import { useAgent } from '@threadplane/react';
import { Markdown } from '@threadplane/react/markdown';
import { PresentationAngular } from './presentation-angular';
import {
  reactObserver,
  views,
  renders,
  mounted,
  state,
  sequence,
  current,
  update,
  dispose,
  draw,
  element,
  partial,
  taskAndTable,
  documentText,
  definedText,
  replacedText,
} from './presentation-state';

let reactRoot: Root | undefined, angularApp: ApplicationRef | undefined;
function ReactView() {
  const snapshot = useAgent(reactObserver);
  useLayoutEffect(() => {
    views.react = snapshot;
    renders.react++;
    draw();
    return () => {
      delete views.react;
      draw();
    };
  }, [snapshot]);
  return (
    <section aria-label="React native Markdown">
      <Markdown snapshot={snapshot} />
    </section>
  );
}
function mountReact() {
  reactRoot = createRoot(element('react'));
  mounted.react = true;
  reactRoot.render(
    <React.StrictMode>
      <ReactView />
    </React.StrictMode>
  );
}
async function mountAngular() {
  element('angular').replaceChildren(
    document.createElement('presentation-angular')
  );
  angularApp = await bootstrapApplication(PresentationAngular, {
    providers: [provideZonelessChangeDetection()],
  });
  mounted.angular = true;
}
// Retain actual old elements before their native error handler removes them.
// A later explicit control dispatches an error on these detached elements.
const failedImages: HTMLImageElement[] = [];
document.addEventListener(
  'error',
  (event) => {
    if (
      event.target instanceof HTMLImageElement &&
      event.target.src.endsWith('/failure.png') &&
      !failedImages.includes(event.target)
    )
      failedImages.push(event.target);
  },
  true
);
const actions: (() => void | Promise<void>)[] = [
  () => update(partial),
  () => update(taskAndTable),
  () => update(documentText),
  () => {
    const { content, phase } = current().document;
    update(content, phase);
    reactRoot?.render(
      <React.StrictMode>
        <ReactView />
      </React.StrictMode>
    );
    angularApp?.tick();
  },
  () => update(definedText),
  () => update(definedText, 'complete'),
  () => update(replacedText, 'complete'),
  () => {
    if (failedImages.length !== 2)
      throw new Error('Both old native images must have failed');
    failedImages.forEach((image) => image.dispatchEvent(new Event('error')));
  },
  () => {
    document
      .querySelectorAll('img[alt="Replaceable image"]')
      .forEach((image) => image.dispatchEvent(new Event('error')));
  },
  () => update(replacedText, 'streaming', 'native-2'),
  () => {
    reactRoot?.unmount();
    reactRoot = undefined;
    mounted.react = false;
  },
  () => update(replacedText + '\n\nAppended while React is removed.\n'),
  mountReact,
  () => {
    angularApp?.destroy();
    angularApp = undefined;
    mounted.angular = false;
    element('angular').replaceChildren();
  },
  () =>
    update(
      current().document.content + '\nAppended while Angular is removed.\n'
    ),
  mountAngular,
  dispose,
  () => {
    try {
      update('forbidden', 'streaming', 'late');
    } catch (caught) {
      state.error = String(caught);
    }
    if (!state.error) throw new Error('Disposed update accepted');
  },
];
sequence.forEach((label, index) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.disabled = true;
  button.addEventListener('click', async () => {
    if (state.busy || state.step !== index) return;
    state.busy = true;
    const before = current();
    draw();
    try {
      await actions[index]();
      state.ownerUnchanged = current() === before;
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
window.addEventListener('pagehide', () => {
  dispose();
  reactRoot?.unmount();
  angularApp?.destroy();
});
mountReact();
void mountAngular().then(() => {
  state.ready = true;
  draw();
});
