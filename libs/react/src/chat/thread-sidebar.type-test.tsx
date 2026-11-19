import type { ThreadDirectory } from '@threadplane/core';
import {
  ThreadSidebar,
  type ThreadSidebarFeatures,
  type ThreadSidebarProps,
} from './index.js';

declare const directory: ThreadDirectory;

const features: ThreadSidebarFeatures = { projects: false, pin: true };
const props: ThreadSidebarProps = {
  directory,
  onSelect: (threadId: string) => void threadId,
  onProjectSelect: (projectId: string | null) => void projectId,
  features,
  extraActions: [{ id: 'share', label: 'Share', run: async () => undefined }],
  labels: { empty: 'Nothing yet', retry: 'Try again' },
};
<ThreadSidebar {...props} />;
<ThreadSidebar directory={directory} onSelect={() => undefined} />;
// @ts-expect-error A directory is required.
<ThreadSidebar onSelect={() => undefined} />;
// @ts-expect-error Labels are the documented keys.
<ThreadSidebar {...props} labels={{ loading: 'Loading' }} />;
// @ts-expect-error Feature switches are booleans.
<ThreadSidebar {...props} features={{ projects: 'off' }} />;
// @ts-expect-error Props are readonly.
props.features = {};
// @ts-expect-error Feature switches are readonly.
features.pin = false;
