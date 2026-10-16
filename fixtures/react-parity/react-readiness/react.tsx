import React, {
  forwardRef,
  memo,
  Suspense,
  useLayoutEffect,
  useState,
} from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useAgent } from '@threadplane/react';
import {
  RenderSpec,
  type RenderReadinessEntry,
  type RenderSpecData,
  type RenderViewProps,
  type ReactRenderRegistry,
} from '@threadplane/react/render';
import { owner, observer, reference, state } from './state';

let release: () => void = () => {};
const pending = new Promise<void>((resolve) => {
  release = resolve;
});
function Stateful({
  props,
  bindings,
  loading,
  children,
  elementKey,
}: RenderViewProps) {
  const [value, setValue] = useState('seed');
  if (props['value'] === 'suspend') {
    state.suspendedAttempts++;
    throw pending;
  }
  return (
    <section
      data-testid="main-view"
      data-element={elementKey}
      data-value={JSON.stringify(props['value'])}
      data-title={String(props['title'])}
      data-loading={String(loading)}
      data-binding={bindings?.['title']}
      data-frozen={String(
        Object.isFrozen(props) && (!bindings || Object.isFrozen(bindings))
      )}
    >
      <h2>Admitted view</h2>
      <input
        aria-label="Main local input"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <output>{String(props['value'])}</output>
      {children}
    </section>
  );
}
function Alternate(props: RenderViewProps) {
  return <Stateful {...props} />;
}
function Fallback({ children, props, loading, bindings }: RenderViewProps) {
  return (
    <p
      data-testid="pending"
      data-children={React.Children.count(children)}
      data-value={JSON.stringify(props['value'])}
      data-loading={String(loading)}
      data-binding={bindings?.['title']}
    >
      Waiting for complete value
    </p>
  );
}
function OtherFallback(props: RenderViewProps) {
  return <Fallback {...props} />;
}
function Child() {
  return <span data-testid="child">Child admitted</span>;
}
const DirectMemo = memo(({ props }: RenderViewProps) => (
  <p data-testid="direct-memo">
    {props['absent'] === undefined ? 'undefined' : 'wrong'}
  </p>
));
const DirectForward = forwardRef<HTMLParagraphElement, RenderViewProps>(
  ({ props }, ref) => (
    <p ref={ref} data-testid="direct-forward">
      {props['absent'] === undefined ? 'undefined' : 'wrong'}
    </p>
  )
);
function List({ children }: RenderViewProps) {
  return <section aria-label="Repeated items">{children}</section>;
}
function Row({ props }: RenderViewProps) {
  const [value, setValue] = useState('row-seed');
  return (
    <label data-row={String(props['id'])}>
      {String(props['value'])}
      <input
        aria-label={'Row ' + String(props['id'])}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    </label>
  );
}
const rowEntry: RenderReadinessEntry = {
  kind: 'readiness',
  component: Row,
  isReady: (props) => typeof props['value'] === 'string',
};
const readyA: RenderReadinessEntry['isReady'] = (props) => {
  state.predicateCalls++;
  return typeof props['value'] === 'string';
};
const readyB: RenderReadinessEntry['isReady'] = (props) => {
  state.predicateCalls++;
  return typeof props['value'] === 'string';
};
let predicate = readyA,
  component: RenderReadinessEntry['component'] = Stateful,
  fallback: RenderReadinessEntry['fallback'] = Fallback;
let type = 'Card',
  elementKey = 'main',
  epoch = 0,
  loading = true,
  descriptor = 0;
