export const PROJECT_CATALOG_KEY = 'threadplane-native-react-projects-v1';

export interface NativeProject {
  readonly id: string;
  readonly name: string;
}

type CatalogStorage = Pick<Storage, 'getItem' | 'setItem'>;

function nonblank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function capture(projects: readonly NativeProject[]): readonly NativeProject[] {
  return Object.freeze(
    projects.map(({ id, name }) => Object.freeze({ id, name }))
  );
}

/** Read without repairing or replacing unrecognized stored data. */
export function readProjectCatalog(
  storage: CatalogStorage
): readonly NativeProject[] {
  const bytes = storage.getItem(PROJECT_CATALOG_KEY);
  if (bytes === null) return capture([]);

  const value: unknown = JSON.parse(bytes);
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !('version' in value) ||
    value.version !== 1 ||
    !('projects' in value) ||
    !Array.isArray(value.projects)
  ) {
    throw new Error('Unsupported project catalog');
  }

  const ids = new Set<string>();
  const projects: NativeProject[] = [];
  for (const project of value.projects) {
    if (
      typeof project !== 'object' ||
      project === null ||
      Array.isArray(project) ||
      !nonblank(project.id) ||
      !nonblank(project.name) ||
      ids.has(project.id)
    ) {
      throw new Error('Invalid project catalog entry');
    }
    ids.add(project.id);
    projects.push({ id: project.id, name: project.name });
  }
  return capture(projects);
}

function projectInput(id: string, name: string): NativeProject {
  if (!nonblank(id)) throw new Error('Project ID is required');
  if (!nonblank(name)) throw new Error('Project name is required');
  return { id, name: name.trim() };
}

function persist(
  storage: CatalogStorage,
  projects: readonly NativeProject[]
): readonly NativeProject[] {
  storage.setItem(
    PROJECT_CATALOG_KEY,
    JSON.stringify({ version: 1, projects })
  );
  return capture(projects);
}

export function createProject(
  storage: CatalogStorage,
  id: string,
  name: string
): readonly NativeProject[] {
  const projects = readProjectCatalog(storage);
  const project = projectInput(id, name);
  if (projects.some((existing) => existing.id === id)) {
    throw new Error('Project ID already exists');
  }
  return persist(storage, [project, ...projects]);
}

/** Rename a catalog entry, or import an ID discovered in loaded rows. */
export function renameProject(
  storage: CatalogStorage,
  id: string,
  name: string
): readonly NativeProject[] {
  const projects = readProjectCatalog(storage);
  const project = projectInput(id, name);
  const exists = projects.some((existing) => existing.id === id);
  return persist(
    storage,
    exists
      ? projects.map((existing) => (existing.id === id ? project : existing))
      : [...projects, project]
  );
}

export function mergeProjects(
  catalog: readonly NativeProject[],
  loadedRows: readonly { projectId?: string }[]
): readonly NativeProject[] {
  const projects = [...catalog];
  const ids = new Set(catalog.map((project) => project.id));
  for (const { projectId } of loadedRows) {
    if (!nonblank(projectId) || ids.has(projectId)) continue;
    ids.add(projectId);
    projects.push({ id: projectId, name: projectId });
  }
  return capture(projects);
}
