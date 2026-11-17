import {
  ChatSidenavSections,
  type ChatSidenavSectionsProps,
} from './index.js';

const props: ChatSidenavSectionsProps = {
  threads: [{ id: 'a', title: 'Alpha', pinned: true }],
  archivedThreads: [],
  projects: [{ id: 'p', name: 'Research' }],
  onThreadSelect: (threadId: string) => void threadId,
  onProjectSelect: (projectId: string) => void projectId,
  onNewChat: () => undefined,
  threadActions: { rename: async () => undefined },
  projectActions: { create: async () => undefined },
};
<ChatSidenavSections {...props} />;
<ChatSidenavSections />;
<ChatSidenavSections threads={null} archivedThreads={null} projects={null} />;
// @ts-expect-error Conversations are row records, not IDs.
<ChatSidenavSections threads={['a']} />;
// @ts-expect-error New chat receives no event.
<ChatSidenavSections onNewChat={(event: Event) => event} />;
// @ts-expect-error Props are readonly.
props.threads = [];
