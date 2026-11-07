import { HighlightedCode } from '../HighlightedCode';

const SNIPPET_1 = `// app.config.ts
import { provideAgent } from '@threadplane/langgraph';

providers: [
  provideAgent({
    assistantId: 'my-agent',
    apiUrl: 'https://my-langgraph.cloud',
  }),
];

// component
import { injectAgent } from '@threadplane/langgraph';
const chat = injectAgent();

// Reactive signals — OnPush compatible
chat.messages();    // Signal<Message[]>
chat.isLoading();   // Signal<boolean>
chat.interrupt();   // Signal<AgentInterrupt | undefined>`;

const SNIPPET_2 = `// app.config.ts
import { provideAgent, MockAgentTransport, FetchStreamTransport } from '@threadplane/langgraph';

providers: [
  provideAgent({
    apiUrl: environment.langgraphUrl,
    assistantId: 'my-agent',
    threadId: savedThreadId,
    onThreadId: (id) => localStorage.setItem('threadId', id),
    transport: isTest
      ? new MockAgentTransport(fixtures)
      : new FetchStreamTransport(),
  }),
];

// component
import { injectAgent } from '@threadplane/langgraph';
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
