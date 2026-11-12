import { expect, it } from 'vitest';
import { projectClientToolViews } from './projection';
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
