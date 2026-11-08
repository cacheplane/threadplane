import { Container } from '../../components/ui/Container';
import { Button } from '../../components/ui/Button';
import { AngularMark, ReactMark } from '../../components/ui/FrameworkMarks';
import { CopyButton } from '../../components/docs/CopyButton';
import { DocsControlPlane } from '../../components/docs/DocsControlPlane';
import { DocsSearch } from '../../components/docs/DocsSearch';
import { DocsSearchFooter } from '../../components/docs/DocsSearchFooter';
import { createPageMetadata } from '../../lib/site-metadata';
import '../../styles/docs-entry.css';

export const metadata = createPageMetadata({
  title: 'Documentation — Threadplane',
  description:
    'Learn Threadplane for Angular and React. Framework guides, API reference, and working examples.',
  pathname: '/docs',
  type: 'website',
});

const BACKENDS = [
  {
    title: 'LangGraph',
    blurb:
      'Connect directly to LangGraph for streaming, threads, checkpoints, and human approvals.',
    install:
      'npm i @threadplane/chat @threadplane/langgraph @langchain/core @langchain/langgraph-sdk marked',
    href: '/docs/angular/langgraph/getting-started/quickstart',
    reactHref: '/docs/react/langgraph/guides/streaming',
    logo: '/logos/langgraph.svg',
  },
  {
    title: 'AG-UI',
    blurb:
      'Connect an AG-UI backend, including CrewAI, Mastra, Microsoft Agent Framework, and AWS Strands.',
    install:
      'npm i @threadplane/chat @threadplane/ag-ui @ag-ui/client @ag-ui/core marked',
    href: '/docs/angular/ag-ui/getting-started/quickstart',
    reactHref: '/docs/react/ag-ui/reference/event-mapping',
    logo: '/logos/ag-ui.svg',
  },
];

const SURFACES = [
  {
    title: 'A2UI',
    blurb: 'Render surfaces that the agent updates throughout a conversation.',
    href: '/docs/angular/a2ui/getting-started/introduction',
    reactHref: '/docs/react/a2ui/getting-started/introduction',
    logo: '/logos/providers/google.svg',
  },
  {
    title: 'json-render',
    blurb:
      'Turn a JSON specification into your own components. You own the schema.',
    href: '/docs/angular/render/getting-started/introduction',
    reactHref: '/docs/react/render/guides/specs',
    logo: '/logos/surface/vercel.svg',
  },
];

function Logo({ src }: { src: string }) {
  return (
    <img
      className="docs-entry-logo"
      src={src}
      alt=""
      aria-hidden="true"
      width="32"
      height="32"
    />
  );
}

