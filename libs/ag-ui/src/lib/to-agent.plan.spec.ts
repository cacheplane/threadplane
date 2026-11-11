import { describe, expect, it } from 'vitest';
import { EventType, type BaseEvent } from '@ag-ui/client';
import { toAgent } from './to-agent';
import { FakeAgent } from './testing/fake-agent';

const scripted = (events: BaseEvent[]) => new FakeAgent({ delayMs: 0, script: [{ when: 'initial', events }] });

describe('toAgent plan', () => {
  it('exposes the todos list in agent state as the plan', async () => {
    const agent = toAgent(
      scripted([
        {
          type: EventType.STATE_SNAPSHOT,
          snapshot: { todos: [{ content: 'Read both drafts', status: 'completed' }, { content: 'Compare them', status: 'pending' }] },
        } as BaseEvent,
      ]),
    );
    expect(agent.plan?.()).toBeUndefined();
    await agent.submit({ message: 'compare the drafts' });
    expect(agent.plan?.()).toEqual([
      { label: 'Read both drafts', status: 'completed' },
      { label: 'Compare them', status: 'pending' },
    ]);
  });

  it('is undefined while the state holds no plan', async () => {
    const agent = toAgent(scripted([{ type: EventType.STATE_SNAPSHOT, snapshot: { searches: 1 } } as BaseEvent]));
    await agent.submit({ message: 'hi' });
    expect(agent.state()).toEqual({ searches: 1 });
    expect(agent.plan?.()).toBeUndefined();
  });
});
