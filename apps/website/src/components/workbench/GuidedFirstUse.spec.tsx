import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LearningWorkbench } from './LearningWorkbench';
import type { Observation, Recording } from './playback';
import tripRecording from './trip-recording.json';

const fixture = tripRecording as Recording;
const user = { id: 'new-user', role: 'user', text: 'A new question' };
const assistant = { id: 'reply', role: 'assistant', text: 'First' };
function frame(id: string, overrides: Partial<Observation> = {}): Observation {
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
  return { ...fixture, frames };
}
function explanation() {
  return screen.getByRole('region', { name: 'What to notice' });
}
function stage(label: string) {
  fireEvent.click(screen.getByRole('button', { name: label, exact: true }));
}
function cursor() {
  return Number(
    (screen.getByLabelText('Observation') as HTMLInputElement).value
  );
}
afterEach(cleanup);

describe('guided first use', () => {
  it.each(['angular', 'react'] as const)(
    '%s opens on the actual new user with one primary next action and hidden raw controls',
    (framework) => {
      render(<LearningWorkbench framework={framework} />);
      const userFrame = fixture.frames.findIndex(
        (item, index) =>
          index > 0 && item.messages.some((message) => message.role === 'user')
      );
      const conversation = screen.getByRole('region', {
        name: 'Trip conversation',
      });
      expect(
        within(conversation).getByText(
          fixture.frames[userFrame].messages[0].text
        )
      ).toBeTruthy();
      expect(
        screen
          .getByRole('button', { name: '1. User message' })
          .getAttribute('aria-current')
      ).toBe('step');
      expect(
        screen.getByRole('button', { name: 'Next: turn in progress' })
      ).toBeTruthy();
      expect(explanation()).toBeTruthy();
      expect(
        screen.queryByRole('group', { name: 'Inspector view' })
      ).toBeNull();
      expect(screen.queryByRole('slider', { name: 'Observation' })).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'Play recording' })
      ).toBeNull();
      expect(
        screen
          .getByRole('button', { name: 'Inspect data' })
          .getAttribute('aria-expanded')
      ).toBe('false');
    }
  );

  it('navigates Next, Back, Replay lesson and Restart lesson without starting playback', () => {
    render(<LearningWorkbench framework="react" />);
    stage('Next: turn in progress');
    expect(
      screen
        .getByRole('button', { name: '2. Turn in progress' })
        .getAttribute('aria-current')
    ).toBe('step');
    stage('Next: assistant response');
    stage('Back');
    expect(
      screen
        .getByRole('button', { name: '2. Turn in progress' })
        .getAttribute('aria-current')
    ).toBe('step');
    stage('Next: assistant response');
    stage('Next: turn outcome');
    expect(within(explanation()).getByText('Complete')).toBeTruthy();
    stage('Replay lesson');
    expect(
      screen
        .getByRole('button', { name: '1. User message' })
        .getAttribute('aria-current')
    ).toBe('step');
    stage('3. Assistant response');
    stage('Restart lesson');
    expect(
      screen
        .getByRole('button', { name: '1. User message' })
        .getAttribute('aria-current')
    ).toBe('step');
    stage('Inspect data');
    expect(screen.getByRole('button', { name: 'Play recording' })).toBeTruthy();
  });

  it('retains cursor, chosen raw state format and expanded data through stage and source inspection', () => {
    const source = {
      revision: 'abc',
      files: [{ path: 'app.ts', source: 'const answer = 1;', highlights: [] }],
      snippet: { path: 'app.ts', code: 'const answer = 1;', start: 1, end: 1 },
    };
    const view = render(
      <LearningWorkbench framework="react" source={source} />
    );
    stage('Inspect data');
    stage('2. Turn in progress');
    stage('JSON');
    const index = cursor();
    view.rerender(
      <LearningWorkbench framework="react" source={source} sourceOpen />
    );
    view.rerender(<LearningWorkbench framework="react" source={source} />);
    expect(cursor()).toBe(index);
    expect(
      screen
        .getByRole('button', { name: 'Hide data' })
        .getAttribute('aria-expanded')
    ).toBe('true');
    expect(screen.getByLabelText('Application state JSON')).toBeTruthy();
    stage('Next: assistant response');
    expect(
      screen.getByRole('region', { name: 'Messages inspection' })
    ).toBeTruthy();
    stage('Hide data');
    expect(cursor()).toBeGreaterThan(index);
    expect(screen.queryByRole('group', { name: 'Inspector view' })).toBeNull();
  });

  it('advances only changed text for the same assistant id before completion and the next turn', () => {
    const recording = capture([
      frame('ready'),
      frame('user', { messages: [user], state: { busy: true } }),
      frame('first', { messages: [user, assistant], state: { busy: true } }),
      frame('unchanged', {
        messages: [user, assistant],
        state: { busy: true },
      }),
      frame('grown', {
        messages: [user, { ...assistant, text: 'First answer' }],
        state: { busy: true, outcome: 'success' },
      }),
      frame('complete', {
        messages: [user, { ...assistant, text: 'First answer' }],
        state: { busy: false, outcome: 'success' },
      }),
      frame('next-turn', {
        messages: [user, { ...assistant, text: 'Different turn text' }],
        state: { busy: true },
        event: { type: 'call-started', payload: null },
      }),
    ]);
    render(<LearningWorkbench framework="react" recording={recording} />);
    stage('3. Assistant response');
    stage('Show next response update');
    expect(
      within(
        screen.getByRole('region', { name: 'Trip conversation' })
      ).getByText('First answer')
    ).toBeTruthy();
    expect(within(explanation()).getByText('Working')).toBeTruthy();
    expect(within(explanation()).queryByText('Complete')).toBeNull();
    expect(
      (
        screen.getByRole('button', {
          name: 'Show next response update',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    stage('Inspect data');
    expect(cursor()).toBe(4);
    expect(
      JSON.parse(screen.getByLabelText('Messages JSON').textContent ?? '[]')[1]
        .id
    ).toBe(assistant.id);
    stage('Next: turn outcome');
    expect(within(explanation()).getByText('Complete')).toBeTruthy();
  });

  it.each([true, false])(
    'never sends Next backward to a call before the new user (busy=%s)',
    (busy) => {
      render(
        <LearningWorkbench
          framework="react"
          recording={capture([
            frame('ready'),
            frame('call', { event: { type: 'call-started', payload: null } }),
            frame('user', { messages: [user], state: { busy } }),
            frame('response', {
              messages: [user, assistant],
              state: { busy: true },
            }),
          ])}
        />
      );
      stage('Inspect data');
      expect(cursor()).toBe(2);
      stage(busy ? 'Next: turn in progress' : 'Next: assistant response');
      expect(cursor()).toBe(busy ? 2 : 3);
      if (busy)
        expect(
          screen
            .getByRole('button', { name: '2. Turn in progress' })
            .getAttribute('aria-current')
        ).toBe('step');
      else
        expect(
          screen.queryByRole('button', { name: '2. Turn in progress' })
        ).toBeNull();
    }
  );

  it('shows observed count and no current response for retained assistant history', () => {
    render(
      <LearningWorkbench
        framework="react"
        recording={capture([
          frame('history', { messages: [assistant] }),
          frame('user', { messages: [assistant, user], state: { busy: true } }),
          frame('response', {
            messages: [
              assistant,
              user,
              { id: 'new-reply', role: 'assistant', text: 'New answer' },
            ],
            state: { busy: true },
          }),
        ])}
      />
    );
    expect(within(explanation()).getByText('2')).toBeTruthy();
    expect(
      within(explanation()).getByText('No response observed')
    ).toBeTruthy();
    stage('3. Assistant response');
    expect(within(explanation()).getByText('Text received')).toBeTruthy();
  });

  it('omits a late request from lesson navigation so Next never moves backward', () => {
    render(
      <LearningWorkbench
        framework="react"
        recording={capture([
          frame('ready'),
          frame('user', { messages: [user], state: { busy: true } }),
          frame('response', {
            messages: [user, assistant],
            state: { busy: true },
          }),
          frame('late request', {
            messages: [user, assistant],
            state: { busy: true },
            event: { type: 'http.request', payload: null },
            requests: [
              {
                id: 'late',
                method: 'POST',
                path: '/runs/stream',
                body: null,
                status: null,
              },
            ],
          }),
          frame('complete', {
            messages: [user, assistant],
            state: { busy: false, outcome: 'success' },
          }),
        ])}
      />
    );
    stage('Inspect data');
    expect(cursor()).toBe(1);
    expect(
      screen.queryByRole('button', { name: '2. Turn in progress' })
    ).toBeNull();
    stage('Next: assistant response');
    expect(cursor()).toBe(2);
    stage('Next: turn outcome');
    expect(cursor()).toBe(4);
    stage('Events');
    expect(
      screen.getByRole('button', { name: /4\. late request/ })
    ).toBeTruthy();
  });

  it('uses neutral lesson copy when the playhead enters a second busy turn', () => {
    render(
      <LearningWorkbench
        framework="react"
        recording={capture([
          frame('ready'),
          frame('user', { messages: [user], state: { busy: true } }),
          frame('response', {
            messages: [user, assistant],
            state: { busy: true },
          }),
          frame('complete', {
            messages: [user, assistant],
            state: { busy: false, outcome: 'success' },
          }),
          frame('second turn', {
            messages: [user, assistant],
            state: { busy: true },
            event: { type: 'call-started', payload: null },
          }),
          frame('second user', {
            messages: [
              user,
              assistant,
              { id: 'second-user', role: 'user', text: 'Another question' },
            ],
            state: { busy: true },
          }),
        ])}
      />
    );
    stage('4. Turn outcome');
    expect(within(explanation()).getByText(/no longer busy/)).toBeTruthy();
    stage('Inspect data');
    for (const index of [4, 5]) {
      fireEvent.change(screen.getByRole('slider', { name: 'Observation' }), {
        target: { value: String(index) },
      });
      expect(within(explanation()).queryByText(/no longer busy/)).toBeNull();
      expect(
        within(explanation()).getByText(/choose a lesson step/i)
      ).toBeTruthy();
      expect(within(explanation()).getByText('Working')).toBeTruthy();
      expect(
        within(screen.getByRole('group', { name: 'Lesson moments' }))
          .getAllByRole('button')
          .every((button) => !button.hasAttribute('aria-current'))
      ).toBe(true);
    }
    fireEvent.change(screen.getByRole('slider', { name: 'Observation' }), {
      target: { value: '3' },
    });
    expect(within(explanation()).getByText(/no longer busy/)).toBeTruthy();
  });

  it.each([
    [{ busy: true, outcome: 'success' }, 'Working'],
    [{ busy: false, outcome: 'error' }, 'Failed'],
    [{ busy: false, outcome: 'cancelled' }, 'Stopped'],
    [{ busy: false, outcome: 'aborted' }, 'Stopped'],
    [{ busy: false }, 'Outcome unknown'],
  ] as const)('reports only the observed turn state %j', (state, label) => {
    render(
      <LearningWorkbench
        framework="react"
        recording={capture([
          frame('ready'),
          frame('user', { messages: [user], state: { busy: true } }),
          frame('response', {
            messages: [user, assistant],
            state: { busy: true },
          }),
          frame('last', { messages: [user, assistant], state }),
        ])}
      />
    );
    stage('Inspect data');
    fireEvent.change(screen.getByRole('slider', { name: 'Observation' }), {
      target: { value: '3' },
    });
    expect(within(explanation()).getByText(label)).toBeTruthy();
    expect(within(explanation()).queryByText('Complete')).toBeNull();
  });

  it('decodes captured literal newline escapes only in conversation display', () => {
    render(
      <LearningWorkbench
        framework="react"
        recording={capture([
          frame('ready'),
          frame('user', { messages: [user], state: { busy: true } }),
          frame('response', {
            messages: [user, { ...assistant, text: 'First\\nSecond' }],
            state: { busy: true },
          }),
        ])}
      />
    );
    stage('3. Assistant response');
    expect(
      within(
        screen.getByRole('region', { name: 'Trip conversation' })
      ).getByText('First Second').textContent
    ).toBe('First\nSecond');
    stage('Inspect data');
    expect(
      JSON.parse(screen.getByLabelText('Messages JSON').textContent ?? '[]')[1]
        .text
    ).toBe('First\\nSecond');
  });
});
