import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { InspectionFrame } from '@threadplane/cockpit-runtime-bridge';
import { LiveLearningWorkbench } from './LiveLearningWorkbench';
import type { LearningSource } from './learning-lesson';

const lessonSource: LearningSource = {
  revision: 'a'.repeat(40),
  files: [
    {
      path: 'cockpit/app.tsx',
      source: 'const snapshot = useAgent(application);',
      highlights: [{ start: 1, end: 1 }],
    },
  ],
  snippet: {
    path: 'cockpit/app.tsx',
    code: 'const snapshot = useAgent(application);',
    start: 1,
    end: 1,
  },
};

const bridge = vi.hoisted(() => ({
  options: null as null | {
    onInspection(frame: InspectionFrame): void;
    onInspectionReset(): void;
  },
  reload: vi.fn(),
  phase: 'ready',
}));
vi.mock('@threadplane/workspace-react', () => ({
  RunMode: () => <iframe title="Framework application" />,
  RuntimeTargetSettings: () => <div>Runtime target settings</div>,
  useRuntimeTargetView: () => ({ kind: 'shared' }),
  useEmbeddedRuntimeController: (options: typeof bridge.options) => {
    bridge.options = options;
    return {
      snapshot: { phase: bridge.phase },
      validatedRuntimeUrl: 'http://localhost:4600',
      frameRef: { current: null },
      frameGeneration: 0,
      targetGeneration: 0,
      onFrameLoad: vi.fn(),
      reload: bridge.reload,
    };
  },
}));
const observation = (sequence: number, busy = false): InspectionFrame => ({
  sequence,
  elapsedMs: sequence,
  framework: 'react',
  messages: [{ id: 'a', role: 'assistant', text: `Response ${sequence}` }],
  state: { busy },
  busy,
  calls: [],
  event: { type: 'snapshot', payload: null },
  limited: false,
});
afterEach(() => {
  cleanup();
  bridge.phase = 'ready';
});

it('opens source without starting a runtime and preserves a running iframe through source and layout changes', () => {
  render(
    <LiveLearningWorkbench
      framework="react"
      runtimeUrl="http://localhost:4600"
      capability="streaming"
      source={lessonSource}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Source', exact: true }));
  expect(screen.queryByTitle('Framework application')).toBeNull();
  expect(screen.getByLabelText('Lesson source code').textContent).toContain(
    'useAgent(application)'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Live', exact: true }));
  const iframe = screen.getByTitle('Framework application');
  act(() => bridge.options!.onInspection(observation(1, true)));
  fireEvent.click(screen.getByRole('button', { name: 'Source', exact: true }));
  expect(iframe.isConnected).toBe(true);
  act(() => bridge.options!.onInspection(observation(2)));
  fireEvent.click(screen.getByRole('button', { name: 'Live', exact: true }));
  expect(screen.getByTitle('Framework application')).toBe(iframe);
  fireEvent.keyDown(
    screen.getByRole('separator', {
      name: 'Resize conversation and inspector',
    }),
    { key: 'ArrowRight' }
  );
  fireEvent.click(screen.getByRole('button', { name: 'Expand workbench' }));
  expect(screen.getByTitle('Framework application')).toBe(iframe);
  expect(
    screen
      .getByRole('link', { name: 'Open React streaming example' })
      .getAttribute('href')
  ).toBe('/docs/react/langgraph/guides/streaming');
});

it('allows recovery reload after a failed child leaves a pending call', () => {
  const view = render(
    <LiveLearningWorkbench
      framework="react"
      runtimeUrl="http://localhost:4600"
      capability="streaming"
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Live', exact: true }));
  act(() => bridge.options!.onInspection(observation(1, true)));
  expect(
    (
      screen.getByRole('button', {
        name: 'Reload live app',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  bridge.phase = 'unresponsive';
  view.rerender(
    <LiveLearningWorkbench
      framework="react"
      runtimeUrl="http://localhost:4600"
      capability="streaming"
    />
  );
  expect(
    (
      screen.getByRole('button', {
        name: 'Reload live app',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(false);
});

it('mounts no runtime until Live is selected, follows observations and preserves history while capture continues', () => {
  render(
    <LiveLearningWorkbench
      framework="react"
      runtimeUrl="http://localhost:4600"
      capability="langgraph/streaming/react"
    />
  );
  expect(screen.queryByTitle('Framework application')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Live', exact: true }));
  const iframe = screen.getByTitle('Framework application');
  act(() => {
    bridge.options!.onInspection(observation(1));
    bridge.options!.onInspection(observation(2, true));
  });
  expect(
    (
      screen.getByRole('button', {
        name: 'Replay',
        exact: true,
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Previous observation' }));
  expect(screen.getByText('Response 1')).toBeTruthy();
  act(() => bridge.options!.onInspection(observation(3)));
  expect(screen.getByText('Response 1')).toBeTruthy();
  expect(iframe.parentElement?.hidden).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Return to live' }));
  expect(screen.getByTitle('Framework application')).toBe(iframe);
  expect(iframe.parentElement?.hidden).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Replay', exact: true }));
  expect(screen.queryByTitle('Framework application')).toBeNull();
});

it('clears captures on configuration reset and ignores frames from another framework', () => {
  render(
    <LiveLearningWorkbench
      framework="react"
      runtimeUrl="http://localhost:4600"
      capability="streaming"
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Live', exact: true }));
  act(() => bridge.options!.onInspection(observation(1, true)));
  act(() => bridge.options!.onInspectionReset());
  expect(screen.getByText('0 / 0')).toBeTruthy();
  expect(
    (
      screen.getByRole('button', {
        name: 'Replay',
        exact: true,
      }) as HTMLButtonElement
    ).disabled
  ).toBe(false);
  act(() =>
    bridge.options!.onInspection({ ...observation(2), framework: 'angular' })
  );
  expect(screen.getByText('0 / 0')).toBeTruthy();
});
