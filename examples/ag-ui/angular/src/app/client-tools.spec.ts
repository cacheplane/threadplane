import { describe, it, expect } from 'vitest';
import { createSession } from '@threadplane/ag-ui';
import { type } from '@threadplane/core';
import { withRunState, type ItineraryState } from './client-tools';

/** A session whose requests are captured instead of sent. */
function capturingSession() {
  const states: unknown[] = [];
  const session = createSession({
    url: 'http://itinerary.test/agent',
    stateType: type<ItineraryState>(),
    fetch: async (_input, init) => {
      states.push(JSON.parse(String(init?.body)).state);
      throw new TypeError('offline');
    },
  });
  return { session, states };
}

describe('withRunState', () => {
  it('sends the knobs as they are when each request is sent', async () => {
    const { session, states } = capturingSession();
    let knobs: ItineraryState = { model: 'gpt-5-mini', reasoning_effort: null, gen_ui_mode: 'a2ui' };
    const wrapped = withRunState(session, () => knobs);

    await wrapped.submit('plan a day in Paris');
    knobs = { model: 'gpt-5-nano', reasoning_effort: 'high', gen_ui_mode: 'json-render' };
    await wrapped.submit({ message: 'and another' });

    expect(states).toEqual([
      { model: 'gpt-5-mini', reasoning_effort: null, gen_ui_mode: 'a2ui' },
      { model: 'gpt-5-nano', reasoning_effort: 'high', gen_ui_mode: 'json-render' },
    ]);
    await session.dispose();
  });

  it('lets the knobs win over a state patch the caller supplied', async () => {
    const { session, states } = capturingSession();
    const wrapped = withRunState(session, () => ({ model: 'gpt-5-mini' }));

    await wrapped.submit({ message: 'hi', state: { model: 'other', gen_ui_mode: 'a2ui' } });

    expect(states).toEqual([{ model: 'gpt-5-mini', gen_ui_mode: 'a2ui' }]);
    await session.dispose();
  });
});
