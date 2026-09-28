import '@angular/compiler';
import {
  Component,
  DestroyRef,
  effect,
  inject,
  provideZonelessChangeDetection,
  type ApplicationRef,
} from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import React, { useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useAgent } from '@threadplane/react';
import { observeAgent } from '@threadplane/angular';
import {
  createMarkdown,
  type MarkdownSnapshot,
  type MarkdownNode,
} from '@threadplane/content/markdown';

const owner = createMarkdown({
  generation: 'review-1',
  phase: 'streaming',
  content: '',
});
// Fixture-only subscription accounting. Snapshot reads and commands still use
// the one real owner; these counters are not parser or owner instrumentation.
// Outstanding means binding cleanup handles: owner disposal clears its own
// listeners even while mounted bindings have not yet released those handles.
const subscriptions = {
  react: { registrations: 0, cleanups: 0, outstanding: 0, notifications: 0 },
  angular: { registrations: 0, cleanups: 0, outstanding: 0, notifications: 0 },
};
function observer(framework: keyof typeof subscriptions) {
  const counts = subscriptions[framework];
  return {
    getSnapshot: () => owner.getSnapshot(),
    subscribe(notify: () => void) {
      counts.registrations++;
      counts.outstanding++;
      const release = owner.subscribe(() => {
        counts.notifications++;
        notify();
        draw();
      });
      draw();
      let released = false;
      return () => {
        if (released) return;
        release();
        released = true;
        counts.cleanups++;
        counts.outstanding--;
        draw();
      };
    },
  };
}
const reactObserver = observer('react'),
  angularObserver = observer('angular');
const partial = '# Owned <b>literal</b>\n\n- [';
const completeText = partial + ' ] task\n\n![alt](/image)';
const replacement = '[link][ref]\n\n[ref]: /owned\n';
const sequence = [
  'Append',
  'Remove React',
  'Append more',
  'Mount React',
  'Remove Angular',
  'Complete',
  'Mount Angular',
  'New generation',
  'Dispose',
  'Try disposed',
];
const views: { react?: MarkdownSnapshot; angular?: MarkdownSnapshot } = {};
const renders = { react: 0, angular: 0 };
let step = 0,
  busy = false,
  disposed = false,
  error = '',
  commands = 0;
let reactRoot: Root | undefined, angularApp: ApplicationRef | undefined;
function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing fixture element ${id}`);
  return found;
}
function walk(node: MarkdownNode | null): readonly MarkdownNode[] {
  return node
    ? [node, ...('children' in node ? node.children.flatMap(walk) : [])]
    : [];
}
function summary(snapshot: MarkdownSnapshot) {
  const nodes = walk(snapshot.root);
  return {
    root: snapshot.root?.type ?? null,
    nodes: nodes.map((node) => `${node.type}#${node.id}:${node.status}`),
    imageStatus: nodes.find((node) => node.type === 'image')?.status ?? null,
    definitions: [...(snapshot.root?.linkDefinitions ?? [])],
  };
}
function fingerprint(snapshot: MarkdownSnapshot) {
  return JSON.stringify({
    document: snapshot.document,
    root: snapshot.root,
    summary: summary(snapshot),
  });
}
const retained: { snapshot: MarkdownSnapshot; before: string }[] = [];
function evidence() {
  const snapshot = owner.getSnapshot();
  return {
    step,
    next: sequence[step] ?? 'Complete',
    busy,
    disposed,
    error,
    commands,
    document: snapshot.document,
    summary: summary(snapshot),
    mounted: { react: Boolean(reactRoot), angular: Boolean(angularApp) },
    renders: { ...renders },
    subscriptions: {
      react: { ...subscriptions.react },
      angular: { ...subscriptions.angular },
    },
    sameReference:
      (!views.react || views.react === snapshot) &&
      (!views.angular || views.angular === snapshot),
    observed: {
      react: views.react?.document ?? null,
      angular: views.angular?.document ?? null,
    },
    stableRead: snapshot === owner.getSnapshot(),
    retained: retained.length,
    retainedStable: retained.every(
      (record) => fingerprint(record.snapshot) === record.before
    ),
  };
}
declare global {
  interface Window {
    __markdownReview: typeof evidence;
  }
}
window.__markdownReview = evidence;
function draw() {
  element('evidence').textContent = JSON.stringify(evidence(), null, 2);
  element('next').textContent = sequence[step]
    ? `Next: ${sequence[step]}`
    : 'Walkthrough complete';
  for (const [index, button] of buttons.entries())
    button.disabled = busy || index !== step;
}
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
    <section aria-label="React Markdown observation">
      <p data-field="generation">{snapshot.document.generation}</p>
      <p data-field="phase">{snapshot.document.phase}</p>
      <pre data-field="content">{snapshot.document.content}</pre>
      <pre data-field="summary">
        {JSON.stringify(summary(snapshot), null, 2)}
      </pre>
    </section>
  );
}
const AngularView = Component({
  selector: 'markdown-angular',
  standalone: true,
  template: `<section aria-label="Angular Markdown observation"><p data-field="generation">{{ snapshot().document.generation }}</p><p data-field="phase">{{ snapshot().document.phase }}</p><pre data-field="content">{{ snapshot().document.content }}</pre><pre data-field="summary">{{ describe(snapshot()) }}</pre></section>`,
})(
  class {
    readonly snapshot = observeAgent(angularObserver);
    readonly describe = (value: MarkdownSnapshot) =>
      JSON.stringify(summary(value), null, 2);
    constructor() {
      effect(() => {
        views.angular = this.snapshot();
        renders.angular++;
        draw();
      });
      inject(DestroyRef).onDestroy(() => {
        delete views.angular;
        draw();
      });
    }
  }
);
function mountReact() {
  reactRoot = createRoot(element('react'));
  reactRoot.render(
    <React.StrictMode>
      <ReactView />
    </React.StrictMode>
  );
}
async function mountAngular() {
  element('angular').replaceChildren(
    document.createElement('markdown-angular')
  );
  angularApp = await bootstrapApplication(AngularView, {
    providers: [provideZonelessChangeDetection()],
  });
}
function update(
  content: string,
  phase: 'streaming' | 'complete',
  generation = 'review-1'
) {
  const snapshot = owner.getSnapshot();
  retained.push({ snapshot, before: fingerprint(snapshot) });
  commands++;
  owner.update({ generation, phase, content });
}
const actions: (() => void | Promise<void>)[] = [
  () => update(partial, 'streaming'),
  () => {
    reactRoot?.unmount();
    reactRoot = undefined;
  },
  () => update(completeText, 'streaming'),
  mountReact,
  () => {
    angularApp?.destroy();
    angularApp = undefined;
    element('angular').replaceChildren();
  },
  () => update(completeText, 'complete'),
  mountAngular,
  () => update(replacement, 'complete', 'review-2'),
  () => {
    owner.dispose();
    disposed = true;
  },
  () => {
    try {
      update('forbidden', 'streaming', 'late');
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    if (!error) throw new Error('Disposed update unexpectedly accepted');
  },
];
const buttons = sequence.map((label, index) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.disabled = true;
  button.addEventListener('click', async () => {
    if (busy || index !== step) return;
    busy = true;
    draw();
    try {
      await actions[index]();
      step++;
    } catch (caught) {
      error = String(caught);
      throw caught;
    } finally {
      busy = false;
      draw();
    }
  });
  element('controls').append(button);
  return button;
});
window.addEventListener('pagehide', () => {
  owner.dispose();
  reactRoot?.unmount();
  angularApp?.destroy();
});
mountReact();
await mountAngular();
draw();
