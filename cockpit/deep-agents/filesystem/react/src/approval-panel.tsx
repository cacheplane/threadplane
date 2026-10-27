import type { ApprovalState, Choice } from './approval-state';
import type { WorkspaceState } from './workspace-state';
export function ApprovalPanel({
  approval,
  workspace,
  busy,
  onDecision,
}: {
  approval: ApprovalState | null;
  workspace: WorkspaceState;
  busy: boolean;
  onDecision: (choice: Choice) => void;
}) {
  if (!approval) return null;
  if (approval.kind === 'unavailable')
    return (
      <section className="approval-panel" aria-label="Unavailable proposal">
        <h2>Proposal unavailable</h2>
        <p>{approval.reason}</p>
        {approval.rawProposal !== undefined && (
          <pre>{JSON.stringify(approval.rawProposal, null, 2)}</pre>
        )}
        <p>Start a new conversation to continue.</p>
      </section>
    );
  const paths = new Set(
    workspace.kind === 'valid' ? workspace.files.map((x) => x.path) : []
  );
  return (
    <section className="approval-panel" aria-label="Awaiting approval">
      <h2>
        Awaiting approval · {approval.actions.length} proposed{' '}
        {approval.actions.length === 1 ? 'action' : 'actions'}
      </h2>
      <p>
        Review the entire ordered batch. These are proposed arguments, not saved
        file changes.
      </p>
      <ol>
        {approval.actions.map((action, index) => {
          const path = String(action.args.file_path);
          return (
            <li key={index}>
              <h3>
                {action.name} · {path}
              </h3>
              {action.name === 'write_file' ? (
                <>
                  <p>
                    {paths.has(path)
                      ? 'Replacement proposal'
                      : 'New file proposal · not saved'}
                  </p>
                  <pre>{String(action.args.content)}</pre>
                </>
              ) : action.name === 'edit_file' ? (
                <>
                  <p>
                    Edit intent · replace_all:{' '}
                    {String(action.args.replace_all ?? false)}
                  </p>
                  <h4>Old text</h4>
                  <pre>{String(action.args.old_string)}</pre>
                  <h4>New text</h4>
                  <pre>{String(action.args.new_string)}</pre>
                </>
              ) : (
                <p>
                  Delete intent · {path === '/' ? 'root and descendants' : path}{' '}
                  (file or directory subtree)
                </p>
              )}
              <details>
                <summary>Raw proposal description</summary>
                <pre>{action.description}</pre>
              </details>
            </li>
          );
        })}
      </ol>
      <div className="decision-controls">
        {approval.choices.map((choice) => (
          <button
            type="button"
            key={choice}
            disabled={busy}
            onClick={() => onDecision(choice)}
          >
            {choice === 'approve'
              ? 'Approve entire batch'
              : 'Reject entire batch'}
          </button>
        ))}
      </div>
      {!approval.choices.length && (
        <p>
          No whole-batch Approve or Reject decision is permitted. Start a new
          conversation.
        </p>
      )}
    </section>
  );
}
