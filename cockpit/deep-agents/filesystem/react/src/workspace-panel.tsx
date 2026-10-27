import { useEffect, useState } from 'react';
import { selectWorkspacePath, type WorkspaceState } from './workspace-state';
import type { FilesystemApplicationSnapshot } from './application';
type Props = {
  observed: WorkspaceState;
  saved: WorkspaceState;
  phase: FilesystemApplicationSnapshot['phase'];
  notice: string | null;
};
export function WorkspacePanel({ observed, saved, phase, notice }: Props) {
  const live = phase === 'working' || phase === 'confirming';
  const state = live ? observed : saved;
  const [selected, setSelected] = useState<string>();
  const path = selectWorkspacePath(state, selected);
  useEffect(() => {
    if (path !== selected) setSelected(path);
  }, [path, selected]);
  const files =
    state.kind === 'valid' || state.kind === 'missing' ? state.files : [];
  const file = files.find((x) => x.path === path);
  const groups = [
    ...new Set(
      files.map((x) => x.path.slice(0, x.path.lastIndexOf('/')) || '/')
    ),
  ];
  return (
    <section className="workspace-panel" aria-label="Workspace">
      <h2>
        {live
          ? 'Live workspace'
          : phase === 'paused'
          ? 'Paused · confirmed workspace'
          : phase === 'saved'
          ? 'Saved workspace'
          : 'Last confirmed workspace'}
      </h2>
      <p>
        {live
          ? 'Observed files while the response runs. Saved files are confirmed separately.'
          : phase === 'paused'
          ? 'These files come from the saved pause checkpoint. Proposed changes below have not run.'
          : 'Read-only file text from the last confirmed checkpoint.'}
      </p>
      {notice && <p role="status">{notice}</p>}
      {state.kind === 'valid' && !files.length && (
        <p>The workspace is empty.</p>
      )}
      {state.kind === 'missing' && (
        <p>No confirmed files map yet. Send a message to begin.</p>
      )}
      {state.kind === 'invalid' && (
        <p role="status">Files unavailable: {state.reason}</p>
      )}
      <div className="file-layout">
        <nav aria-label="Files">
          {groups.map((group) => (
            <div key={group}>
              <h3>{group}</h3>
              {files
                .filter(
                  (x) =>
                    (x.path.slice(0, x.path.lastIndexOf('/')) || '/') === group
                )
                .map((x) => (
                  <button
                    type="button"
                    key={x.path}
                    aria-pressed={x.path === path}
                    onClick={() => setSelected(x.path)}
                  >
                    {x.path}
                  </button>
                ))}
            </div>
          ))}
        </nav>
        {file && (
          <article aria-label="File preview">
            <h3>{file.path}</h3>
            {file.kind === 'text' ? (
              <>
                <pre tabIndex={0} aria-label="Literal file content">
                  {file.content}
                </pre>
                {file.content === '' && <p>Empty file</p>}
              </>
            ) : (
              <p role="status">{file.reason}</p>
            )}
          </article>
        )}
      </div>
    </section>
  );
}
