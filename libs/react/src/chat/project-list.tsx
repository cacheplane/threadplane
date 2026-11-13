'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog } from './confirm-dialog.js';
import { OverflowMenu, type OverflowMenuItem } from './overflow-menu.js';
import { ProjectNameForm } from './project-name-form.js';
import {
  neighborId,
  useOptimisticRows,
  useRowFocus,
  type RowActionResult,
} from './internal/optimistic-rows.js';

/** Project selection row identified by ID and displayed by name, falling back to the ID for an empty name. */
export interface ProjectListItem {
  readonly id: string;
  readonly name: string;
}

/**
 * Project commands the application implements. Supplying a command adds its
 * built-in control. The list shows the result at once and calls the command;
 * the application then updates `projects`. A rejected command puts the row
 * back as supplied.
 */
export interface ProjectActionAdapter {
  /** Called with the trimmed, nonblank name typed into the built-in new-project editor. */
  readonly create?: (name: string) => RowActionResult;
  /** Called with the trimmed, nonblank name; the row shows it while it runs. */
  readonly rename?: (projectId: string, name: string) => RowActionResult;
  /** Called after the person confirms; the row is hidden while it runs. */
  readonly delete?: (projectId: string) => RowActionResult;
}

/** Supplies ordered projects, controlled selection, optional creation intent, and per-project action content. */
export interface ProjectListProps {
  readonly projects: readonly ProjectListItem[];
  readonly onSelect: (projectId: string) => void;
  readonly activeProjectId?: string | null;
  readonly label?: string;
  readonly className?: string;
  readonly onNewProject?: () => void;
  readonly newProjectDisabled?: boolean;
  readonly newProjectLabel?: string;
  readonly renderActions?: (project: ProjectListItem) => ReactNode;
  /**
   * Adds a built-in menu to each row with the commands supplied here, inline
   * rename, and a confirmation before delete. A `create` command adds the new
   * project button with an inline name editor.
   */
  readonly actions?: ProjectActionAdapter | null;
}

