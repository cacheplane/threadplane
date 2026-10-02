import { EventType as E } from '@ag-ui/client';
import type { Session } from '@threadplane/ag-ui';
import { expect, it } from 'vitest';
import {
  captureTurn,
  confirmTranscript,
  projectWeatherViews,
  unsupportedSnapshot,
} from './tool-view-policy';

type Snapshot = ReturnType<Session['getSnapshot']>;
type Message = Snapshot['transcript'][number];
const human = {
  id: 'human',
  role: 'user' as const,
  content: '  Weather please  ',
};
const answer = {
  id: 'answer',
  role: 'assistant' as const,
  content: 'Weather ready.',
};
const data = {
  location: 'San Francisco',
  temperatureF: 68,
  conditions: 'Sunny',
  humidity: 55,
  windMph: 8,
};
function owner(id = 'owner', calls = ['call']): Message {
  return {
    id,
    role: 'assistant',
    content: '',
    toolCalls: calls.map((call) => ({
      id: call,
      type: 'function',
      function: {
        name: 'weather_card',
        arguments: JSON.stringify({ location: 'San Francisco' }),
      },
    })),
  };
}
function result(id = 'result', call = 'call', value: unknown = data): Message {
  return { id, role: 'tool', toolCallId: call, content: JSON.stringify(value) };
}
const admitted = (transcript: Snapshot['transcript'] = [human]): Snapshot => ({
  status: 'running',
  state: {},
  subagents: [],
  transcript,
  run: { id: 'run' },
});
const turn = () => ({ threadId: 'thread', runId: 'run', human, prefix: [] });
const completed = (
  transcript: Snapshot['transcript'] = [human, owner(), result(), answer]
): Snapshot => ({
  ...admitted(transcript),
  status: 'idle',
  run: {
    id: 'run',
    outcome: 'success',
    terminal: { type: E.RUN_FINISHED, threadId: 'thread', runId: 'run' },
  },
});

