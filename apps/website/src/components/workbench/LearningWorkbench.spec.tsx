import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LearningWorkbench } from './LearningWorkbench';
import type { Recording } from './playback';

const recording: Recording = {
  version: 1,
  provenance: {
    kind: 'sdk-fixture',
    description: 'Test capture',
    source: 'fixture.ts',
  },
  frames: [
    {
      id: '0',
      label: 'Ready',
      elapsedMs: 0,
      messages: [],
      state: null,
      requests: [],
      event: { type: 'ready', payload: null },
    },
    {
      id: '1',
      label: 'Streaming',
      elapsedMs: 10,
      messages: [{ id: 'a', role: 'assistant', text: 'Paris' }],
      state: { application: { busy: true } },
      requests: [
        {
          id: 'r',
          method: 'POST',
          path: '/runs/stream',
          body: { input: 'Trip' },
          status: null,
        },
      ],
      event: { type: 'snapshot', payload: { busy: true } },
    },
    {
      id: '2',
      label: 'Complete',
      elapsedMs: 20,
      messages: [{ id: 'a', role: 'assistant', text: 'Paris itinerary' }],
      state: { application: { busy: false } },
      requests: [
        {
          id: 'r',
          method: 'POST',
          path: '/runs/stream',
          body: { input: 'Trip' },
          status: 200,
        },
      ],
      event: { type: 'complete', payload: { busy: false } },
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('learning inspector', () => {
  it('seeks a requested teaching moment and pauses playback without remounting', () => {
    const view = render(
      <LearningWorkbench framework="react" recording={recording} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Play recording' }));
    view.rerender(
      <LearningWorkbench
        framework="react"
        recording={recording}
        seekRequest={{ id: 1, index: 1 }}
      />
    );
    expect(
      (screen.getByRole('slider', { name: 'Observation' }) as HTMLInputElement)
        .value
    ).toBe('1');
    expect(screen.getByRole('button', { name: 'Play recording' })).toBeTruthy();
  });
  it('preserves historical reading position when new live observations arrive', () => {
    const live = {
      cursor: 1,
      following: false,
      onSeek: vi.fn(),
      onReturn: vi.fn(),
      conversation: <iframe title="App" />,
    };
    const view = render(
      <LearningWorkbench framework="react" recording={recording} live={live} />
    );
    const pane = screen.getByRole('region', {
      name: 'Recorded conversation messages',
    });
    pane.scrollTop = 50;
    view.rerender(
      <LearningWorkbench
        framework="react"
        recording={{
          ...recording,
          frames: recording.frames.map((frame) => ({ ...frame })),
        }}
        live={live}
      />
    );
    expect(pane.scrollTop).toBe(50);
  });
  it('keeps the live application mounted but inert during historical inspection and labels calls honestly', () => {
    const onSeek = vi.fn();
    const onReturn = vi.fn();
    const live = {
      cursor: 1,
      following: false,
      onSeek,
      onReturn,
      conversation: <iframe title="Real application" />,
    };
    const observed = {
      ...recording,
      frames: recording.frames.map((frame) => ({
        ...frame,
        calls: [
          {
            id: 'call-1',
            name: 'submit' as const,
            input: { message: 'Trip' },
            status: 'pending' as const,
          },
        ],
      })),
    };
    const view = render(
      <LearningWorkbench framework="react" recording={observed} live={live} />
    );
    const iframe = screen.getByTitle('Real application');
    expect(iframe.parentElement?.hidden).toBe(true);
    expect(iframe.parentElement?.hasAttribute('inert')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Requests' }));
    expect(screen.getByText('Application call pending')).toBeTruthy();
    expect(screen.queryByText(/HTTP 200/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next observation' }));
    expect(onSeek).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByRole('button', { name: 'Return to live' }));
    expect(onReturn).toHaveBeenCalledOnce();
    view.rerender(
      <LearningWorkbench
        framework="react"
        recording={{ ...observed }}
        live={{ ...live, following: true }}
      />
    );
    expect(screen.getByTitle('Real application')).toBe(iframe);
    expect(iframe.parentElement?.hidden).toBe(false);
    expect(screen.queryByRole('button', { name: 'Play recording' })).toBeNull();
  });
  it('seeks conversation, request status and state together, including backward', () => {
    render(<LearningWorkbench framework="react" recording={recording} />);
    expect(
      screen.getByText('State has not been observed at this point.')
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next observation' }));
    expect(
      within(
        screen.getByRole('region', { name: 'Trip conversation' })
      ).getByText('Paris')
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Requests' }));
    expect(screen.getByText('Response not yet observed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next observation' }));
    expect(screen.getByText('HTTP 200')).toBeTruthy();
    expect(
      within(
        screen.getByRole('region', { name: 'Trip conversation' })
      ).getByText('Paris itinerary')
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Previous observation' })
    );
    expect(screen.getByText('Response not yet observed')).toBeTruthy();
    expect(screen.queryByText('Paris itinerary')).toBeNull();
  });

  it('retains expanded paths through seeking and tree/JSON changes', () => {
    render(<LearningWorkbench framework="angular" recording={recording} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next observation' }));
    fireEvent.click(screen.getByRole('button', { name: /Expand application/ }));
    expect(screen.getByText('busy')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next observation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tree' }));
    expect(
      screen
        .getByRole('button', { name: /Collapse application/ })
        .getAttribute('aria-expanded')
    ).toBe('true');
    expect(screen.getByText('false')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Previous observation' })
    );
    expect(screen.getByText('true')).toBeTruthy();
  });

  it('plays only on request, stops at the end, restarts and disposes the timer', () => {
    vi.useFakeTimers();
    const view = render(
      <LearningWorkbench framework="react" recording={recording} />
    );
    act(() => vi.advanceTimersByTime(2000));
    expect(
      (screen.getByRole('slider', { name: 'Observation' }) as HTMLInputElement)
        .value
    ).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: 'Play recording' }));
    act(() => vi.advanceTimersByTime(2000));
    expect(
      (screen.getByRole('slider', { name: 'Observation' }) as HTMLInputElement)
        .value
    ).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: 'Replay recording' }));
    expect(
      (screen.getByRole('slider', { name: 'Observation' }) as HTMLInputElement)
        .value
    ).toBe('0');
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('selects events and links to real framework source without a fake live control', () => {
    const view = render(
      <LearningWorkbench framework="angular" recording={recording} />
    );
    expect(
      screen.getByRole('link', { name: 'Angular source' }).getAttribute('href')
    ).toContain('/angular/src/app/streaming.component.ts');
    fireEvent.click(screen.getByRole('button', { name: 'Events' }));
    fireEvent.click(screen.getByRole('button', { name: /3. Complete/ }));
    expect(
      within(
        screen.getByRole('region', { name: 'Trip conversation' })
      ).getByText('Paris itinerary')
    ).toBeTruthy();
    view.rerender(
      <LearningWorkbench framework="react" recording={recording} />
    );
    expect(
      screen.getByRole('link', { name: 'React source' }).getAttribute('href')
    ).toContain('/react/src/app.tsx');
    expect(
      screen.queryByRole('button', { name: 'Live conversation' })
    ).toBeNull();
  });
});
