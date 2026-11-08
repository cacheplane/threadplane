import { Container } from '../ui/Container';
import { Section } from '../ui/Section';
import { LogoMark } from '../ui/LogoMark';
import { ArchitectureGuideLink } from './ArchitectureGuideLink';

export function HomeArchitecture() {
  return (
    <Section
      id="architecture"
      ariaLabelledBy="architecture-heading"
      className="home-section"
    >
      <Container>
        <header className="home-section-heading">
          <h2 id="architecture-heading">In your app. On your terms.</h2>
          <p>
            A UI layer that fits your architecture, with no extra Threadplane
            runtime to deploy.
          </p>
        </header>
        <ol
          className="home-architecture"
          aria-label="How Threadplane connects your application to your agents"
        >
          <li className="home-architecture-card">
            <div className="home-architecture-art" aria-hidden="true">
              <div className="home-mini-window">
                <span />
                <span />
                <span />
                <i />
              </div>
            </div>
            <h3>Your application</h3>
            <p>
              Your components, your design system, and the experience your users
              already know.
            </p>
          </li>
          <li className="home-architecture-card home-architecture-center">
            <span className="home-architecture-arrow" aria-hidden="true" />
            <div className="home-architecture-art" aria-hidden="true">
              <LogoMark iconOnly />
            </div>
            <h3>Threadplane</h3>
            <p>
              Connect conversations, tool activity, and human decisions to your
              agent’s work.
            </p>
          </li>
          <li className="home-architecture-card">
            <span className="home-architecture-arrow" aria-hidden="true" />
            <div className="home-architecture-art" aria-hidden="true">
              <div className="home-mini-server">
                <span />
                <span />
                <span />
              </div>
            </div>
            <h3>Your agent backend</h3>
            <p>
              LangGraph or an AG-UI server. You choose the models,
              authentication, and infrastructure.
            </p>
          </li>
        </ol>
        <div className="home-section-footer">
          <ArchitectureGuideLink />
        </div>
      </Container>
    </Section>
  );
}