/** Controlled project selection; the application owns catalog and lifecycle. */
export function ProjectList({
  projects,
  onSelect,
  activeProjectId,
  label = 'Projects',
  className,
  onNewProject,
  newProjectDisabled = false,
  newProjectLabel = '+ New project',
  renderActions,
  actions: adapter,
}: ProjectListProps) {
  const root = useRef<HTMLUListElement>(null);
  const create = useRef<HTMLButtonElement>(null);
  const optimistic = useOptimisticRows();
  const focusRow = useRowFocus(root, 'tp-project-list__button');
  const [menu, setMenu] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    readonly id: string;
    readonly value: string;
  } | null>(null);
  const [confirming, setConfirming] = useState<{
    readonly id: string;
    readonly returnTo: HTMLElement | null;
  } | null>(null);

  const visible =
    optimistic.hidden.size > 0
      ? projects.filter((project) => !optimistic.hidden.has(project.id))
      : projects;
  const items: OverflowMenuItem[] = [];
  if (adapter?.rename) items.push({ id: 'rename', label: 'Rename' });
  if (adapter?.delete)
    items.push({ id: 'delete', label: 'Delete', tone: 'destructive' });
  const closeEditor = (id: string) => {
    setEditing(null);
    focusRow({ id, part: 'menu' });
  };
  const [creatorClosed, setCreatorClosed] = useState(0);
  const closeCreator = () => {
    setCreating(null);
    setCreatorClosed((count) => count + 1);
  };
  useEffect(() => {
    // The editor held focus; hand it back to the button that opened it.
    const button = create.current;
    const doc = button?.ownerDocument;
    if (creatorClosed && button && doc && doc.activeElement === doc.body)
      button.focus();
  }, [creatorClosed]);

  const list = (
    <ul
      ref={root}
      className={`tp-project-list${className ? ` ${className}` : ''}`}
      aria-label={label}
    >
      {creating !== null && (
        <li className="tp-project-list__item tp-project-list__item--editing">
          <ProjectNameForm
            label="New project name"
            submitLabel="Create"
            value={creating}
            onValueChange={setCreating}
            onCancel={closeCreator}
            onSubmit={() => {
              const name = creating.trim();
              const run = adapter?.create;
              closeCreator();
              if (name && run) void optimistic.settle(() => run(name));
            }}
          />
        </li>
      )}
      {visible.map((supplied) => {
        const pendingName = optimistic.names.get(supplied.id);
        const project =
          pendingName === undefined
            ? supplied
            : { ...supplied, name: pendingName };
        if (editing?.id === project.id) {
          return (
            <li
              key={project.id}
              data-row-id={project.id}
              className="tp-project-list__item tp-project-list__item--editing"
            >
              <ProjectNameForm
                value={editing.value}
                onValueChange={(value) => setEditing({ id: project.id, value })}
                onCancel={() => closeEditor(project.id)}
                onSubmit={() => {
                  const next = editing.value.trim();
                  const run = adapter?.rename;
                  closeEditor(project.id);
                  if (next && run && next !== project.name)
                    void optimistic.rename(project.id, next, () =>
                      run(project.id, next)
                    );
                }}
              />
            </li>
          );
        }
        const name = project.name || project.id;
        const ownerActions = renderActions?.(project);
        const builtIn = items.length > 0 && (
          <OverflowMenu
            label={`More actions for ${name}`}
            items={items}
            open={menu === project.id}
            onOpenChange={(open) =>
              setMenu((current) =>
                open ? project.id : current === project.id ? null : current
              )
            }
            onSelect={(itemId) => {
              if (itemId === 'rename')
                setEditing({ id: project.id, value: project.name });
              else if (itemId === 'delete')
                setConfirming({
                  id: project.id,
                  returnTo:
                    Array.from(root.current?.children ?? [])
                      .find(
                        (row) =>
                          (row as HTMLElement).dataset['rowId'] === project.id
                      )
                      ?.querySelector<HTMLElement>(
                        '.tp-overflow-menu__trigger'
                      ) ?? null,
                });
            }}
          />
        );
        const actions =
          builtIn &&
          ownerActions !== null &&
          ownerActions !== false &&
          ownerActions !== undefined ? (
            <>
              {ownerActions}
              {builtIn}
            </>
          ) : (
            builtIn || ownerActions
          );
        const hasActions =
          actions !== null && actions !== false && actions !== undefined;
        return (
          <li
            key={project.id}
            data-row-id={project.id}
            className={`tp-project-list__item${
              hasActions ? ' tp-project-list__item--actions' : ''
            }`}
          >
            <button
              type="button"
              className="tp-project-list__button"
              title={name}
              aria-current={project.id === activeProjectId ? 'true' : undefined}
              onClick={() => onSelect(project.id)}
            >
              {name}
            </button>
            {hasActions && (
              <div className="tp-project-list__actions">{actions}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
  const view =
    onNewProject || adapter?.create ? (
      <div className="tp-project-list__container">
        <button
          ref={create}
          type="button"
          className="tp-project-list__new"
          disabled={newProjectDisabled}
          onClick={() => {
            if (adapter?.create) setCreating('');
            onNewProject?.();
          }}
        >
          {newProjectLabel}
        </button>
        {list}
      </div>
    ) : (
      list
    );
  if (!adapter?.delete) return view;
  return (
    <>
      {view}
      <ConfirmDialog
        open={confirming !== null}
        title="Delete project?"
        body="The project will be deleted. Its conversations remain and become unassigned."
        confirmLabel="Delete"
        tone="destructive"
        returnFocusTo={confirming?.returnTo}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const target = confirming;
          const run = adapter.delete;
          setConfirming(null);
          if (!target || !run) return;
          const next = neighborId(visible, target.id);
          if (next !== undefined) focusRow({ id: next, part: 'select' });
          void optimistic.hide(target.id, () => run(target.id));
        }}
      />
    </>
  );
}
