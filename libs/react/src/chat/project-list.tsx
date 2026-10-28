'use client';

export interface ProjectListItem {
  readonly id: string;
  readonly name: string;
}

export interface ProjectListProps {
  readonly projects: readonly ProjectListItem[];
  readonly onSelect: (projectId: string) => void;
  readonly activeProjectId?: string | null;
  readonly label?: string;
  readonly className?: string;
  readonly onNewProject?: () => void;
  readonly newProjectDisabled?: boolean;
  readonly newProjectLabel?: string;
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
}: ProjectListProps) {
  const list = (
    <ul
      className={`tp-project-list${className ? ` ${className}` : ''}`}
      aria-label={label}
    >
      {projects.map((project) => (
        <li key={project.id} className="tp-project-list__item">
          <button
            type="button"
            className="tp-project-list__button"
            title={project.name || project.id}
            aria-current={project.id === activeProjectId ? 'true' : undefined}
            onClick={() => onSelect(project.id)}
          >
            {project.name || project.id}
          </button>
        </li>
      ))}
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