export default function DocsLandingPage() {
  return (
    <div className="flex min-h-screen docs-shell-page">
      <DocsSearch />
      <DocsControlPlane
        activeLibrary={null}
        activeSection=""
        activeSlug=""
        runHref="/docs/examples"
      />
      <div className="flex-1 min-w-0 docs-shell-body docs-index-body docs-entry-page">
        <Container>
          <header className="docs-entry-hero">
            <h1 id="docs-heading">
              Start building
              <br />
              with Threadplane.
            </h1>
            <p>
              Your framework. Your backend. A clear path to your first agent
              interface.
            </p>
          </header>
          <section
            className="docs-entry-section"
            aria-labelledby="framework-heading"
          >
            <h2 id="framework-heading">Choose your framework.</h2>
            <div className="docs-entry-grid docs-entry-frameworks">
              <article className="docs-entry-card">
                <div className="docs-entry-card-heading">
                  <AngularMark />
                  <h3 className="docs-index-card-title">Angular</h3>
                </div>
                <p>
                  Install the published packages and connect your first agent.
                  Start with the essentials, then pick your adapter.
                </p>
                <div className="docs-entry-actions">
                  <Button
                    href="/docs/angular/getting-started/introduction"
                    variant="primary"
                    trailingIcon="↗"
                  >
                    Start with Angular
                  </Button>
                </div>
              </article>
              <article className="docs-entry-card">
                <div className="docs-entry-card-heading">
                  <ReactMark />
                  <h3 className="docs-index-card-title">React</h3>
                </div>
                <p>
                  Explore the guides and working examples. The React SDK is
                  currently a private source-build package.
                </p>
                <div className="docs-entry-actions">
                  <Button
                    href="/docs/react/getting-started/introduction"
                    variant="primary"
                    trailingIcon="↗"
                  >
                    Start with React
                  </Button>
                </div>
              </article>
            </div>
          </section>
          <section
            className="docs-entry-section"
            aria-labelledby="backend-heading"
          >
            <div className="docs-entry-section-heading">
              <h2 id="backend-heading">Pick your backend.</h2>
              <Button
                href="/docs/choosing-an-adapter"
                variant="secondary"
                trailingIcon="↗"
              >
                Compare adapters
              </Button>
            </div>
            <div className="docs-entry-grid">
              {BACKENDS.map((backend) => (
                <article key={backend.title} className="docs-entry-card">
                  <div className="docs-entry-card-heading">
                    <Logo src={backend.logo} />
                    <h3 className="docs-index-card-title">{backend.title}</h3>
                  </div>
                  <p>{backend.blurb}</p>
                  <details className="docs-entry-install">
                    <summary>Angular install command</summary>
                    <div className="docs-entry-command">
                      <code>{backend.install}</code>
                      <CopyButton text={backend.install} />
                    </div>
                  </details>
                  <div className="docs-entry-actions">
                    <Button href={backend.href} variant="secondary">
                      Angular quickstart
                    </Button>
                    <Button href={backend.reactHref} variant="secondary">
                      React guide
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </section>
          <section
            className="docs-entry-section"
            aria-labelledby="genui-heading"
          >
            <div className="docs-entry-section-heading">
              <h2 id="genui-heading">Generative UI.</h2>
              <Button
                href="/docs/angular/render/concepts/json-render-vs-a2ui"
                variant="secondary"
                trailingIcon="↗"
              >
                Compare approaches
              </Button>
            </div>
            <div className="docs-entry-grid">
              {SURFACES.map((surface) => (
                <article key={surface.title} className="docs-entry-card">
                  <div className="docs-entry-card-heading">
                    <Logo src={surface.logo} />
                    <h3 className="docs-index-card-title">{surface.title}</h3>
                  </div>
                  <p>{surface.blurb}</p>
                  <div className="docs-entry-actions">
                    <Button href={surface.href} variant="secondary">
                      Angular guide
                    </Button>
                    <Button href={surface.reactHref} variant="secondary">
                      React guide
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </section>
          <section
            className="docs-entry-section"
            aria-labelledby="chat-heading"
          >
            <div className="docs-entry-chat">
              <div>
                <h2 id="chat-heading">
                  Chat UI.
                  <br />
                  Ready for your agent.
                </h2>
                <p>
                  Messages, streaming, tool calls, approvals, and generated UI.
                  Put the pieces together in your own design system.
                </p>
              </div>
              <div className="docs-entry-chat-links">
                <Button
                  href="/docs/angular/chat/getting-started/quickstart"
                  variant="primary"
                >
                  Angular chat quickstart
                </Button>
                <Button
                  href="/docs/react/chat/concepts/message-model"
                  variant="secondary"
                >
                  React chat guide
                </Button>
                <Button
                  href="/docs/angular/chat/getting-started/introduction"
                  variant="secondary"
                >
                  Explore Angular chat
                </Button>
              </div>
            </div>
          </section>
          <section
            className="docs-entry-section"
            aria-labelledby="further-heading"
          >
            <h2 id="further-heading">Go a little further.</h2>
            <div className="docs-entry-grid docs-entry-resources">
              <a href="/docs/angular/runtimes/getting-started/introduction">
                <h3>Agent runtimes</h3>
                <p>Connect Mastra, Strands, and Microsoft Agent Framework.</p>
                <span aria-hidden="true">↗</span>
              </a>
              <a href="/docs/angular/deep-agents/getting-started/introduction">
                <h3>Deep Agents</h3>
                <p>Work with planning, files, memory, and specialist agents.</p>
                <span aria-hidden="true">↗</span>
              </a>
              <a href="/docs/shared/middleware/getting-started/introduction">
                <h3>Backend middleware</h3>
                <p>Route client tools from JavaScript and Python backends.</p>
                <span aria-hidden="true">↗</span>
              </a>
              <a href="/docs/api">
                <h3>API reference</h3>
                <p>
                  Find the types, functions, and components behind your build.
                </p>
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
