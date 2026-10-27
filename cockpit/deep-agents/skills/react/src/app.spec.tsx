// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { createMessageContent } from '@threadplane/content/messages';
import { createConnectedApplication } from './connection';
vi.mock('./connection', () => ({ createConnectedApplication: vi.fn() }));
import { SkillsDemo, SkillPanels, renderMessage } from './app';
afterEach(cleanup);

it('places the conversation and native composer beside a Skills sidebar', () => {
  const state = {
    rows: [],
    index: { kind: 'absent' },
    reads: [],
    authority: { kind: 'unconfirmed' },
    busy: false,
    canSubmit: true,
    viewGeneration: 0,
    history: [],
    error: null,
    outcome: null,
  };
  vi.mocked(createConnectedApplication).mockReturnValue({
    getSnapshot: () => state,
    subscribe: () => () => undefined,
    dispose: vi.fn(),
  } as never);
  const v = render(
    <SkillsDemo
      connection={{ apiUrl: '/api', headers: {} }}
      onReady={() => undefined}
    />
  );
  const sidebar = v.getByRole('complementary', { name: 'Skills sidebar' });
  const workspace = sidebar.parentElement;
  if (!workspace) throw Error('Missing Skills workspace');
  const chat = v
    .getByRole('region', { name: 'Conversation' })
    .closest('.skills-chat');
  expect(workspace.classList.contains('skills-workspace')).toBe(true);
  expect(chat?.parentElement).toBe(workspace);
  expect(chat?.contains(v.getByRole('textbox'))).toBe(true);
  expect(
    sidebar.contains(v.getByRole('region', { name: 'Skills index' }))
  ).toBe(true);
  expect(
    sidebar.contains(v.getByRole('region', { name: 'Skill read observations' }))
  ).toBe(true);
});

