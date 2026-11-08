import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
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

it('keeps the recorded session selected and its playhead when inspecting source, with unique regions and restored focus', () => {
  render(
    <>
      <LiveLearningWorkbench
        framework="react"
        runtimeUrl={null}
        capability="streaming"
        source={lessonSource}
      />
      <LiveLearningWorkbench
        framework="angular"
        runtimeUrl={null}
        capability="streaming"
        source={lessonSource}
      />
    </>
  );
  const workbenches = screen.getAllByRole('region', {
    name: 'Streaming learning workbench',
  });
  const first = within(workbenches[0]);
  const session = first.getByRole('group', { name: 'Example session' });
  expect(within(session).getAllByRole('button')).toHaveLength(1);
  expect(first.queryByRole('button', { name: 'Recorded example' })).toBeNull();
  const source = first.getByRole('button', { name: 'View example source' });
  const otherSource = within(workbenches[1]).getByRole('button', {
    name: 'View example source',
  });
  expect(source.getAttribute('aria-controls')).not.toBe(
    otherSource.getAttribute('aria-controls')
  );
  fireEvent.click(first.getByRole('button', { name: 'Inspect data' }));
  const initial = Number(
    (first.getByRole('slider', { name: 'Observation' }) as HTMLInputElement)
      .value
  );
  fireEvent.click(first.getByRole('button', { name: 'Next observation' }));
  source.focus();
  fireEvent.click(source);
  expect(first.getByText('Lesson source')).toBeTruthy();
  expect(source.getAttribute('aria-expanded')).toBe('true');
  const region = first.getByRole('region', { name: 'Example source' });
  expect(region.id).toBe(source.getAttribute('aria-controls'));
  expect(document.activeElement).toBe(region);
  fireEvent.click(
    first.getByRole('button', { name: 'Return to recorded example' })
  );
  expect(source.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(source);
  expect(
    (first.getByRole('slider', { name: 'Observation' }) as HTMLInputElement)
      .value
  ).toBe(String(initial + 1));
});

it('returns from source during a busy live call without losing historical position or the iframe', () => {
  render(
    <LiveLearningWorkbench
      framework="react"
      runtimeUrl="http://localhost:4600"
      capability="streaming"
      source={lessonSource}
    />
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Live conversation', exact: true })
  );
  const live = screen.getByRole('button', {
    name: 'Live conversation',
    exact: true,
  });
  const iframe = screen.getByTitle('Framework application');
  act(() => {
    bridge.options!.onInspection(observation(1));
    bridge.options!.onInspection(observation(2, true));
  });
  fireEvent.click(screen.getByRole('button', { name: 'Previous observation' }));
  fireEvent.click(
    screen.getByText('Connect observations to source', { selector: 'summary' })
  );
  const opener = screen.getByRole('button', {
    name: 'View source',
    exact: true,
  });
  (opener.closest('.tp-learn-host') as HTMLElement).scrollIntoView = vi.fn();
  fireEvent.click(opener);
  expect(live.getAttribute('aria-pressed')).toBe('true');
  expect(
    (
      screen.getByRole('button', {
        name: 'Recorded example',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  act(() => bridge.options!.onInspection(observation(3, true)));
  const back = screen.getByRole('button', {
    name: 'Return to live conversation',
  });
  expect((back as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(back);
  expect(document.activeElement).toBe(opener);
  expect(screen.getByTitle('Framework application')).toBe(iframe);
  expect(screen.getByText('Response 1')).toBeTruthy();
  expect(
    (screen.getByRole('slider', { name: 'Observation' }) as HTMLInputElement)
      .value
  ).toBe('0');
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
  fireEvent.click(
    screen.getByRole('button', { name: 'View example source', exact: true })
  );
  expect(screen.queryByTitle('Framework application')).toBeNull();
  expect(screen.getByLabelText('Lesson source code').textContent).toContain(
    'useAgent(application)'
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Live conversation', exact: true })
  );
  const iframe = screen.getByTitle('Framework application');
  act(() => bridge.options!.onInspection(observation(1, true)));
  fireEvent.click(
    screen.getByRole('button', { name: 'View example source', exact: true })
  );
  expect(iframe.isConnected).toBe(true);
  act(() => bridge.options!.onInspection(observation(2)));
  fireEvent.click(
    screen.getByRole('button', { name: 'Live conversation', exact: true })
  );
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
  fireEvent.click(
    screen.getByRole('button', { name: 'Live conversation', exact: true })
  );
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
  fireEvent.click(
    screen.getByRole('button', { name: 'Live conversation', exact: true })
  );
  const iframe = screen.getByTitle('Framework application');
  act(() => {
    bridge.options!.onInspection(observation(1));
    bridge.options!.onInspection(observation(2, true));
  });
  expect(
    (
      screen.getByRole('button', {
        name: 'Recorded example',
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
  fireEvent.click(
    screen.getByRole('button', { name: 'Recorded example', exact: true })
  );
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
  fireEvent.click(
    screen.getByRole('button', { name: 'Live conversation', exact: true })
  );
  act(() => bridge.options!.onInspection(observation(1, true)));
  act(() => bridge.options!.onInspectionReset());
  expect(screen.getByText('0 / 0')).toBeTruthy();
  expect(
    (
      screen.getByRole('button', {
        name: 'Recorded example',
        exact: true,
      }) as HTMLButtonElement
    ).disabled
  ).toBe(false);
  act(() =>
    bridge.options!.onInspection({ ...observation(2), framework: 'angular' })
  );
  expect(screen.getByText('0 / 0')).toBeTruthy();
});
