import { expect, it } from 'vitest';
import { projectAgentSnapshot, projectClientToolViews } from './projection';
import type { NativeSnapshot } from './application';
const weather = {
  location: '<Paris>',
  temperatureF: 68,
  conditions: 'Sunny',
  humidity: 55,
  windMph: 8,
};
function native(): NativeSnapshot {
  return {
    status: 'idle',
    state: {},
    subagents: [],
    run: { id: 'r', outcome: 'success' },
    transcript: [
      {
        id: 'a',
        role: 'assistant',
        content: '<script>literal</script>',
        toolCalls: [
          {
            id: 'c',
            type: 'function',
            function: {
              name: 'weather_card',
              arguments: JSON.stringify(weather),
            },
          },
        ],
      },
    ],
    clientTools: {
      commandOutcome: 'success',
      calls: [
        {
          name: 'weather_card',
          callId: 'c',
          assistantMessageId: 'a',
          sourceRunId: 'r',
          rawArguments: JSON.stringify(weather),
          args: weather,
          result: { displayed: true },
          status: 'complete',
          delivery: 'unsent',
          provenance: 'local',
        },
      ],
    },
  };
}
it('projects literal native observation separately from admitted local execution and validated weather', () => {
  const state = native();
  const views = projectClientToolViews(state);
  expect(views[0].text?.content).toBe('<script>literal</script>');
  expect(views[0].tools[0]).toMatchObject({
    id: 'c',
    name: 'weather_card',
    argumentsText: JSON.stringify(weather),
    local: state.clientTools.calls[0],
    weather,
    sourceRunId: 'r',
  });
  expect(views[0].tools[0].resultText).toBeUndefined();
  expect(Object.isFrozen(views)).toBe(true);
  expect(Object.isFrozen(views[0].tools)).toBe(true);
});
it.each(['running', 'error', 'cancelled', 'pending'] as const)(
  'does not grant weather panels from %s local calls or raw args',
  (status) => {
    const state = native();
    const call = state.clientTools.calls[0];
    const changed: NativeSnapshot = {
      ...state,
      clientTools: { calls: [{ ...call, status }] },
    };
    expect(projectClientToolViews(changed)[0].tools[0].weather).toBeUndefined();
  }
);
it('does not grant panels to ambiguous, mismatched, child, unknown or conflicting calls', () => {
  const state = native();
  const call = state.clientTools.calls[0];
  expect(
    projectClientToolViews({
      ...state,
      clientTools: { calls: [call, call] },
    })[0].tools[0].weather
  ).toBeUndefined();
  expect(
    projectClientToolViews({
      ...state,
      clientTools: { calls: [{ ...call, assistantMessageId: 'other' }] },
    })[0].tools[0].weather
  ).toBeUndefined();
  expect(
    projectClientToolViews({
      ...state,
      transcript: [{ ...state.transcript[0], subagentRunId: 'child' }],
    })[0].tools[0].weather
  ).toBeUndefined();
  expect(
    projectClientToolViews({ ...state, clientTools: { calls: [] } })[0].tools[0]
      .weather
  ).toBeUndefined();
  expect(
    projectClientToolViews({
      ...state,
      clientTools: {
        calls: [call],
        blocker: { reason: 'conflict', sourceRunId: 'r', callIds: ['c'] },
      },
    })[0].tools[0].weather
  ).toBeUndefined();
});
it('revoked projection has no publication authority', () => {
  expect(projectClientToolViews(native(), () => false)).toEqual([]);
});

it('child native call and result remain literal protected observations without local authority', () => {
  const state = native();
  const child: NativeSnapshot = {
    ...state,
    transcript: [
      { ...state.transcript[0], subagentRunId: 'child' },
      {
        id: 'child-result',
        role: 'tool',
        subagentRunId: 'child',
        toolCallId: 'c',
        content: '<child result>',
      },
    ],
  };
  expect(projectClientToolViews(child)[0].tools[0]).toEqual({
    id: 'c',
    name: 'weather_card',
    argumentsText: JSON.stringify(weather),
    resultText: '<child result>',
  });
  expect(projectClientToolViews(child)[0].text).toBeUndefined();
});

it('projects the core view Chat observes: root messages, each call with its local status, and the plan', () => {
  const state = native();
  const plan = [{ label: 'Summarize the results', status: 'pending' as const }];
  const view = projectAgentSnapshot(
    {
      ...state,
      plan,
      transcript: [
        { id: 'u', role: 'user', content: 'Plan a trip' },
        ...state.transcript,
        { id: 'child', role: 'assistant', content: 'Child', subagentRunId: 's' } as never,
      ],
    },
    true,
    null
  );
  expect(view.status).toBe('running');
  expect(view.plan).toBe(plan);
  expect(view.messages.map((message) => [message.id, message.role])).toEqual([
    ['u', 'user'],
    ['a', 'assistant'],
  ]);
  expect(view.messages[1]).toMatchObject({
    content: '<script>literal</script>',
    toolCallIds: ['c'],
    delivery: { phase: 'complete', outcome: 'success' },
  });
  expect(view.toolCalls).toEqual([
    { id: 'c', name: 'weather_card', args: weather, status: 'complete', result: { displayed: true } },
  ]);
});
it('maps running, failed and unmatched calls, and gives the latest message the command outcome', () => {
  const state = native();
  const call = (status: 'running' | 'cancelled') => ({ ...state.clientTools.calls[0], status });
  const running = projectAgentSnapshot(
    { ...state, clientTools: { calls: [call('running')] } },
    true,
    null
  );
  expect(running.toolCalls[0]).toMatchObject({ status: 'running' });
  const stopped = projectAgentSnapshot(
    { ...state, clientTools: { calls: [call('cancelled')] } },
    false,
    'aborted'
  );
  expect(stopped.toolCalls[0]).toMatchObject({ status: 'error' });
  expect(stopped.messages.at(-1)?.delivery).toMatchObject({ phase: 'complete', outcome: 'aborted' });
  const unmatched = projectAgentSnapshot(
    {
      ...state,
      transcript: [...state.transcript, { id: 't', role: 'tool', toolCallId: 'c', content: '{"ok":true}' }],
      clientTools: { calls: [] },
    },
    false,
    'success'
  );
  expect(unmatched.toolCalls[0]).toMatchObject({ status: 'complete', result: { ok: true } });
  // The result rides on its call; the waiting assistant stays the latest row.
  expect(unmatched.messages.map((message) => message.role)).toEqual(['assistant']);
  expect(projectAgentSnapshot(undefined, false, null)).toEqual({ status: 'idle', messages: [], toolCalls: [] });
});
