import { EventType as E } from '@ag-ui/client';
import type { Session } from '@threadplane/ag-ui';
import { expect, it } from 'vitest';
import {
  captureTurn,
  confirmTranscript,
  selectDashboard,
  unsupportedSnapshot,
} from './dashboard-policy';

type Snapshot = ReturnType<Session['getSnapshot']>;
type Message = Snapshot['transcript'][number];
const human = {
  id: 'human',
  role: 'user' as const,
  content: '  Dashboard please  ',
};
const answer = {
  id: 'answer',
  role: 'assistant' as const,
  content: 'The dashboard is ready.',
};
const layout = {
  root: 'card',
  elements: {
    card: {
      type: 'stat_card',
      props: { label: 'On time', value: { $state: '/on_time/value' } },
    },
  },
};
const metric = {
  on_time: { value: '84.2%', delta: '+1.4%' },
  flights_today: { value: 312, delta: '+8' },
  avg_delay: { value: '12 min', delta: '-2 min' },
  load_factor: { value: '78.5%', delta: '+0.6%' },
};
const call = (id: string, name: string, args: unknown) => ({
  id,
  type: 'function' as const,
  function: { name, arguments: JSON.stringify(args) },
});
const toolResult = (id: string, value: unknown, text = false): Message => ({
  id,
  role: 'tool',
  toolCallId: id,
  content: text ? String(value) : JSON.stringify(value),
});
const fullOwner: Message = {
  id: 'owner',
  role: 'assistant',
  content: JSON.stringify(layout),
  toolCalls: [
    call('render', 'render_spec', layout),
    call('data', 'query_airline_kpis', {}),
  ],
};
const full: Snapshot['transcript'] = [
  human,
  fullOwner,
  toolResult('render', 'rendered', true),
  toolResult('data', metric),
  { id: 'ack', role: 'assistant', content: 'Dashboard prepared.' },
  answer,
];
const running = (transcript: Snapshot['transcript'] = [human]): Snapshot => ({
  status: 'running',
  state: metric,
  subagents: [],
  transcript,
  run: { id: 'run' },
});
const turn = () => ({ threadId: 'thread', runId: 'run', human, prefix: [] });
const completed = (transcript: Snapshot['transcript'] = full): Snapshot => ({
  ...running(transcript),
  status: 'idle',
  run: {
    id: 'run',
    outcome: 'success',
    terminal: { type: E.RUN_FINISHED, threadId: 'thread', runId: 'run' },
  },
});

