import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { AgentSnapshot } from '@threadplane/core';
import { SubagentCard } from '@threadplane/react/chat';
import { createConnectedApplication } from './connection';
vi.mock('./connection', () => ({ createConnectedApplication: vi.fn() }));
import { SubagentsDemo, subagentCards } from './app';
import type { ToolCard } from './projection';
afterEach(cleanup);
it('readiness is inert; a welcome suggestion sends through the application and New stays available', async () => {
  const state = {
    rows: [],
    messages: [],
    toolCalls: [],
    observations: new Map(),
    taskCount: 0,
    childObservations: [],
    activity: 'idle',
    busy: false,
    canSubmit: true,
    outcome: null,
    error: null,
    viewGeneration: 0,
  };
  const idle: AgentSnapshot = { status: 'idle', messages: [], toolCalls: [] };
  const app = {
    getSnapshot: () => state,
    subscribe: () => () => undefined,
    submit: vi.fn(async () => undefined),
    newConversation: vi.fn(),
    dispose: vi.fn(),
    agent: {
      getSnapshot: () => idle,
      subscribe: () => () => undefined,
      submit: vi.fn(async () => 'success' as const),
      stop: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    },
  };
  vi.mocked(createConnectedApplication).mockReturnValue(app as never);
  const ready = vi.fn(),
    v = render(
      <SubagentsDemo
        connection={{ apiUrl: '/api', headers: {} }}
        onReady={ready}
      />
    );
  expect(ready).toHaveBeenCalledTimes(1);
  expect(app.submit).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(v.getByRole('button', { name: 'Field data for KSFO' }));
  });
  expect(app.submit).toHaveBeenCalledWith('What is the field data for KSFO?');
  fireEvent.click(v.getByRole('button', { name: 'New conversation' }));
  expect(app.newConversation).toHaveBeenCalledOnce();
});
it('task dispatches become subagent cards; unknown fields and errors stay visible and literal text cannot execute', () => {
  const card = (patch: Partial<ToolCard>): ToolCard => ({
    id: 't',
    name: 'task',
    kind: 'task',
    fields: 'available',
    argumentsText: '{}',
    status: 'complete',
    ...patch,
  });
  const cards = subagentCards(
    new Map([
      [
        'a',
        [
          card({
            id: 'failed',
            fields: 'unavailable',
            argumentsText: '<img src=x onerror=alert(1)>',
            resultText: '<img src=x onerror=alert(1)>',
            resultStatus: 'error',
          }),
          card({ id: 'lookup', name: 'lookup_field_elevation', kind: 'tool' }),
          card({
            id: 'done',
            subagentType: 'field-researcher',
            description: 'KSFO field data',
            resultText: 'KSFO elevation 13 ft',
          }),
          card({ id: 'held', status: 'running' }),
        ],
      ],
    ])
  );
  // Only task dispatches become cards, each in place of its own call.
  expect(cards.map((c) => [c.id, c.toolCallId, c.status])).toEqual([
    ['failed', 'failed', 'error'],
    ['done', 'done', 'complete'],
    ['held', 'held', 'running'],
  ]);
  expect(cards[0].description).toBe('Task fields unavailable');
  expect(cards[0].errorSummary).toBe('The specialist returned an error.');
  expect(cards[1].name).toBe('field-researcher');
  expect(cards[1].messages).toEqual([
    { id: 'done:result', text: 'KSFO elevation 13 ft' },
  ]);
  expect(cards[2].messages).toEqual([]);
  const v = render(<SubagentCard subagent={cards[0]} />);
  expect(v.getByText('Task fields unavailable')).toBeTruthy();
  expect(v.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
  expect(v.container.querySelector('img')).toBeNull();
});