it('readiness and suggestions are inert; New and history selection clear the draft', () => {
  const state = {
    rows: [],
    toolCalls: [],
    index: { kind: 'absent' },
    reads: [],
    authority: { kind: 'unconfirmed' },
    busy: false,
    canSubmit: true,
    viewGeneration: 0,
    activity: 'idle',
    history: [{ id: 'old', label: 'Previous conversation' }],
    error: null,
    outcome: null,
  };
  const app = {
    getSnapshot: () => state,
    subscribe: () => () => undefined,
    submit: vi.fn(),
    stop: vi.fn(),
    newConversation: vi.fn(),
    selectConversation: vi.fn(),
    dispose: vi.fn(),
  };
  vi.mocked(createConnectedApplication).mockReturnValue(app as never);
  const ready = vi.fn();
  const v = render(
    <SkillsDemo connection={{ apiUrl: '/api', headers: {} }} onReady={ready} />
  );
  expect(ready).toHaveBeenCalledTimes(1);
  fireEvent.click(v.getByRole('button', { name: 'Mid-size jet at KASE' }));
  expect((v.getByRole('textbox') as HTMLTextAreaElement).value).toContain(
    'KASE'
  );
  expect(app.submit).not.toHaveBeenCalled();
  fireEvent.change(v.getByRole('combobox', { name: 'Saved conversations' }), {
    target: { value: 'old' },
  });
  expect(app.selectConversation).toHaveBeenCalledWith('old');
  expect((v.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  fireEvent.click(v.getByRole('button', { name: 'Mid-size jet at KASE' }));
  fireEvent.click(v.getByRole('button', { name: 'New conversation' }));
  expect(app.newConversation).toHaveBeenCalledTimes(1);
  expect((v.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
});

it('labels observed and unknown read evidence honestly and renders virtual paths literally', () => {
  const v = render(
    <SkillPanels
      index={{
        kind: 'ready',
        source: 'observed-root',
        owner: 'o',
        generation: 'g',
        skills: [
          {
            name: 'runway-analysis',
            description: '<img src=x onerror=alert(1)>',
            path: '/skills/runway-analysis/SKILL.md',
          },
        ],
      }}
      reads={[
        {
          id: 'read',
          skillName: 'runway-analysis',
          path: '/skills/runway-analysis/SKILL.md',
          category: 'instruction',
          kind: 'unknown',
          result: '<script>bad()</script>',
        },
      ]}
    />
  );
  expect(v.getByText('Observed root values')).toBeTruthy();
  expect(v.getByText('Read status unknown')).toBeTruthy();
  expect(v.container.querySelector('script, img, a')).toBeNull();
  expect(v.getByText('<script>bad()</script>')).toBeTruthy();
});

it('keeps empty, absent and unavailable indexes distinct and partial reads explicit', () => {
  const v = render(
    <SkillPanels
      index={{
        kind: 'ready',
        source: 'checkpoint',
        owner: 'o',
        generation: 'g',
        skills: [],
      }}
      reads={[
        {
          id: 'r',
          skillName: 'runway-analysis',
          path: '/skills/runway-analysis/references/table.md',
          category: 'reference',
          kind: 'partial',
          result: '1  sample',
        },
      ]}
    />
  );
  expect(v.getByText('Confirmed checkpoint')).toBeTruthy();
  expect(v.getByText('The skills index is empty.')).toBeTruthy();
  expect(v.getByText('Partially inspected')).toBeTruthy();
  v.rerender(<SkillPanels index={{ kind: 'absent' }} reads={[]} />);
  expect(v.getByText('No skills index observed.')).toBeTruthy();
  v.rerender(
    <SkillPanels
      index={{ kind: 'unavailable' }}
      reads={{ kind: 'unavailable' }}
    />
  );
  expect(v.getByText('Skills index unavailable.')).toBeTruthy();
  expect(v.getByText('Read observations unavailable.')).toBeTruthy();
});

it('uses literal native tool observations without treating completed delivery as inspection', () => {
  const content = createMessageContent();
  const rows = content.project({
    status: 'idle',
    messages: [
      {
        id: 'a',
        role: 'assistant',
        content: '',
        toolCallIds: ['t'],
        delivery: { generation: 'g', phase: 'complete', outcome: 'success' },
      },
    ],
    toolCalls: [
      {
        id: 't',
        name: 'read_file',
        args: { file_path: '/skills/demo/SKILL.md' },
        status: 'complete',
        result: '<img src=x>',
      },
    ],
  });
  const v = render(renderMessage(rows[0]));
  expect(
    v.getByRole('region', { name: 'Observed tool delivery' })
  ).toBeTruthy();
  expect(v.getByText('Observed delivery: complete')).toBeTruthy();
  expect(v.container.querySelector('img')).toBeNull();
  content.dispose();
});

it('blocks unsafe replay after Stop and New only requests a fresh local conversation', () => {
  const state = {
    rows: [],
    toolCalls: [],
    index: { kind: 'absent' },
    reads: [],
    authority: { kind: 'unconfirmed' },
    busy: false,
    canSubmit: false,
    viewGeneration: 2,
    activity: 'idle',
    history: [],
    error: 'Response stopped.',
    outcome: 'aborted',
  };
  const app = {
    getSnapshot: () => state,
    subscribe: () => () => undefined,
    submit: vi.fn(),
    stop: vi.fn(),
    newConversation: vi.fn(),
    selectConversation: vi.fn(),
    dispose: vi.fn(),
  };
  vi.mocked(createConnectedApplication).mockReturnValue(app as never);
  const v = render(
    <SkillsDemo
      connection={{ apiUrl: '/api', headers: {} }}
      onReady={() => undefined}
    />
  );
  expect((v.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true);
  expect(
    (
      v.getByRole('button', {
        name: 'Mid-size jet at KASE',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  const form = v.getByRole('textbox').closest('form');
  if (!form) throw Error('Missing composer form');
  fireEvent.submit(form);
  expect(app.submit).not.toHaveBeenCalled();
  fireEvent.click(v.getByRole('button', { name: 'New conversation' }));
  expect(app.newConversation).toHaveBeenCalledTimes(1);
  expect(app.submit).not.toHaveBeenCalled();
});

it('shows raw confirmed tool error even when native delivery is complete', () => {
  const content = createMessageContent();
  const rows = content.project({
    status: 'idle',
    messages: [
      {
        id: 'a',
        role: 'assistant',
        content: '',
        toolCallIds: ['t'],
        delivery: { generation: 'g', phase: 'complete', outcome: 'success' },
      },
    ],
    toolCalls: [
      {
        id: 't',
        name: 'read_file',
        args: { file_path: '/skills/demo/SKILL.md' },
        status: 'complete',
        result: 'Tool failed',
      },
    ],
  });
  const v = render(
    renderMessage(rows[0], {
      kind: 'terminal',
      rawToolStatuses: { t: 'error' },
    } as never)
  );
  expect(v.getByText('Tool result: error')).toBeTruthy();
  expect(v.getByRole('region', { name: 'Observed tool error' })).toBeTruthy();
  content.dispose();
});
