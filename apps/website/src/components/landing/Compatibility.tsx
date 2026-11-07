import Link from 'next/link';
import { Container } from '../ui/Container';
import { Section } from '../ui/Section';
import { ReactMark, AngularMark } from '../ui/FrameworkMarks';
import { AdapterGuideLink } from './AdapterGuideLink';
import { PROVIDERS } from '../../lib/model-providers';

const runtimes = [
  { name: 'CrewAI', src: '/logos/runtimes/crewai.svg' },
  { name: 'Mastra', src: '/logos/runtimes/mastra.svg' },
  { name: 'Pydantic AI', src: '/logos/runtimes/pydantic.svg' },
  { name: 'Microsoft Agent Framework', src: '/logos/runtimes/microsoft.svg' },
  { name: 'AWS Strands', src: '/logos/providers/bedrock.svg' },
];

export function Compatibility() {
  return (
    <Section
      id="compatibility"
      ariaLabelledBy="compatibility-heading"
      className="home-section"
    >
      <Container>
        <header className="home-section-heading">
          <h2 id="compatibility-heading">Bring your stack.</h2>
          <p>
            Keep the tools you chose. Connect your application to your agents
            through LangGraph or AG-UI.
          </p>
        </header>
        <div
          className="home-framework-row"
          role="group"
          aria-label="Framework quickstarts"
        >
          <Link href="/docs/react/getting-started/quickstart">
            <ReactMark />
            <span>React quickstart</span>
            <span aria-hidden="true">›</span>
          </Link>
          <Link href="/docs/langgraph/getting-started/quickstart">
            <AngularMark />
            <span>Angular quickstart</span>
            <span aria-hidden="true">›</span>
          </Link>
        </div>
        <div className="home-adapters">
          <article className="home-adapter">
            <div className="home-adapter-brand">
              <img src="/logos/langgraph.svg" width="36" height="36" alt="" />
              <h3>LangGraph</h3>
            </div>
            <p>
              Connect directly to your graph. Bring threads, checkpoints,
              interrupts, and subagents into your UI.
            </p>
            <div className="home-adapter-detail">
              <span>Native SDK integration</span>
              <p>
                For agents built with LangGraph, self-hosted or deployed on
                LangSmith.
              </p>
            </div>
            <Link href="/langgraph" className="home-text-link">
              Explore LangGraph <span aria-hidden="true">›</span>
            </Link>
          </article>
          <article className="home-adapter">
            <div className="home-adapter-brand">
              <img src="/logos/ag-ui.svg" width="24" height="29" alt="" />
              <h3>AG-UI</h3>
            </div>
            <p>
              Connect through a shared protocol. Bring events, tool calls, and
              state from an AG-UI-compatible agent.
            </p>
            <div className="home-adapter-detail">
              <span>A shared protocol for your runtime</span>
              <ul
                className="home-runtime-logos"
                aria-label="AG-UI-compatible runtimes"
              >
                {runtimes.map(({ name, src }) => (
                  <li key={name}>
                    <img
                      src={src}
                      width="24"
                      height="24"
                      alt=""
                      loading="lazy"
                    />
                    <span>{name}</span>
                  </li>
                ))}
              </ul>
            </div>
            <Link href="/ag-ui" className="home-text-link">
              Explore AG-UI <span aria-hidden="true">›</span>
            </Link>
          </article>
        </div>
        <div className="home-models">
          <h3>Your models. Your choice.</h3>
          <p>Choose the model provider in your agent backend.</p>
          <ul aria-label="Model providers available through your backend">
            {PROVIDERS.map((provider) => (
              <li key={provider.name}>
                <img
                  src={provider.src}
                  width={provider.w ?? 24}
                  height="24"
                  alt=""
                  loading="lazy"
                />
                <span>{provider.name}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="home-section-footer">
          <AdapterGuideLink className="home-text-link" />
        </div>
      </Container>
    </Section>
  );
}
