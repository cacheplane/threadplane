import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMarkdown } from '@threadplane/content/markdown';
import { createSession } from '@threadplane/langgraph';
import { App } from '../react/src/app';
import { createApplication } from '../shared/application';
import { createThreadDirectory } from '../shared/directory';
import { browserHistory } from '../shared/route';
import '../shared/tokens.css';
import '../react/src/styles.css';

// This entry is compiled separately and never enters the production app.
const counts = {
  subscriptions: 0,
  releases: 0,
  active: 0,
  sessions: 0,
  sessionSubscriptions: 0,
  sessionReleases: 0,
  sessionActive: 0,
  sessionDisposals: 0,
  parsers: 0,
  updates: 0,
  parserDisposals: 0,
  ownerDisposals: 0,
};
const apiUrl = new URL('/api', location.origin).href;
const owner = createApplication({
  assistantId: 'assistant',
  apiUrl,
  directory: createThreadDirectory({
    apiBase: apiUrl,
    browserOrigin: location.origin,
  }),
  history: browserHistory(window),
  sessionFactory(id) {
    counts.sessions++;
    const session = createSession({
      assistantId: 'assistant',
      apiUrl,
      threadId: id,
      clientOptions: { maxRetries: 0 },
    });
    return {
      ...session,
      subscribe(notify) {
        counts.sessionSubscriptions++;
        counts.sessionActive++;
        const release = session.subscribe(notify);
        return () => {
          counts.sessionReleases++;
          counts.sessionActive--;
          release();
        };
      },
      dispose() {
        counts.sessionDisposals++;
        return session.dispose();
      },
    };
  },
  markdownFactory(document, options) {
    counts.parsers++;
    const parser = createMarkdown(document, options);
    return {
      ...parser,
      update(document) {
        counts.updates++;
        return parser.update(document);
      },
      dispose() {
        counts.parserDisposals++;
        parser.dispose();
      },
    };
  },
});
const application = {
  ...owner,
  subscribe(notify: () => void) {
    counts.subscriptions++;
    counts.active++;
    const release = owner.subscribe(notify);
    return () => {
      counts.releases++;
      counts.active--;
      release();
    };
  },
  dispose() {
    counts.ownerDisposals++;
    owner.dispose();
  },
};
const container = document.getElementById('root')!;
let root: Root | undefined;
const marks = new Map<string, ReturnType<typeof owner.getSnapshot>>();
const mount = () => {
  if (root) throw Error('Already mounted');
  root = createRoot(container);
  root.render(
    <StrictMode>
      <App application={application} />
    </StrictMode>
  );
};
Object.assign(window, {
  nativeViewProof: {
    mount,
    unmount() {
      root?.unmount();
      root = undefined;
    },
    dispose() {
      application.dispose();
    },
    mark(name: string) {
      marks.set(name, owner.getSnapshot());
    },
    inspect() {
      return {
        ...counts,
        texts: owner.getSnapshot().messages.map((row) => row.message.content),
      };
    },
    compare(name: string) {
      const before = marks.get(name)!,
        after = owner.getSnapshot();
      return {
        snapshot: before === after,
        markdown: before.messages.every(
          (row, index) => row.markdown === after.messages[index]?.markdown
        ),
        owner: application.getSnapshot === owner.getSnapshot,
      };
    },
  },
});
owner.start();
mount();
