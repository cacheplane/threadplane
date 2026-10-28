import {
  ProjectList,
  type ProjectListItem,
  type ProjectListProps,
} from './index';
const project: ProjectListItem = { id: 'a', name: 'Alpha' };
const projects: readonly ProjectListItem[] = [project];
const props: ProjectListProps = {
  projects,
  onSelect: (id) => {
    const exact: string = id;
    void exact;
  },
};
<ProjectList
  {...props}
  activeProjectId={null}
  label="Loaded projects"
  className="owner"
  onNewProject={() => undefined}
  newProjectDisabled
  newProjectLabel="Create"
/>;
// @ts-expect-error IDs are readonly.
project.id = 'b';
// @ts-expect-error Names are readonly.
project.name = 'Beta';
// @ts-expect-error Collections are readonly.
projects.push(project);
// @ts-expect-error Props are readonly.
props.projects = [];
// @ts-expect-error Selection is required.
<ProjectList projects={projects} />;
// @ts-expect-error Catalog is required.
<ProjectList onSelect={() => undefined} />;
<ProjectList
  // @ts-expect-error Names are plain text.
  projects={[{ id: 'a', name: <b>Alpha</b> }]}
  onSelect={() => undefined}
/>;
// @ts-expect-error IDs are strings.
<ProjectList {...props} activeProjectId={1} />;
// @ts-expect-error Selection receives a string ID.
<ProjectList {...props} onSelect={(id: number) => void id} />;
// @ts-expect-error New request receives no arguments.
<ProjectList {...props} onNewProject={(id: string) => void id} />;
// @ts-expect-error Disabled is boolean.
<ProjectList {...props} newProjectDisabled="yes" />;