const directSpec: RenderSpecData = {
  root: 'root',
  elements: {
    root: { type: 'List', props: {}, children: ['memo', 'forward'] },
    memo: { type: 'Memo', props: { absent: { $state: '/missing' } } },
    forward: { type: 'Forward', props: { absent: { $state: '/missing' } } },
  },
};
const directRegistry: ReactRenderRegistry = {
  List,
  Memo: DirectMemo,
  Forward: DirectForward,
};
const rowSpec: RenderSpecData = {
  root: 'rows',
  elements: {
    rows: {
      type: 'List',
      props: {},
      repeat: { statePath: '/rows', key: 'id' },
      children: ['row'],
    },
    row: {
      type: 'Row',
      props: { id: { $item: 'id' }, value: { $item: 'value' } },
    },
  },
};
const rowRegistry: ReactRenderRegistry = { List, Row: rowEntry };
function App() {
  const snapshot = useAgent(observer);
  useLayoutEffect(() => {
    state.observedId = reference(snapshot);
  }, [snapshot]);
  const spec: RenderSpecData = {
    root: elementKey,
    elements: {
      [elementKey]: {
        type,
        visible: { $state: '/show' },
        props: {
          value: { $state: '/payload' },
          title: { $bindState: '/label' },
        },
        children: ['child'],
      },
      child: { type: 'Child', props: {} },
    },
  };
  // Replacing this map/descriptor is deliberately independent of the admission contract.
  const registry: ReactRenderRegistry = {
    [type]: { kind: 'readiness', component, isReady: predicate, fallback },
    Child,
  };
  return (
    <>
      <p data-testid="descriptor">{descriptor}</p>
      <RenderSpec
        key={epoch}
        spec={spec}
        registry={registry}
        state={snapshot}
        loading={loading}
      />
      <RenderSpec
        spec={directSpec}
        registry={directRegistry}
        state={snapshot}
      />
      <RenderSpec spec={rowSpec} registry={rowRegistry} state={snapshot} />
    </>
  );
}
const target = document.getElementById('react')!;
let root = createRoot(target);
function render() {
  root.render(
    <React.StrictMode>
      <Suspense
        fallback={
          <p data-testid="suspended">Candidate suspended before commit</p>
        }
      >
        <App />
      </Suspense>
    </React.StrictMode>
  );
}
export const sequence = [
  'Suspend candidate',
  'Cancel candidate',
  'Ready',
  'Later missing',
  'Descriptor only',
  'Replace pending predicate',
  'Ready again',
  'Replace ready predicate',
  'Replace type',
  'Replace key',
  'Replace component',
  'Hide',
  'Missing while hidden',
  'Show pending',
  'Null fallback',
  'Remount pending',
  'Ready after remount',
  'Reorder rows',
  'Unmount',
  'Remount',
  'Teardown',
];
const actions: (() => void)[] = [
  () => owner.update({ '/payload': 'suspend', '/label': 'candidate' }),
  () => {
    owner.update({ '/payload': null, '/label': 'initial' });
    release();
  },
  () => {
    loading = false;
    owner.update({ '/payload': 'complete', '/label': 'ready' });
  },
  () => {
    loading = true;
    owner.update({ '/payload': null, '/label': 'later' });
  },
  () => {
    descriptor++;
    fallback = OtherFallback;
  },
  () => {
    predicate = readyB;
  },
  () => {
    loading = false;
    owner.update({ '/payload': 'complete-2', '/label': 'again' });
  },
  () => {
    predicate = readyA;
  },
  () => {
    type = 'OtherCard';
  },
  () => {
    elementKey = 'replacement';
  },
  () => {
    component = Alternate;
  },
  () => owner.set('/show', false),
  () => owner.update({ '/payload': null, '/label': 'hidden' }),
  () => owner.set('/show', true),
  () => {
    fallback = undefined;
  },
  () => {
    epoch++;
  },
  () => owner.update({ '/payload': 'remounted', '/label': 'final' }),
  () =>
    owner.set('/rows', [
      { id: 'b', value: null },
      { id: 'a', value: 'A-current' },
    ]),
  () => {
    root.unmount();
    state.mounted = false;
    state.observedId = 0;
  },
  () => {
    root = createRoot(target);
    state.mounted = true;
  },
  () => {
    root.unmount();
    state.mounted = false;
    state.observedId = 0;
    owner.dispose();
  },
];
sequence.forEach((label, index) => {
  const button = document.createElement('button');
  button.textContent = label;
  button.onclick = () => {
    if (state.step !== index) throw new Error('Controls must run in order');
    flushSync(() => {
      actions[index]();
      if (state.mounted) render();
    });
    state.step++;
  };
  document.getElementById('controls')!.append(button);
});
render();
