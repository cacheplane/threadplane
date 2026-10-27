import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { createMessageContent } from '@threadplane/content/messages';
import { createConnectedApplication } from './connection';
vi.mock('./connection', () => ({ createConnectedApplication: vi.fn() }));
import { SubagentsDemo, renderMessage } from './app';
afterEach(cleanup);
it('readiness and prompt selection never submit and New clears the draft', () => {
  const state = {
    rows: [],
    observations: new Map(),
    taskCount: 0,
    childObservations: [],
    busy: false,
    canSubmit: true,
    viewGeneration: 0,
  };
  const app = {
    getSnapshot: () => state,
    subscribe: () => () => undefined,
    submit: vi.fn(),
    newConversation: vi.fn(),
    dispose: vi.fn(),
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
  fireEvent.click(v.getByRole('button', { name: 'Field data for KSFO' }));
  expect((v.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
    'What is the field data for KSFO?'
  );
  expect(app.submit).not.toHaveBeenCalled();
  fireEvent.click(v.getByRole('button', { name: 'New conversation' }));
  expect((v.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
});
it('unknown task fields remain visibly unavailable and literal text cannot execute', () => {
  const content = createMessageContent();
  const rows = content.project({
    status: 'idle',
    toolCalls: [],
    messages: [
      {
        id: 'a',
        role: 'assistant',
        content: '',
        delivery: { generation: 'g', phase: 'complete', outcome: 'success' },
      },
    ],
  });
  const v = render(
    renderMessage(rows[0], [
      {
        id: 't',
        name: 'task',
        kind: 'task',
        fields: 'unavailable',
        argumentsText: '<img src=x onerror=alert(1)>',
        status: 'complete',
        resultText: 'literal',
        resultStatus: 'error',
      },
    ])
  );
  expect(v.getByText('Task fields unavailable')).toBeTruthy();
  expect(v.container.querySelector('img')).toBeNull();
  expect(v.getByRole('region', { name: 'Observed tool error' })).toBeTruthy();
  content.dispose();
});
