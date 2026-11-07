import type { Metadata } from 'next';
import { Container } from '../../../../../components/ui/Container';
import { Button } from '../../../../../components/ui/Button';
import { ReactMark } from '../../../../../components/ui/FrameworkMarks';
import { DocsControlPlane } from '../../../../../components/docs/DocsControlPlane';
import { DocsSearch } from '../../../../../components/docs/DocsSearch';
import { DocsSearchFooter } from '../../../../../components/docs/DocsSearchFooter';
import '../../../../../styles/docs-entry.css';

export const metadata: Metadata = {
  title: 'React quickstart — Threadplane',
  robots: { index: false, follow: true },
};

export default function ReactQuickstartPage() {
  return (
    <div className="flex min-h-screen docs-shell-page">
      <DocsSearch framework="react" />
      <DocsControlPlane
        scope="react"
        activeLibrary={null}
        activeSection="getting-started"
        activeSlug="quickstart"
      />
      <div className="flex-1 min-w-0 docs-shell-body docs-entry-page">
        <Container>
          <header className="docs-entry-hero">
            <h1 id="react-quickstart-heading">
              Your first
              <br />
              React agent interface.
            </h1>
            <p>
              Start with a working example, connect an agent session, and make
              the interface your own.
            </p>
            <div className="docs-entry-note">
              The React SDK is currently an experimental, private source-build
              package. These guides include repository build and run
              instructions; they are not a public npm installation recipe.
            </div>
          </header>
          <section
            className="docs-entry-section"
            aria-labelledby="react-start-heading"
          >
            <h2 id="react-start-heading">Start with the essentials.</h2>
            <div className="docs-entry-grid">
              <article className="docs-entry-card">
                <div className="docs-entry-card-heading">
                  <ReactMark />
                  <h3 className="docs-index-card-title">
                    Meet the React APIs.
                  </h3>
                </div>
                <p>
                  Learn how your application owns the agent session and React
                  observes its snapshots.
                </p>
                <div className="docs-entry-actions">
                  <Button
                    href="/docs/react/getting-started/introduction"
                    variant="secondary"
                  >
                    React introduction
                  </Button>
                </div>
              </article>
              <article className="docs-entry-card">
                <h3 className="docs-index-card-title">
                  Follow a running example.
                </h3>
                <p>
                  Build the repository example and connect a LangGraph session
                  to a streaming React interface.
                </p>
                <div className="docs-entry-actions">
                  <Button
                    href="/docs/react/langgraph/guides/streaming"
                    variant="secondary"
                  >
                    React streaming guide
                  </Button>
                </div>
              </article>
            </div>
          </section>
          <section
            className="docs-entry-section"
            aria-labelledby="react-next-heading"
          >
            <h2 id="react-next-heading">Make it your interface.</h2>
            <div className="docs-entry-grid docs-entry-resources">
              <a href="/docs/react/chat/concepts/message-model">
                <h3>Chat messages</h3>
                <p>Turn the agent’s messages into a conversation.</p>
                <span aria-hidden="true">↗</span>
              </a>
              <a href="/docs/react/render/guides/specs">
                <h3>Generated UI</h3>
                <p>
                  Render agent-produced specifications with your components.
                </p>
                <span aria-hidden="true">↗</span>
              </a>
              <a href="/docs/react/ag-ui/reference/event-mapping">
                <h3>AG-UI integration</h3>
                <p>Understand how protocol events become session state.</p>
                <span aria-hidden="true">↗</span>
              </a>
              <a href="/docs/angular/chat/getting-started/quickstart">
                <h3>Building with Angular?</h3>
                <p>Use the published Angular packages and chat quickstart.</p>
                <span aria-hidden="true">↗</span>
              </a>
            </div>
          </section>
        </Container>
        <DocsSearchFooter />
      </div>
    </div>
  );
}
