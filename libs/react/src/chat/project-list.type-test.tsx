import type { ReactNode } from 'react';
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

<ProjectList
  {...props}
  renderActions={(item) => {
    const original: ProjectListItem = item;
    const node: ReactNode = <button>{original.name}</button>;
    // @ts-expect-error Callback receives the readonly item.
    item.id = 'other';
    return node;
  }}
/>;
<ProjectList {...props} renderActions={() => null} />;
<ProjectList {...props} renderActions={() => false} />;
<ProjectList {...props} renderActions={() => undefined} />;
<ProjectList {...props} renderActions={() => 'Rename'} />;
// @ts-expect-error Action slot is readonly.
props.renderActions = () => null;
// @ts-expect-error Action renderer receives an item, not an ID.
<ProjectList {...props} renderActions={(id: string) => id} />;
// @ts-expect-error Action renderer returns ReactNode.
<ProjectList {...props} renderActions={() => ({ command: 'rename' })} />;
