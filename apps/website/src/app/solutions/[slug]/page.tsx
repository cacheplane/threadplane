import { notFound } from 'next/navigation';
import {
  getSolutionBySlug,
  getAllSolutionSlugs,
} from '../../../lib/solutions-data';
import { Container } from '../../../components/ui/Container';
import { Section } from '../../../components/ui/Section';
import { Button } from '../../../components/ui/Button';
import { SolutionCodeBlock } from '../../../components/solutions/SolutionCodeBlock';
import { SolutionDemoBlock } from '../../../components/solutions/SolutionDemoBlock';
import { SolutionSketch } from '../../../components/solutions/SolutionSketch';
import { WhitePaperBlock } from '../../../components/landing/WhitePaperBlock';
import { FinalCTA } from '../../../components/landing/FinalCTA';
import { getFormPolicy } from '../../../lib/growth/form-policy';
import '../../../styles/solutions.css';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export const LIBRARY_HREF: Record<string, string> = {
  Agent: '/langgraph',
  'json-render': '/render',
  Chat: '/chat',
};

export function generateStaticParams() {
  return getAllSolutionSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps) {
  const solution = getSolutionBySlug((await params).slug);
  if (!solution) return {};
  return { title: solution.metaTitle, description: solution.metaDescription };
}

export default async function SolutionPage({ params }: PageProps) {
  const solution = getSolutionBySlug((await params).slug);
  if (!solution) notFound();

  return (
    <div className="solutions-page">
      <Section
        ariaLabelledBy="solution-hero-heading"
        className="solutions-hero"
      >
        <Container>
          <div className="solutions-hero-copy">
            <h1 id="solution-hero-heading">
              {solution.title.replace('\n', ' ')}
            </h1>
            <p>{solution.subtitle}</p>
            <div className="solutions-actions">
              <Button variant="primary" size="lg" href="/pilot-to-prod">
                Plan a pilot
              </Button>
              <Button
                variant="secondary"
                size="lg"
                href="#solution-code-heading"
              >
                Explore the code
              </Button>
            </div>
          </div>
        </Container>
      </Section>

      <Section ariaLabelledBy="capabilities-heading">
        <Container>
          <div className="solutions-feature">
            <SolutionSketch kind={solution.slug} />
            <div className="solutions-feature-copy">
              <h2 id="capabilities-heading">
                Keep the whole
                <br />
                picture in view.
              </h2>
              <ul className="solutions-capabilities">
                {solution.proofPoints.map((point) => (
                  <li key={point.metric}>
                    <h3>{point.metric}</h3>
                    <p>{point.label}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Container>
      </Section>

      <Section ariaLabelledBy="problem-heading">
        <Container>
          <header className="solutions-section-heading">
            <h2 id="problem-heading">
              The hard parts deserve
              <br />a better interface.
            </h2>
          </header>
          <div className="solutions-grid solutions-problems">
            {solution.painPoints.map((point) => (
              <article className="solutions-card" key={point.title}>
                <h3>{point.title}</h3>
                <p>{point.description}</p>
              </article>
            ))}
          </div>
        </Container>
      </Section>

      <Section ariaLabelledBy="arch-heading">
        <Container>
          <header className="solutions-section-heading">
            <h2 id="arch-heading">
              Connected from
              <br />
              agent to interface.
            </h2>
            <p>{solution.architectureIntro}</p>
          </header>
          <div className="solutions-grid solutions-libraries">
            {solution.architectureLayers.map((layer) => (
              <article className="solutions-card" key={layer.library}>
                <h3>{layer.library}</h3>
                <code className="solutions-package">{layer.pkg}</code>
                <p>{layer.role}</p>
                {LIBRARY_HREF[layer.library] && (
                  <Button
                    variant="secondary"
                    size="lg"
                    href={LIBRARY_HREF[layer.library]}
                  >
                    Explore {layer.library} <span aria-hidden="true">↗</span>
                  </Button>
                )}
              </article>
            ))}
          </div>
        </Container>
      </Section>

      <SolutionCodeBlock code={solution.code} />
      {solution.demo && <SolutionDemoBlock clip={solution.demo} />}
      <WhitePaperBlock formPolicy={getFormPolicy()} />
      <FinalCTA
        headline={solution.ctaHeadline}
        subtext={solution.ctaSubtext}
        primary={{ label: 'Explore our services', href: '/pricing#services' }}
        secondary={{ label: 'Read the docs', href: '/docs' }}
      />
    </div>
  );
}
