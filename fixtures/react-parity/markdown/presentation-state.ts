import {
  createMarkdown,
  type MarkdownNode,
  type MarkdownSnapshot,
} from '@threadplane/content/markdown';

// The application owns exactly one content object. Native views borrow snapshots.
// Rebuild is explicitly fixture-only: the URL replacement intentionally changes
// already accepted text within a generation. Production defaults remain strict.
const owner = createMarkdown(
  { generation: 'native-1', phase: 'streaming', content: '' },
  { violationPolicy: 'rebuild' }
);
export const subscriptions = {
  react: { registrations: 0, cleanups: 0, outstanding: 0, notifications: 0 },
  angular: { registrations: 0, cleanups: 0, outstanding: 0, notifications: 0 },
};
export const views: { react?: MarkdownSnapshot; angular?: MarkdownSnapshot } =
  {};
export const renders = { react: 0, angular: 0 };
export const mounted = { react: false, angular: false };
export const state = {
  step: 0,
  busy: false,
  ready: false,
  disposed: false,
  error: '',
  commands: 0,
  ownerUnchanged: true,
};
export const sequence = [
  'Append',
  'Append task and table',
  'Append document',
  'Equal render',
  'Arrive definitions',
  'Finish',
  'Replace failed image',
  'Late old image error',
  'Fail current image',
  'New generation',
  'Remove React',
  'Append without React',
  'Mount React',
  'Remove Angular',
  'Append without Angular',
  'Mount Angular',
  'Dispose',
  'Try disposed',
];
export const stable =
  'Space   test line\nSecond soft line\n' +
  'longtoken'.repeat(20) +
  '\n\n- stable item\n- second stable item\n\n| stable | table |\n| :--- | ---: |\n| left | right |\n\n';
export const partial = stable + '- [';
export const taskAndTable =
  stable +
  '- [x] completed task\n- [ ] pending task\n\n| changing | table |\n| --- | --- |\n| fragment';
export const documentText =
  taskAndTable +
  ' | arrives |\n\n# Native heading\n\nA *soft **strong** text* ~~gone~~ with ` a  b `.\n\n> native quote\n\n3. ordered three\n4. ordered four\n\n```ts\n  const value = 1;\n\n```\n\n---\n\n[Safe link](/safe "Safe title") and <https://example.test/read> and [Blocked link](javascript:alert).\n\n[Reference label][later], [collapsed][], [shortcut].\n\n![Replaceable image](/presentation-assets/failure.png) ![Blocked image](data:image/png;base64,AAAA)\n\n<div data-raw="block">literal block</div>\n\nInline <b data-raw="inline">literal inline</b>, math $x$ and \\(y\\), citation [^source] and [^missing].\n\n$$\nx+y\n$$\n\n';
export const definedText =
  documentText +
  '\\[\nx-y\n\\]\n\n[later]: /resolved "Resolved title"\n[collapsed]: /collapsed\n[shortcut]: /shortcut\n\n[^source]: Citation source\n';
export const replacedText = definedText.replace('/failure.png', '/success.svg');
const retained: { snapshot: MarkdownSnapshot; before: string }[] = [];
const fingerprint = (snapshot: MarkdownSnapshot) =>
  JSON.stringify({
    document: snapshot.document,
    root: snapshot.root,
    links: [...(snapshot.root?.linkDefinitions ?? [])],
    citations: [...(snapshot.root?.citations ?? [])],
  });
const walk = (node: MarkdownNode | null): MarkdownNode[] =>
  node
    ? [node, ...('children' in node ? node.children.flatMap(walk) : [])]
    : [];
export const current = () => owner.getSnapshot();
export function update(
  content: string,
  phase: 'streaming' | 'complete' = 'streaming',
  generation = current().document.generation
) {
  const snapshot = current();
  retained.push({ snapshot, before: fingerprint(snapshot) });
  state.commands++;
  owner.update({ generation, phase, content });
}
export function dispose() {
  owner.dispose();
  state.disposed = true;
}
function observer(framework: keyof typeof subscriptions) {
  return {
    getSnapshot: current,
    subscribe(notify: () => void) {
      const counts = subscriptions[framework];
      counts.registrations++;
      counts.outstanding++;
      const release = owner.subscribe(() => {
        counts.notifications++;
        notify();
        draw();
      });
      let released = false;
      return () => {
        if (released) return;
        released = true;
        release();
        counts.cleanups++;
        counts.outstanding--;
        draw();
      };
    },
  };
}
export const reactObserver = observer('react');
export const angularObserver = observer('angular');
export function evidence() {
  const snapshot = current();
  return {
    ...state,
    document: snapshot.document,
    mounted: { ...mounted },
    renders: { ...renders },
    subscriptions: {
      react: { ...subscriptions.react },
      angular: { ...subscriptions.angular },
    },
    kinds: [...new Set(walk(snapshot.root).map((node) => node.type))].sort(),
    stableRead: snapshot === current(),
    retainedStable: retained.every(
      ({ snapshot, before }) => fingerprint(snapshot) === before
    ),
    sameReference:
      (!mounted.react || views.react === snapshot) &&
      (!mounted.angular || views.angular === snapshot),
  };
}
export function element(id: string) {
  const found = document.getElementById(id);
  if (!found) throw new Error('Missing fixture element ' + id);
  return found;
}
export function draw() {
  element('evidence').textContent = JSON.stringify(evidence(), null, 2);
  element('next').textContent = sequence[state.step]
    ? 'Next: ' + sequence[state.step]
    : 'Walkthrough complete';
  element('controls')
    .querySelectorAll('button')
    .forEach((button, index) => {
      button.disabled = state.busy || index !== state.step || !state.ready;
    });
}
declare global {
  interface Window {
    __markdownPresentation: typeof evidence;
  }
}
window.__markdownPresentation = evidence;