it('captures native admission and borrows exact retained confirmed history', () => {
  expect(captureTurn(running(), 'thread', undefined, [])).toEqual(turn());
  const next = { ...human, id: 'next' };
  const selected = captureTurn(
    running([...full, next]),
    'thread',
    'prior-run',
    full
  );
  expect(selected?.prefix).toBe(full);
  expect(selected?.human).toEqual(next);
});
it('confirms actual postprocess history with tool results before both acknowledgments', () => {
  expect(confirmTranscript(completed(), turn())).toBe(full);
  const selected = selectDashboard(completed(), turn());
  expect(selected?.ownerId).toBe('owner');
  expect(selected?.spec).toEqual(layout);
  expect(selected?.state).toEqual(metric);
});
it('supports nonempty assistant prose with the original render tool payload', () => {
  const owner = { ...fullOwner, content: 'Preparing the layout.' };
  const transcript = [
    human,
    owner,
    toolResult('render', layout),
    toolResult('data', metric),
    answer,
  ];
  expect(confirmTranscript(completed(transcript), turn())).toBe(transcript);
  expect(selectDashboard(completed(transcript), turn())?.spec).toEqual(layout);
});
it('retains the accepted layout through a data-only update on the same native prefix', () => {
  const previous = selectDashboard(completed(), turn());
  const next = { ...human, id: 'next' };
  const owner: Message = {
    id: 'filter-owner',
    role: 'assistant',
    toolCalls: [
      call('filter', 'query_recent_disruptions', {
        type: 'cancelled',
        limit: 5,
      }),
    ],
  };
  const rows = [
    {
      flight_number: 'AA456',
      type: 'cancelled',
      minutes: 0,
      route: 'JFK→LAX',
      date: '2026-05-14',
    },
  ];
  const final = [
    ...full,
    next,
    owner,
    toolResult('filter', rows),
    { ...answer, id: 'filter-answer' },
  ];
  const snapshot = {
    ...completed(final),
    state: { ...metric, recent_disruptions: rows },
  };
  const currentTurn = { ...turn(), human: next, prefix: full };
  expect(confirmTranscript(snapshot, currentTurn)).toBe(final);
  const selected = selectDashboard(snapshot, currentTurn, previous);
  expect(selected?.ownerId).toBe('owner');
  expect(selected?.spec).toBe(previous?.spec);
  expect(selected?.state.recent_disruptions).toEqual(rows);
});
it('accepts plain/no-tool replies and empty intermediate acknowledgments without inventing a layout', () => {
  const transcript = [
    human,
    { id: 'empty-ack', role: 'assistant' as const, content: '' },
    answer,
  ];
  expect(confirmTranscript(completed(transcript), turn())).toBe(transcript);
  expect(selectDashboard(completed(transcript), turn())?.spec).toBeNull();
});
it('keeps incomplete arguments/results as running observations', () => {
  const partial: Message = {
    id: 'owner',
    role: 'assistant',
    toolCalls: [
      {
        ...call('render', 'render_spec', layout),
        function: { name: 'render_spec', arguments: '{"root":' },
      },
    ],
  };
  expect(unsupportedSnapshot(running([human, partial]))).toBe(false);
  expect(confirmTranscript(running([human, partial]), turn())).toBeUndefined();
  expect(
    unsupportedSnapshot(
      running([human, fullOwner, toolResult('render', '{', true)])
    )
  ).toBe(false);
});
it('accepts an empty airline filter as the actual producer no-filter behavior', () => {
  const owner: Message = {
    id: 'airline-owner',
    role: 'assistant',
    toolCalls: [call('airlines', 'query_flights_by_airline', { airlines: [] })],
  };
  const data = [
    { airline: 'American', count: 87 },
    { airline: 'United', count: 92 },
    { airline: 'Delta', count: 78 },
    { airline: 'JetBlue', count: 55 },
  ];
  const transcript = [human, owner, toolResult('airlines', data), answer];
  expect(confirmTranscript(completed(transcript), turn())).toBe(transcript);
});
it.each(
  [
    [human, fullOwner, toolResult('render', 'rendered', true), answer],
    [
      human,
      fullOwner,
      toolResult('data', metric),
      toolResult('render', 'wrong', true),
      answer,
    ],
    [
      human,
      fullOwner,
      toolResult('render', 'rendered', true),
      toolResult('data', {}),
      answer,
    ],
    [
      human,
      { ...fullOwner, content: '{"root":"wrong"}' },
      toolResult('render', 'rendered', true),
      toolResult('data', metric),
      answer,
    ],
    [
      human,
      { ...fullOwner, toolCalls: [call('unknown', 'unknown_tool', {})] },
      toolResult('unknown', {}),
      answer,
    ],
    [human, toolResult('orphan', {}), answer],
    [
      human,
      fullOwner,
      toolResult('render', 'rendered', true),
      toolResult('render', 'rendered', true),
      answer,
    ],
  ].map((transcript) => [transcript])
)(
  'requires New for incomplete or unsupported finalized tool history %#',
  (transcript) => {
    expect(confirmTranscript(completed(transcript), turn())).toBeUndefined();
  }
);
it.each(['thread', 'run'])(
  'binds completion to the actual current %s',
  (field) => {
    const snapshot = completed();
    const terminal = {
      type: E.RUN_FINISHED as const,
      threadId: field === 'thread' ? 'other' : 'thread',
      runId: field === 'run' ? 'other' : 'run',
    };
    expect(
      confirmTranscript(
        { ...snapshot, run: { id: 'run', outcome: 'success', terminal } },
        turn()
      )
    ).toBeUndefined();
  }
);
it('rejects stale prefixes, malformed state, child outcomes and revoked reads', () => {
  expect(
    confirmTranscript(completed(), { ...turn(), prefix: [answer] })
  ).toBeUndefined();
  expect(
    selectDashboard(
      { ...completed(), state: { on_time: { value: 4, delta: false } } },
      turn()
    )
  ).toBeUndefined();
  expect(
    unsupportedSnapshot({
      ...running(),
      subagents: [
        {
          started: {
            type: E.SUBAGENT_STARTED,
            subagentRunId: 'child',
            name: 'child',
          },
        },
      ],
    })
  ).toBe(true);
  expect(
    captureTurn(running(), 'thread', undefined, [], () => false)
  ).toBeUndefined();
  expect(confirmTranscript(completed(), turn(), () => false)).toBeUndefined();
});