it('captures the actual native admitted human and borrows immutable confirmed history', () => {
  expect(captureTurn(admitted(), 'thread', undefined, [])).toEqual(turn());
  const prefix = completed().transcript;
  const next = { ...human, id: 'next-human' };
  const selected = captureTurn(
    admitted([...prefix, next]),
    'thread',
    'prior-run',
    prefix
  )!;
  expect(selected.prefix).toBe(prefix);
  expect(selected.human).toEqual(next);
});
it.each(
  [
    [human, answer],
    [human, owner(), result(), answer],
    [
      human,
      owner('owner', ['A', 'B']),
      result('result-A', 'A'),
      result('result-B', 'B'),
      answer,
    ],
    [
      human,
      owner('owner-A', ['A']),
      result('result-A', 'A'),
      owner('owner-B', ['B']),
      result('result-B', 'B'),
      answer,
    ],
  ].map((transcript) => [transcript])
)(
  'confirms zero, single, batch and multiround server-tool history %#',
  (transcript) => {
    expect(confirmTranscript(completed(transcript), turn())).toBe(transcript);
  }
);
it('projects literal tool text and owned weather scalars under the correct assistant', () => {
  const snapshot = completed();
  const views = projectWeatherViews(snapshot.transcript);
  expect(views[1]).toMatchObject({
    id: 'owner',
    tools: [
      {
        id: 'call',
        name: 'weather_card',
        argumentsText: JSON.stringify({ location: 'San Francisco' }),
        resultText: JSON.stringify(data),
        weather: data,
      },
    ],
  });
  expect(views[0].text).toEqual(human);
  expect(views[2].text).toEqual(answer);
  expect(Object.isFrozen(snapshot.transcript)).toBe(false);
  expect(Object.isFrozen(views[1].tools[0].weather)).toBe(true);
});
it('pending arguments and missing or partial result data stay observations while streaming', () => {
  const partial: Message = {
    id: 'owner',
    role: 'assistant',
    toolCalls: [
      {
        id: 'call',
        type: 'function',
        function: { name: 'weather_card', arguments: '{"location":' },
      },
    ],
  };
  const snapshot = admitted([human, partial]);
  expect(unsupportedSnapshot(snapshot)).toBe(false);
  expect(
    projectWeatherViews(snapshot.transcript)[1].tools[0].weather
  ).toBeUndefined();
  expect(
    unsupportedSnapshot(
      admitted([
        human,
        owner(),
        { id: 'call', role: 'tool', toolCallId: 'call', content: '{' },
      ])
    )
  ).toBe(false);
});
it('current-run incremental result IDs may reconcile to final graph UUIDs', () => {
  const streaming = admitted([human, owner(), result('call')]);
  const pending = projectWeatherViews(streaming.transcript)[1].tools[0];
  expect(pending.weather).toEqual(data);
  expect(confirmTranscript(completed(), turn())).toBeDefined();
  expect(projectWeatherViews(completed().transcript)[1].tools[0]).toEqual(
    pending
  );
});
it('confirmed tool-bearing history must remain exact including call arguments and metadata', () => {
  const prefix = completed().transcript;
  const next = { ...human, id: 'next-human' };
  const selected = captureTurn(
    admitted([...prefix, next]),
    'thread',
    'prior',
    prefix
  )!;
  const final = completed([...prefix, next, { ...answer, id: 'next-answer' }]);
  expect(confirmTranscript(final, selected)).toBeDefined();
  const changed = [...final.transcript];
  changed[1] = { ...owner(), metadata: { changed: true } };
  expect(
    confirmTranscript({ ...final, transcript: changed }, selected)
  ).toBeUndefined();
});
it.each(
  [
    [human, owner(), answer],
    [human, result(), answer],
    [human, owner(), result('A'), result('B'), answer],
    [human, owner(), result(), { ...answer, id: 'human' }],
    [human, owner('owner', ['call', 'call']), result(), answer],
    [human, owner(), result('result', 'other'), answer],
    [human, owner(), result(), { ...answer, content: '' }],
    [human, answer, result()],
    [human, owner()],
  ].map((transcript) => [transcript])
)(
  'rejects unfinished, ambiguous and invalid settled histories %#',
  (transcript) => {
    expect(confirmTranscript(completed(transcript), turn())).toBeUndefined();
  }
);
it.each([
  { ...data, humidity: 101 },
  { ...data, humidity: -1 },
  { ...data, windMph: -1 },
  { ...data, temperatureF: '68' },
  { ...data, location: '' },
  { ...data, conditions: '' },
  { ...data, location: 'Different city' },
  { ...data, surprise: true },
  null,
  [],
])('rejects malformed or mismatched settled weather %#', (value) => {
  expect(
    confirmTranscript(
      completed([human, owner(), result('result', 'call', value), answer]),
      turn()
    )
  ).toBeUndefined();
});
it.each([
  '{}',
  '{"location":""}',
  '{"location":"SF","extra":true}',
  '[]',
  'null',
  '{',
])('requires exact settled weather arguments %s', (argumentsText) => {
  const changed: Message = {
    id: 'owner',
    role: 'assistant',
    toolCalls: [
      {
        id: 'call',
        type: 'function',
        function: { name: 'weather_card', arguments: argumentsText },
      },
    ],
  };
  expect(
    confirmTranscript(completed([human, changed, result(), answer]), turn())
  ).toBeUndefined();
});
it('native success with pending tool IDs cannot confirm the turn', () => {
  const snapshot: Snapshot = {
    ...completed(),
    run: {
      id: 'run',
      outcome: 'success',
      terminal: {
        type: E.RUN_FINISHED,
        threadId: 'thread',
        runId: 'run',
        outcome: { type: 'success', pendingToolCallIds: ['unobserved'] },
      },
    },
  };
  expect(unsupportedSnapshot(snapshot)).toBe(true);
  expect(confirmTranscript(snapshot, turn())).toBeUndefined();
});
it.each(['error', 'interrupted', 'aborted', 'paused'] as const)(
  'rejects uncertain local %s outcomes',
  (outcome) => {
    expect(
      confirmTranscript(
        { ...completed(), run: { ...completed().run!, outcome } },
        turn()
      )
    ).toBeUndefined();
  }
);
it('rejects wrong root terminal and preserves caller revocation', () => {
  const snapshot = completed();
  expect(
    confirmTranscript(
      {
        ...snapshot,
        run: {
          id: 'run',
          outcome: 'success',
          terminal: { type: E.RUN_FINISHED, threadId: 'other', runId: 'run' },
        },
      },
      turn()
    )
  ).toBeUndefined();
  expect(
    captureTurn(admitted(), 'thread', undefined, [], () => false)
  ).toBeUndefined();
  expect(confirmTranscript(snapshot, turn(), () => false)).toBeUndefined();
});
it('rejects child and unknown tool attribution without executing it', () => {
  const child: Message = { ...owner(), subagentRunId: 'child' };
  expect(unsupportedSnapshot(admitted([human, child]))).toBe(true);
  const unknown: Message = {
    id: 'owner',
    role: 'assistant',
    toolCalls: [
      {
        id: 'call',
        type: 'function',
        function: { name: 'browser_execute', arguments: '{}' },
      },
    ],
  };
  expect(unsupportedSnapshot(admitted([human, unknown]))).toBe(true);
});
it.each(['error', 'interrupted', 'aborted', 'paused'] as const)(
  'retains unsafe evidence from a locally %s native run',
  (outcome) => {
    expect(
      unsupportedSnapshot({ ...admitted(), run: { id: 'run', outcome } })
    ).toBe(true);
  }
);
it('rejects an observed root error and wrong terminal identity before publication can restore them', () => {
  expect(
    unsupportedSnapshot({
      ...admitted(),
      run: { id: 'run', terminal: { type: E.RUN_ERROR, message: 'Failure' } },
    })
  ).toBe(true);
  expect(
    unsupportedSnapshot({
      ...admitted(),
      run: {
        id: 'run',
        terminal: { type: E.RUN_FINISHED, threadId: 'thread', runId: 'other' },
      },
    })
  ).toBe(true);
});
