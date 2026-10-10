// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspacePanel } from './workspace-panel';
import { ApprovalPanel } from './approval-panel';
import { approvalState } from './approval-state';
afterEach(cleanup);
const missing = { kind: 'missing', files: [] } as const;
it('files are literal, selection survives existing paths and falls back after removal', () => {
  const files = [
    {
      kind: 'text',
      path: '/notes/a',
      content: '<script>bad()</script> **literal**',
    },
    { kind: 'unavailable', path: '/reports/b', reason: 'Unsupported encoding' },
  ] as const;
  const view = render(
    <WorkspacePanel
      observed={{ kind: 'valid', files, complete: false }}
      saved={missing}
      phase="working"
      notice={null}
    />
  );
  expect(view.getByText('Live workspace')).toBeTruthy();
  expect(view.container.querySelector('script')).toBeNull();
  expect(view.getByText(files[0].content)).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: '/reports/b' }));
  expect(view.getByText('Unsupported encoding')).toBeTruthy();
  view.rerender(
    <WorkspacePanel
      observed={{ kind: 'valid', files: files.slice(1), complete: false }}
      saved={missing}
      phase="working"
      notice={null}
    />
  );
  expect(view.getByText('Unsupported encoding')).toBeTruthy();
  view.rerender(
    <WorkspacePanel
      observed={{ kind: 'valid', files: [files[0]], complete: true }}
      saved={missing}
      phase="working"
      notice={null}
    />
  );
  expect(view.getByText(files[0].content)).toBeTruthy();
  view.rerender(
    <WorkspacePanel
      observed={{ kind: 'valid', files, complete: false }}
      saved={missing}
      phase="working"
      notice={null}
    />
  );
  expect(view.getByText(files[0].content)).toBeTruthy();
});
it('duplicate actions stay separate and existing replacements are never ghosted or applied', () => {
  const batch = approvalState({
    id: 'pause',
    value: {
      action_requests: [0, 1].map(() => ({
        name: 'write_file',
        args: { file_path: '/reports/a', content: '<b>new</b>' },
        description: 'raw proposal',
      })),
      review_configs: [0, 1].map(() => ({
        action_name: 'write_file',
        allowed_decisions: ['approve', 'reject'],
      })),
    },
  });
  const decide = vi.fn();
  const view = render(
    <ApprovalPanel
      approval={batch}
      workspace={{
        kind: 'valid',
        files: [{ kind: 'text', path: '/reports/a', content: 'old' }],
        complete: true,
      }}
      busy={false}
      onDecision={decide}
    />
  );
  expect(view.getAllByText('Replacement proposal')).toHaveLength(2);
  expect(view.getAllByText('<b>new</b>')).toHaveLength(2);
  expect(view.container.querySelector('b')).toBeNull();
  fireEvent.click(view.getByRole('button', { name: 'Approve entire batch' }));
  expect(decide).toHaveBeenCalledWith('approve');
  expect(view.queryByRole('button', { name: 'Edit' })).toBeNull();
});
it('unsupported proposals show complete literal raw JSON and cannot resume', () => {
  const batch = approvalState({
    id: 'pause',
    value: {
      action_requests: [
        { name: 'evil', args: { x: '<img src=x>' }, description: 'x' },
      ],
      review_configs: [],
    },
  });
  const view = render(
    <ApprovalPanel
      approval={batch}
      workspace={missing}
      busy={false}
      onDecision={vi.fn()}
    />
  );
  expect(view.getByText(/Complete raw proposal/)).toBeTruthy();
  expect(view.container.textContent).toContain('<img src=x>');
  expect(view.container.querySelector('img')).toBeNull();
  expect(view.queryByRole('button')).toBeNull();
});

it('empty literal content stays empty, missing and malformed maps are explicitly distinct', () => {
  const view = render(
    <WorkspacePanel
      observed={missing}
      saved={{
        kind: 'valid',
        files: [{ path: '/empty', kind: 'text', content: '' }],
        complete: true,
      }}
      phase="saved"
      notice={null}
    />
  );
  expect(view.getByLabelText('Literal file content').textContent).toBe('');
  expect(view.getByText('Empty file')).toBeTruthy();
  view.rerender(
    <WorkspacePanel
      observed={missing}
      saved={missing}
      phase="idle"
      notice={null}
    />
  );
  expect(view.getByText(/No confirmed files map/)).toBeTruthy();
  expect(view.queryByText('The workspace is empty.')).toBeNull();
  view.rerender(
    <WorkspacePanel
      observed={{ kind: 'invalid', reason: 'Malformed map' }}
      saved={missing}
      phase="working"
      notice={null}
    />
  );
  expect(view.getByText('Files unavailable: Malformed map')).toBeTruthy();
  expect(view.queryByText('The workspace is empty.')).toBeNull();
});
