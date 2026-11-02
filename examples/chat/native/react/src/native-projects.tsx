import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ProjectList, ProjectNameForm } from '@threadplane/react/chat';
import type { ThreadRow } from '../../shared/contracts';
import {
  PROJECT_CATALOG_KEY,
  createProject,
  mergeProjects,
  readProjectCatalog,
  renameProject,
  removeProject,
  type NativeProject,
} from './project-catalog';

import {
  useProjectDeletion,
  type ProjectDeletionOwner,
} from './use-project-deletion';
import { NativeProjectActions } from './native-project-actions';

type Editor = {
  readonly id: string | null;
  readonly name: string;
  readonly invoker: HTMLButtonElement;
  readonly token: number;
};

/** Browser-local labels/catalog only; conversation associations stay backend-owned. */
export function NativeProjects({
  rows,
  projectId,
  onSelect,
  deletion,
}: {
  readonly deletion?: ProjectDeletionOwner;
  readonly rows: readonly ThreadRow[];
  readonly projectId: string | null;
  readonly onSelect: (id: string | null) => void;
}) {
  const [catalog, setCatalog] = useState<readonly NativeProject[]>([]);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [feedback, setFeedback] = useState('');
  const form = useRef<HTMLDivElement>(null);
  const newProject = useRef<HTMLButtonElement>(null);
  const allConversations = useRef<HTMLButtonElement>(null);
  const sequence = useRef(0);
  const current = useRef<Editor | null>(null);
  const reload = () => {
    try {
      setCatalog(readProjectCatalog(window.localStorage));
      setProblem(false);
      setError(undefined);
    } catch {
      setCatalog([]);
      setProblem(true);
    }
    setReady(true);
  };
  useEffect(() => {
    reload();
    const storage = (event: StorageEvent) => {
      try {
        if (
          event.storageArea === window.localStorage &&
          (event.key === null || event.key === PROJECT_CATALOG_KEY)
        )
          reload();
      } catch {
        setProblem(true);
      }
    };
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener('storage', storage);
      current.current = null;
    };
  }, []);
  const projects = mergeProjects(catalog, rows);
  const [menu, setMenu] = useState<{
    id: string;
    rows: typeof rows;
    catalog: typeof catalog;
    projectId: typeof projectId;
    deletion: typeof deletion;
  } | null>(null);
  const open = (
    id: string | null,
    name: string,
    invoker: HTMLButtonElement
  ) => {
    setValue(name);
    setError(undefined);
    setFeedback('');
    const request = { id, name, invoker, token: ++sequence.current };
    current.current = request;
    setEditor(request);
  };
  const close = (request: Editor) => {
    if (current.current !== request) return;
    const container = form.current;
    const doc = request.invoker.ownerDocument;
    const owned = !!container?.contains(doc.activeElement);
    current.current = null;
    setEditor(null);
    setError(undefined);
    if (owned)
      queueMicrotask(() => {
        if (
          request.invoker.isConnected &&
          (doc.activeElement === doc.body ||
            container?.contains(doc.activeElement))
        )
          request.invoker.focus({ preventScroll: true });
      });
  };
  const projectDeletion = useProjectDeletion({
    owner: deletion,
    fallbackFocusTo: () => allConversations.current ?? newProject.current,
    selectedId: projectId,
    onSelect,
    onRemoved(id) {
      const next = removeProject(window.localStorage, id);
      setCatalog(next);
      const active = current.current;
      if (active?.id === id) close(active);
    },
  });
  const blocked = !ready || problem || projectDeletion.busy;
  const activeMenu =
    menu &&
    !blocked &&
    menu.rows === rows &&
    menu.catalog === catalog &&
    menu.projectId === projectId &&
    menu.deletion === deletion &&
    projects.some((project) => project.id === menu.id)
      ? menu
      : null;
  useLayoutEffect(() => {
    if (menu && !activeMenu) setMenu(null);
  }, [menu, activeMenu]);
  const liveMenu = useRef({ activeMenu, blocked, projects, deletion });
  liveMenu.current = { activeMenu, blocked, projects, deletion };
  const save = (request: Editor) => {
    if (
      current.current !== request ||
      problem ||
      projectDeletion.busy ||
      !value.trim()
    )
      return;
    let id = request.id;
    if (id === null) {
      try {
        id = crypto.randomUUID();
      } catch {
        setError('Could not generate a project ID. Try saving again.');
        return;
      }
      if (projects.some((project) => project.id === id)) {
        setError('Generated project ID already exists. Try saving again.');
        return;
      }
    }
    try {
      const next =
        request.id === null
          ? createProject(window.localStorage, id, value)
          : renameProject(window.localStorage, id, value);
      setCatalog(next);
      setFeedback(
        request.id === null
          ? 'Project created in this browser.'
          : 'Project name saved in this browser.'
      );
      close(request);
      if (request.id === null) onSelect(id);
    } catch {
      setProblem(true);
      setError(
        'Could not save this project. Your name is kept. Retry project storage, then save again.'
      );
    }
  };
  const show = projects.length > 0 || projectId !== null || editor !== null;
  return (
    <>
      <button
        type="button"
        ref={newProject}
        disabled={!ready || problem || projectDeletion.busy}
        onClick={(event) => open(null, '', event.currentTarget)}
      >
        New project
      </button>
      {problem && (
        <div>
          <p role="alert">
            Project storage is unavailable or invalid. Saved data has not been
            overwritten.
          </p>
          <button type="button" onClick={reload}>
            Retry project storage
          </button>
        </div>
      )}
      {show && (
        <section
          className="native-projects"
          aria-labelledby="native-projects-title"
        >
          <h3 id="native-projects-title">Projects</h3>
          <p className="muted">
            Project names are saved only in this browser. Loaded project IDs
            include archived conversations. New conversations use the selected
            project.
          </p>
          <button
            type="button"
            ref={allConversations}
            aria-pressed={projectId === null}
            onClick={() => onSelect(null)}
          >
            All conversations
          </button>
          <ProjectList
            projects={projects}
            activeProjectId={projectId}
            onSelect={onSelect}
            label="Projects"
            renderActions={(project) => (
              <NativeProjectActions
                project={project}
                disabled={blocked}
                open={activeMenu?.id === project.id}
                canDelete={
                  deletion ? deletion.canDeleteProject(project.id) : undefined
                }
                onOpenChange={(next) => {
                  if (next) {
                    if (!liveMenu.current.blocked)
                      setMenu({
                        id: project.id,
                        rows,
                        catalog,
                        projectId,
                        deletion,
                      });
                  } else {
                    // A closing portal must not dismiss a newer row's menu.
                    const request =
                      activeMenu?.id === project.id ? activeMenu : null;
                    setMenu((current) =>
                      current === request ? null : current
                    );
                  }
                }}
                onAction={(action, invoker) => {
                  const latest = liveMenu.current;
                  if (
                    !activeMenu ||
                    latest.activeMenu !== activeMenu ||
                    activeMenu.id !== project.id ||
                    latest.blocked
                  )
                    return;
                  const target = latest.projects.find(
                    (item) => item.id === project.id
                  );
                  if (!target) return;
                  if (action === 'rename')
                    open(target.id, target.name, invoker);
                  else if (latest.deletion?.canDeleteProject(target.id))
                    projectDeletion.request(target, invoker);
                }}
              />
            )}
          />
          {editor && (
            <div ref={form}>
              <h4>
                {editor.id === null
                  ? 'Create project'
                  : `Rename project ${editor.name} (${editor.id})`}
              </h4>
              <ProjectNameForm
                key={editor.token}
                value={value}
                onValueChange={setValue}
                onSubmit={() => save(editor)}
                onCancel={() => close(editor)}
                error={error}
                submitDisabled={problem || projectDeletion.busy}
                submitLabel={editor.id === null ? 'Create' : 'Save'}
              />
            </div>
          )}
          {projectId !== null && (
            <p role="status">Selected project: {projectId}</p>
          )}
        </section>
      )}
      {projectDeletion.content}
      {feedback && <p role="status">{feedback}</p>}
    </>
  );
}
