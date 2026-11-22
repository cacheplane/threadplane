import { HighlightedCode } from '../HighlightedCode';

const SNIPPET_1 = `// app.config.ts
import { provideAgent } from '@threadplane/angular';
import { createSession } from '@threadplane/langgraph';

providers: [
  provideAgent({
    createSession: async (context) =>
      createSession({
        assistantId: 'my-agent',
        apiUrl: 'https://my-langgraph.cloud',
        threadId: context.threadId,
        onThreadId: context.onThreadId,
      }),
  }),
];

// component
import { injectAgent } from '@threadplane/angular';
const chat = injectAgent();

// Reactive signals — OnPush compatible
chat.messages();    // Signal<readonly Message[]>
chat.status();      // Signal<'idle' | 'running' | 'error'>
chat.interrupts();  // Signal<readonly AgentInterrupt[] | undefined>`;

const SNIPPET_2 = `// app.config.ts
import { provideAgent } from '@threadplane/angular';
import { createSession, MockAgentTransport } from '@threadplane/langgraph';

providers: [
  provideAgent({
    threadId: savedThreadId,
    onThreadId: (id) => localStorage.setItem('threadId', id),
    createSession: async (context) =>
      createSession({
        apiUrl: environment.langgraphUrl,
        assistantId: 'my-agent',
        threadId: context.threadId,
        onThreadId: context.onThreadId,
        // Omit transport to use the default HTTP and SSE transport.
        transport: isTest ? new MockAgentTransport(fixtures) : undefined,
      }),
  }),
];

// component
import { injectAgent } from '@threadplane/angular';
const chat = injectAgent();`;

const SNIPPETS = [
  { title: 'Minimal Setup', code: SNIPPET_1, lang: 'typescript' },
  { title: 'Full Configuration', code: SNIPPET_2, lang: 'typescript' },
];

export async function LangGraphCodeShowcase({
  showIntroduction = true,
}: { showIntroduction?: boolean } = {}) {
  return (
    <section
      className={showIntroduction ? 'angular-code' : 'library-compact-code'}
    >
      {showIntroduction && (
        <div className="lg-show-intro">
          <div className="show-intro-rail">
            <p className="lg-show-eyebrow">Developer Experience</p>
            <span className="show-intro-rail-line" aria-hidden="true" />
          </div>
          <h2 className="lg-show-heading">
            Production streaming in a few lines
          </h2>
        </div>
      )}

      <div className="lg-show-grid">
        {SNIPPETS.map((s) => (
          <div key={s.title} className="lg-show-card">
            <div className="lg-show-card-head">
              <span className="lg-show-card-title">{s.title}</span>
            </div>
            <HighlightedCode code={s.code} lang={s.lang} />
          </div>
        ))}
      </div>
    </section>
  );
}
