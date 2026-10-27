import { createSession } from '@threadplane/langgraph';
import { createA2uiSurfaces } from '@threadplane/content/a2ui';
import { createMarkdown } from '@threadplane/content/markdown';
import type { A2uiMessage } from '@threadplane/a2ui';
import {
  applicationTools,
  type ApplicationToolCall,
} from '../../shared/trip-summary.js';
import type { ApplicationSession } from '../../shared/application.js';
import type { Message } from '@threadplane/core';

// Private composition fixture: the real runtime publishes accepted history and
// contains observer errors, while transport I/O stays deterministic and local.
export function applicationFixture() {
  let title = '<b>City</b>',
    rawTitle: string | undefined,
    fail = false,
    url = 'http://example.test/?thread=a';
  const counters = {
    owners: 0,
    applies: 0,
    disposals: 0,
    markdown: 0,
    markdownDisposals: 0,
    reads: 0,
    commands: 0,
  };
  const sessions: ApplicationSession[] = [];
  const message: Message = {
    id: 'answer',
    role: 'assistant',
    content: 'Answer',
    toolCallIds: ['trip'],
    delivery: { generation: 'answer', phase: 'complete', outcome: 'success' },
  };
  const complete = (): ApplicationToolCall => ({
    id: 'trip',
    name: 'show_trip_summary',
    status: 'complete',
    result: title,
    args: { title, days: [{ day: 1, places: ['<script>literal</script>'] }] },
  });
  let call = complete();
  function sessionFactory(id: string) {
    const session = createSession({
      tools: applicationTools,
      assistantId: 'assistant',
      threadId: id,
      transport: {
        async *stream() {
          counters.commands++;
        },
        async getHistory() {
          counters.reads++;
          return [
            {
              values: {
                messages: [
                  {
                    type: 'ai',
                    id: 'answer',
                    content: 'Answer',
                    tool_calls: [
                      {
                        id: 'trip',
                        name: 'show_trip_summary',
                        args: {
                          title,
                          days: [
                            { day: 1, places: ['<script>literal</script>'] },
                          ],
                        },
                      },
                    ],
                  },
                  {
                    type: 'tool',
                    id: 'result',
                    tool_call_id: 'trip',
                    content: title,
                  },
                ],
              },
              next: [],
              tasks: [],
              checkpoint: {
                thread_id: id,
                checkpoint_ns: '',
                checkpoint_id: `${title}-${counters.reads}`,
                checkpoint_map: {},
              },
              parent_checkpoint: null,
              metadata: { source: 'input', step: 0, parents: {} },
              created_at: '2026-09-28T00:00:00.000Z',
            },
          ];
        },
      },
    });
    // Seed an already accepted terminal result through the application's private
    // session seam. Real runtime publication still owns subscription/error
    // containment; restored provider history intentionally cannot author tools.
    const admitted = {
      ...session,
      getSnapshot: () => ({
        ...session.getSnapshot(),
        messages: [message],
        toolCalls: [call],
      }),
    };
    sessions.push(admitted);
    return admitted;
  }
  const markdownFactory: typeof createMarkdown = (document, options) => {
    counters.markdown++;
    const owner = createMarkdown(document, options);
    return {
      ...owner,
      dispose() {
        counters.markdownDisposals++;
        owner.dispose();
      },
    };
  };
  return {
    counters,
    sessions,
    title(value: string) {
      title = value;
      call = complete();
    },
    fail(value: boolean) {
      fail = value;
    },
    rawTitle(value: string) {
      rawTitle = value;
    },
    options: {
      assistantId: 'assistant',
      apiUrl: 'http://example.test/api',
      sessionFactory,
      markdownFactory,
      history: {
        currentUrl: () => url,
        push(next: string) {
          url = next;
        },
        subscribe: () => () => {},
      },
      directory: {
        async get(id: string) {
          return { kind: 'ready' as const, value: { id, title: id } };
        },
        async list() {
          return { kind: 'ready' as const, value: [] };
        },
        async create() {
          return { kind: 'failed' as const };
        },
      },
      a2ui: {
        ownerFactory() {
          counters.owners++;
          const raw = createA2uiSurfaces();
          return {
            getSnapshot: raw.getSnapshot,
            apply(message: A2uiMessage) {
              counters.applies++;
              if (fail) throw new Error('preparation failed');
              raw.apply(
                rawTitle !== undefined && 'updateComponents' in message
                  ? {
                      ...message,
                      updateComponents: {
                        ...message.updateComponents,
                        components: message.updateComponents.components.map(
                          (component) =>
                            component.id === 'root'
                              ? { ...component, title: rawTitle }
                              : component
                        ),
                      },
                    }
                  : message
              );
            },
            dispose() {
              counters.disposals++;
              raw.dispose();
            },
          };
        },
      },
    },
  };
}
