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
import { learningMilestones } from './learning-lesson';
import type { Observation, Recording } from './playback';
import tripRecording from './trip-recording.json';

const recording = tripRecording as Recording;
const labels = [
  '1. User message',
  '2. Turn in progress',
  '3. Assistant response',
  '4. Turn outcome',
];
const user = { id: 'new-user', role: 'user', text: 'A question' };
const assistant = { id: 'reply', role: 'assistant', text: 'An answer' };
function observation(
  id: string,
  overrides: Partial<Observation> = {}
): Observation {
  return {
    id,
    label: id,
    elapsedMs: 0,
    messages: [],
    state: null,
    requests: [],
    event: { type: 'snapshot', payload: null },
    ...overrides,
  };
}
function capture(frames: readonly Observation[]): Recording {
  return { ...recording, frames };
}
function guide() {
  return screen.getByRole('region', { name: 'Guided replay lesson' });
}
function explanation() {
  return screen.getByRole('region', { name: 'What to notice' });
}
function openData() {
  const button = screen.queryByRole('button', { name: 'Inspect data' });
  if (button) fireEvent.click(button);
}
function cursor() {
  return Number(
    (screen.getByRole('slider', { name: 'Observation' }) as HTMLInputElement)
      .value
  );
}
function seek(index: number) {
  fireEvent.change(screen.getByRole('slider', { name: 'Observation' }), {
    target: { value: String(index) },
  });
}
function messages(): Observation['messages'] {
  return JSON.parse(screen.getByLabelText('Messages JSON').textContent ?? '[]');
}
function required<T>(value: T | undefined): T {
  expect(value).toBeDefined();
  if (value === undefined) throw new Error('Expected captured evidence');
  return value;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('guided replay lesson', () => {
  for (const framework of ['react', 'angular'] as const) {
    it(`${framework} seeks and pauses each evidenced step with its useful inspector`, () => {
      render(<LearningWorkbench framework={framework} />);
      expect(
        within(explanation()).getByText(/user’s message.*what they asked/i)
      ).toBeTruthy();
      openData();
      expect(
        screen.getAllByRole('group', { name: 'Lesson moments' })
      ).toHaveLength(1);
      expect(
        guide().compareDocumentPosition(
          screen.getByRole('region', { name: 'Trip conversation' })
        ) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      const milestones = learningMilestones(recording);
      for (const [index, label] of labels.entries()) {
        fireEvent.click(screen.getByRole('button', { name: 'Play recording' }));
        fireEvent.click(within(guide()).getByRole('button', { name: label }));
        expect(cursor()).toBe(milestones[index].index);
        expect(
          screen.getByRole('button', { name: 'Play recording' })
        ).toBeTruthy();
        expect(
          screen.getByRole('region', {
            name: `${index % 2 === 0 ? 'Messages' : 'State'} inspection`,
          })
        ).toBeTruthy();
        expect(
          within(guide())
            .getByRole('button', { name: label })
            .getAttribute('aria-current')
        ).toBe('step');
      }
      fireEvent.click(within(guide()).getByRole('button', { name: labels[0] }));
      expect(cursor()).toBe(milestones[0].index);
      expect(messages().some((item) => item.role === 'user')).toBe(true);
      expect(messages().some((item) => item.role === 'assistant')).toBe(false);
    });
  }

  it('compares the same assistant message as text grows, without claiming the turn has ended', () => {
    render(<LearningWorkbench framework="react" />);
    openData();
    fireEvent.click(within(guide()).getByRole('button', { name: labels[2] }));
    expect(
      within(explanation()).getByRole('button', {
        name: 'Show next response update',
      })
    ).toBeTruthy();
    const before = required(
      messages().find((item) => item.role === 'assistant')
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next observation' }));
    const after = required(
      messages().find((item) => item.role === 'assistant')
    );
    expect(after.id).toBe(before.id);
    expect(after.text.startsWith(before.text)).toBe(true);
    expect(after.text.length).toBeGreaterThan(before.text.length);
    expect(
      within(guide())
        .getByRole('button', { name: labels[2] })
        .getAttribute('aria-current')
    ).toBe('step');

    const completed = required(
      learningMilestones(recording).find((item) => item.id === 'complete')
    ).index;
    const fullAnswer = required(
      recording.frames[completed].messages.find(
        (item) => item.role === 'assistant'
      )
    ).text;
    const fullBeforeOutcome = recording.frames.findIndex((frame) =>
      frame.messages.some(
        (item) => item.role === 'assistant' && item.text === fullAnswer
      )
    );
    expect(fullBeforeOutcome).toBeLessThan(completed);
    seek(fullBeforeOutcome);
    expect(
      within(guide())
        .getByRole('button', { name: labels[3] })
        .hasAttribute('aria-current')
    ).toBe(false);
    expect(
      within(guide())
        .getByRole('button', { name: labels[2] })
        .getAttribute('aria-current')
    ).toBe('step');
    expect(
      within(explanation()).getByText(/text.*does not.*turn.*complete/i)
    ).toBeTruthy();
    // Even a success outcome arrives before this example clears busy.
    expect(recording.frames[completed - 1].state).toMatchObject({
      busy: true,
      outcome: 'success',
    });
    seek(completed - 1);
    expect(
      within(guide())
        .getByRole('button', { name: labels[2] })
        .getAttribute('aria-current')
    ).toBe('step');
    fireEvent.click(within(guide()).getByRole('button', { name: labels[3] }));
    expect(
      within(explanation()).getByText(/successful outcome.*no longer busy/i)
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    expect(
      JSON.parse(
        screen.getByLabelText('Application state JSON').textContent ?? '{}'
      )
    ).toMatchObject({ busy: false, outcome: 'success' });
  });

  it('updates explanations during free seeking and playback while preserving a chosen inspector', () => {
    vi.useFakeTimers();
    render(<LearningWorkbench framework="react" />);
    const milestones = learningMilestones(recording);
    openData();
    fireEvent.click(screen.getByRole('button', { name: 'Requests' }));
    seek(milestones[2].index - 1);
    expect(
      within(guide())
        .getByRole('button', { name: labels[1] })
        .getAttribute('aria-current')
    ).toBe('step');
    fireEvent.click(screen.getByRole('button', { name: 'Play recording' }));
    act(() => vi.advanceTimersByTime(800));
    expect(
      within(guide())
        .getByRole('button', { name: labels[2] })
        .getAttribute('aria-current')
    ).toBe('step');
    expect(
      screen.getByRole('region', { name: 'Requests inspection' })
    ).toBeTruthy();
    seek(milestones[0].index);
    expect(
      within(guide())
        .getByRole('button', { name: labels[0] })
        .getAttribute('aria-current')
    ).toBe('step');
    expect(
      screen.getByRole('region', { name: 'Requests inspection' })
    ).toBeTruthy();
    seek(0);
    expect(
      within(explanation()).getByText(/first working conversation/i)
    ).toBeTruthy();
    expect(
      within(guide())
        .queryAllByRole('button')
        .every((button) => !button.hasAttribute('aria-current'))
    ).toBe(true);
  });

  it('shows only the request step for a call with retained history and no newly observed user or answer', () => {
    const history = [user, assistant];
    render(
      <LearningWorkbench
        framework="react"
        recording={capture([
          observation('ready', { messages: history }),
          observation('call', {
            messages: history,
            event: { type: 'call-started', payload: null },
          }),
          observation('settled', {
            messages: history,
            state: { busy: false, outcome: 'success' },
            event: { type: 'call-settled', payload: null },
          }),
        ])}
      />
    );
    expect(
      within(guide())
        .getAllByRole('button')
        .map((button) => button.textContent)
    ).toEqual([labels[1]]);
    fireEvent.click(within(guide()).getByRole('button', { name: labels[1] }));
    expect(cursor()).toBe(1);
    expect(
      screen.getByRole('region', { name: 'State inspection' })
    ).toBeTruthy();
  });

  it('waits for a new user after call-started before offering the User message step', () => {
    render(
      <LearningWorkbench
        framework="angular"
        recording={capture([
          observation('ready'),
          observation('call', {
            event: { type: 'call-started', payload: null },
          }),
          observation('user', { messages: [user], state: { busy: true } }),
        ])}
      />
    );
    openData();
    fireEvent.click(within(guide()).getByRole('button', { name: labels[0] }));
    expect(cursor()).toBe(2);
    expect(messages()).toEqual([user]);
    expect(
      within(guide()).queryByRole('button', { name: labels[2] })
    ).toBeNull();
    expect(
      within(guide()).queryByRole('button', { name: labels[3] })
    ).toBeNull();
  });

  it.each([
    ['empty', []],
    [
      'baseline history',
      [
        observation('baseline', {
          messages: [user, assistant],
          state: { busy: false, outcome: 'success' },
        }),
        observation('later', { messages: [user, assistant] }),
      ],
    ],
    [
      'assistant only',
      [
        observation('ready'),
        observation('reply', {
          messages: [assistant],
          state: { busy: false, outcome: 'success' },
        }),
      ],
    ],
  ] as const)(
    'omits the guide for %s without evidenced actions',
    (_name, frames) => {
      render(
        <LearningWorkbench framework="react" recording={capture(frames)} />
      );
      expect(
        screen.queryByRole('region', { name: 'Guided replay lesson' })
      ).toBeNull();
      expect(
        screen.queryByRole('group', { name: 'Lesson moments' })
      ).toBeNull();
    }
  );

  it('offers only observed steps for an incomplete turn without a successful outcome', () => {
    render(
      <LearningWorkbench
        framework="react"
        recording={capture([
          observation('ready'),
          observation('user', { messages: [user], state: { busy: true } }),
          observation('response', {
            messages: [user, assistant],
            state: { busy: true },
          }),
          observation('settled', {
            messages: [user, assistant],
            state: { busy: false, outcome: 'error' },
            event: { type: 'call-settled', payload: null },
          }),
        ])}
      />
    );
    expect(
      within(guide())
        .getAllByRole('button')
        .map((button) => button.textContent)
    ).toEqual([labels[0], labels[2]]);
  });

  it('lets an explicitly clicked step win coincident milestones and otherwise uses the latest lesson stage', () => {
    render(
      <LearningWorkbench
        framework="react"
        recording={capture([
          observation('ready'),
          observation('coincident', {
            messages: [user, assistant],
            state: { busy: true },
            event: { type: 'call-started', payload: null },
          }),
          observation('continued', {
            messages: [user, assistant],
            state: { busy: true },
          }),
        ])}
      />
    );
    openData();
    seek(0);
    seek(1);
    expect(
      within(guide())
        .getByRole('button', { name: labels[2] })
        .getAttribute('aria-current')
    ).toBe('step');
    for (const label of labels.slice(0, 3)) {
      fireEvent.click(within(guide()).getByRole('button', { name: label }));
      expect(cursor()).toBe(1);
      expect(
        within(guide())
          .getByRole('button', { name: label })
          .getAttribute('aria-current')
      ).toBe('step');
    }
    fireEvent.click(within(guide()).getByRole('button', { name: labels[0] }));
    fireEvent.click(screen.getByRole('button', { name: 'Next observation' }));
    expect(
      within(guide())
        .getByRole('button', { name: labels[2] })
        .getAttribute('aria-current')
    ).toBe('step');
    fireEvent.click(
      screen.getByRole('button', { name: 'Previous observation' })
    );
    expect(
      within(guide())
        .getByRole('button', { name: labels[2] })
        .getAttribute('aria-current')
    ).toBe('step');
  });

  it.each([true, false])(
    'omits the replay guide but retains live observation jumps (following=%s)',
    (following) => {
      const onSeek = vi.fn();
      render(
        <LearningWorkbench
          framework="react"
          live={{
            cursor: 10,
            following,
            onSeek,
            onReturn: vi.fn(),
            conversation: <iframe title="Live example" />,
          }}
        />
      );
      expect(
        screen.queryByRole('region', { name: 'Guided replay lesson' })
      ).toBeNull();
      expect(screen.queryByRole('button', { name: labels[0] })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Requests' }));
      const jumps = screen.getByRole('group', { name: 'Lesson moments' });
      fireEvent.click(
        within(jumps).getByRole('button', { name: 'Partial response' })
      );
      expect(onSeek).toHaveBeenCalledWith(
        required(
          learningMilestones(recording).find(
            (moment) => moment.id === 'partial'
          )
        ).index
      );
      expect(
        screen.getByRole('region', { name: 'Requests inspection' })
      ).toBeTruthy();
    }
  );
});
