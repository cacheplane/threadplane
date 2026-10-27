// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { createConnectedApplication } from './connection';
vi.mock('./connection', () => ({ createConnectedApplication: vi.fn() }));
import { MemoryDemo, MemoryPanel, renderMessage } from './app';
import { createMessageContent } from '@threadplane/content/messages';
afterEach(cleanup);
function setup(overrides = {}) {
  const state = {
    rows: [],
    toolCalls: [],
    memory: { kind: 'none' },
    authority: { kind: 'unconfirmed' },
    busy: false,
    canSubmit: true,
    viewGeneration: 0,
    activity: 'idle',
    history: [{ id: 'known', label: 'Conversation 1' }],
    error: null,
    outcome: null,
    scopeWarning: null,
    ...overrides,
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
  const view = render(
    <MemoryDemo connection={{ apiUrl: '/api', headers: {} }} onReady={ready} />
  );
  return { ...view, app, state, ready };
}
it('uses native conversation/composer and a responsive literal Memory sidebar', () => {
  const v = setup();
  const sidebar = v.getByRole('complementary', { name: 'Memory sidebar' });
  expect(sidebar.parentElement?.className).toBe('memory-workspace');
  expect(
    v
      .getByRole('region', { name: 'Conversation' })
      .closest('.memory-chat')
      ?.contains(v.getByRole('textbox'))
  ).toBe(true);
  expect(v.getByText('no source yet')).toBeTruthy();
});
it('readiness, Teach and Recall fill only the draft; New/history clear it', () => {
  const v = setup();
  expect(v.ready).toHaveBeenCalledTimes(1);
  fireEvent.click(v.getByRole('button', { name: 'Teach' }));
  expect((v.getByRole('textbox') as HTMLTextAreaElement).value).toContain(
    'Citation CJ3'
  );
  expect(v.app.submit).not.toHaveBeenCalled();
  fireEvent.click(v.getByRole('button', { name: 'Recall' }));
  expect((v.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
    'What do you already know about my operation?'
  );
  fireEvent.change(v.getByRole('combobox'), { target: { value: 'known' } });
  expect(v.app.selectConversation).toHaveBeenCalledWith('known');
  expect((v.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  fireEvent.click(v.getByRole('button', { name: 'Teach' }));
  fireEvent.click(v.getByRole('button', { name: 'New conversation' }));
  expect(v.app.newConversation).toHaveBeenCalledTimes(1);
  expect((v.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  expect(v.app.submit).not.toHaveBeenCalled();
});
it('preserves exact blank lines, indentation, trailing newline and markup as text', () => {
  const contents = '  <img src=x>\n\n  indented\n';
  const v = render(
    <MemoryPanel
      memory={{
        kind: 'live',
        file: 'present',
        contents,
        scope: 'scope',
        generation: 'g',
        phase: 'terminal',
      }}
    />
  );
  expect(v.container.querySelector('pre')?.textContent).toBe(contents);
  expect(v.container.querySelector('img')).toBeNull();
  expect(v.getByText('/memories/AGENTS.md')).toBeTruthy();
  expect(v.getByText('store observed during this run')).toBeTruthy();
});
it.each([
  { kind: 'none', label: 'no source yet' },
  { kind: 'unavailable', label: 'memory observation unavailable' },
  {
    kind: 'checkpoint',
    file: 'missing',
    scope: 's',
    generation: 'g',
    checkpointId: 'cp',
    label: 'No memory file at this observation’s read time.',
  },
  {
    kind: 'checkpoint',
    file: 'present',
    contents: '',
    scope: 's',
    generation: 'g',
    checkpointId: 'cp',
    label: 'The memory file is present and empty.',
  },
])('distinguishes $kind/$file honestly', ({ label, ...memory }) => {
  const v = render(<MemoryPanel memory={memory as never} />);
  expect(v.getByText(label)).toBeTruthy();
});
it('blocked storage visibly disables authoring even with settled confirmation', () => {
  const v = setup({
    canSubmit: false,
    outcome: 'success',
    scopeWarning: 'Browser identity changed.',
    memory: {
      kind: 'checkpoint',
      file: 'present',
      contents: 'Observed',
      scope: 's',
      generation: 'g',
    },
  });
  expect(v.getByRole('alert').textContent).toContain(
    'Browser identity changed.'
  );
  expect((v.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true);
  expect(
    (v.getByRole('button', { name: 'Teach' }) as HTMLButtonElement).disabled
  ).toBe(true);
  expect(v.queryByText('Response saved.')).toBeNull();
});
it('successful transcript without Memory confirmation has no Saved status', () => {
  const v = setup({ outcome: 'success', memory: { kind: 'none' } });
  expect(v.queryByText('Response saved.')).toBeNull();
  expect(v.getByText('Ready.')).toBeTruthy();
});
it.each(['creating', 'running'])(
  'native composer cannot author during %s',
  (activity) => {
    const v = setup({ busy: true, canSubmit: false, activity });
    const form = v.getByRole('textbox').closest('form');
    if (!form) throw Error('Missing native composer');
    fireEvent.submit(form);
    expect(v.app.submit).not.toHaveBeenCalled();
    expect(
      (v.getByRole('button', { name: 'Teach' }) as HTMLButtonElement).disabled
    ).toBe(true);
  }
);
it('literal native write tool arguments/results remain complete and do not establish Memory', () => {
  const content = createMessageContent();
  const args = {
      file_path: '/memories/AGENTS.md',
      content: '  literal\n\n  trailing\n',
    },
    result = '<script>literal result</script>';
  const rows = content.project({
    status: 'idle',
    messages: [
      {
        id: 'assistant',
        role: 'assistant',
        content: '',
        toolCallIds: ['write'],
        delivery: { generation: 'g', phase: 'complete', outcome: 'success' },
      },
    ],
    toolCalls: [
      { id: 'write', name: 'write_file', args, result, status: 'complete' },
    ],
  });
  const v = render(renderMessage(rows[0]));
  const literal = [...v.container.querySelectorAll('pre')].map(
    (p) => p.textContent
  );
  expect(literal).toContain(JSON.stringify(args, null, 2));
  expect(literal).toContain(result);
  expect(v.container.querySelector('script')).toBeNull();
  expect(v.queryByText('Response saved.')).toBeNull();
  content.dispose();
});
