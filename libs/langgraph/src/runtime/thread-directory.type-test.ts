import type { ThreadDirectory, ThreadEntry } from '@threadplane/core';
import {
  createLangGraphThreadDirectory,
  type LangGraphThreadDirectory,
  type LangGraphThreadDirectoryOptions,
  type RuntimeOperationFailureReporter,
} from '../public-api';
import type { ProjectStore } from './project-store';

type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Expect<T extends true> = T;

declare const store: ProjectStore;
declare const maybeStore: ProjectStore | false;
declare const options: LangGraphThreadDirectoryOptions;
declare const report: RuntimeOperationFailureReporter;

/** The default options build every command, so no call needs `?.`. */
export async function everyCommand() {
  const directory = createLangGraphThreadDirectory({ apiUrl: '/api' });
  type Built = Expect<Same<typeof directory, LangGraphThreadDirectory>>;
  type Default = Expect<
    Same<LangGraphThreadDirectory, LangGraphThreadDirectory<true>>
  >;

  const found: ThreadEntry | null = await directory.get('a');
  await directory.get('a', { signal: new AbortController().signal });
  const rank: number | undefined = found
    ? directory.pinnedOrderOf(found)
    : undefined;
  const created: { readonly id: string } = await directory.create();
  await directory.create({ metadata: { source: 'test' } });
  await directory.rename('a', 'Title');
  await directory.remove('a');
  await directory.setArchived('a', true);
  await directory.setPinned('a', true);
  await directory.reorderPinned('a', null);
  await directory.setProject('a', 'p');
  const project: { readonly id: string } = await directory.createProject('P');
  await directory.renameProject('p', 'Q');
  await directory.removeProject('p');

  // @ts-expect-error A thread id is text.
  void directory.get(1);
  // @ts-expect-error A title is required to rename.
  void directory.rename('a');
  // @ts-expect-error Metadata is plain data.
  void directory.create({ metadata: { when: new Date() } });
  // @ts-expect-error The rank is asked for an entry, not an id.
  directory.pinnedOrderOf('a');
  // @ts-expect-error An entry carries no rank of its own.
  void found?.pinnedOrder;

  // It is still a core directory, wherever one is taken.
  const core: ThreadDirectory = directory;
  // @ts-expect-error The core contract does not guarantee get.
  void core.get('a');
  void core.get?.('a');
  void [rank, created, project];
  return {} as [Built, Default];
}

/** A supplied project store builds the project commands too. */
export function suppliedStore() {
  const directory = createLangGraphThreadDirectory({
    apiUrl: '/api',
    projects: store,
  });
  type Built = Expect<Same<typeof directory, LangGraphThreadDirectory>>;
  void directory.createProject('P');
  return {} as Built;
}

/** `projects: false` builds no project command; the rest stay present. */
export function projectsOff() {
  const directory = createLangGraphThreadDirectory({
    apiUrl: '/api',
    projects: false,
  });
  type Built = Expect<Same<typeof directory, LangGraphThreadDirectory<false>>>;
  type Absent = Expect<Same<typeof directory.createProject, undefined>>;
  void directory.rename('a', 'Title');
  void directory.get('a');
  // @ts-expect-error There is no project command to call.
  void directory.createProject('P');
  // @ts-expect-error There is no project command to call.
  void directory.removeProject('p');
  const core: ThreadDirectory = directory;
  void core;
  return {} as [Built, Absent];
}

/** Options not known until run time leave the project commands optional. */
export function unknownProjects() {
  const fromUnion = createLangGraphThreadDirectory({
    apiUrl: '/api',
    projects: maybeStore,
  });
  const fromOptions = createLangGraphThreadDirectory(options);
  type Union = Expect<
    Same<typeof fromUnion, LangGraphThreadDirectory<boolean>>
  >;
  type Options = Expect<
    Same<typeof fromOptions, LangGraphThreadDirectory<boolean>>
  >;
  void fromUnion.rename('a', 'Title');
  // @ts-expect-error The project commands may be absent.
  void fromUnion.createProject('P');
  void fromUnion.createProject?.('P');
  void fromOptions.renameProject?.('p', 'Q');
  return {} as [Union, Options];
}

/** The reporter option takes the package's reporter type. */
export function reporter() {
  createLangGraphThreadDirectory({
    apiUrl: '/api',
    reportOperationFailure: report,
  });
  createLangGraphThreadDirectory({
    apiUrl: '/api',
    reportOperationFailure: (code) => {
      const exact: Expect<
        Same<typeof code, 'unauthorized' | 'network_blocked'>
      > = true;
      void [code, exact];
    },
  });
  createLangGraphThreadDirectory({
    apiUrl: '/api',
    // @ts-expect-error A reporter is a function.
    reportOperationFailure: 'unauthorized',
  });
}
