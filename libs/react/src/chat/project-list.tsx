'use client';
import type { ReactNode } from 'react';

/** Project selection row identified by ID and displayed by name, falling back to the ID for an empty name. */
export interface ProjectListItem {
  readonly id: string;
  readonly name: string;
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
}: ProjectListProps) {
  const list = (
    <ul
      className={`tp-project-list${className ? ` ${className}` : ''}`}
      aria-label={label}
    >
      {projects.map((project) => {
        const actions = renderActions?.(project);
        const hasActions =
          actions !== null && actions !== false && actions !== undefined;
        return (
          <li
            key={project.id}
            className={`tp-project-list__item${
              hasActions ? ' tp-project-list__item--actions' : ''
            }`}
          >
            <button
              type="button"
              className="tp-project-list__button"
              title={project.name || project.id}
              aria-current={project.id === activeProjectId ? 'true' : undefined}
              onClick={() => onSelect(project.id)}
            >
              {project.name || project.id}
            </button>
            {hasActions && (
              <div className="tp-project-list__actions">{actions}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
  return onNewProject ? (
    <div className="tp-project-list__container">
      <button
        type="button"
        className="tp-project-list__new"
        disabled={newProjectDisabled}
        onClick={() => onNewProject()}
      >
        {newProjectLabel}
      </button>
      {list}
    </div>
  ) : (
    list
  );
}
