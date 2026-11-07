import { Container } from '../../components/ui/Container';
import { Section } from '../../components/ui/Section';
import { Button } from '../../components/ui/Button';
import { WhitePaperBlock } from '../../components/landing/WhitePaperBlock';
import { FinalCTA } from '../../components/landing/FinalCTA';
import { SolutionSketch } from '../../components/solutions/SolutionSketch';
import { SOLUTIONS } from '../../lib/solutions-data';
import { createPageMetadata } from '../../lib/site-metadata';
import { getFormPolicy } from '../../lib/growth/form-policy';
import '../../styles/solutions.css';

const PREVIEWS: Record<string, { action: string; points: readonly string[] }> =
  {
    compliance: {
      action: 'Explore compliance',
      points: [
        'A reviewable thread record',
        'Human approval checkpoints',
        'History you can revisit',
      ],
    },
    analytics: {
      action: 'Explore analytics',
      points: [
        'Questions in plain English',
        'Results as they arrive',
        'Charts inside the conversation',
      ],
    },
    'customer-support': {
      action: 'Explore customer support',
      points: [
        'Context across handoffs',
        'Explicit approval decisions',
        'Visible tool activity',
      ],
    },
  };

export const metadata = createPageMetadata({
  title: 'Solutions — Threadplane',
  description:
    'Build agent experiences for compliance, analytics, and customer support, with human decisions and useful UI built into the flow.',
  pathname: '/solutions',
  type: 'website',
});

export default function SolutionsIndexPage() {
  return (
    <div className="solutions-page">
      <Section
        ariaLabelledBy="solutions-hero-heading"
        className="solutions-hero"
      >
        <Container>
          <div className="solutions-hero-copy">
            <h1 id="solutions-hero-heading">
              Put your agents
              <br />
              to work.
            </h1>
            <p>
              Answers are a start. Build the experience around them — with
              useful interfaces, human decisions, and context that stays with
              the conversation.
            </p>
          </div>
        </Container>
      </Section>
      <Section aria-label="Agent solutions">
        <Container>
          <div className="solutions-stories">
            {SOLUTIONS.map((solution) => (
              <article
                className="solutions-story"
                key={solution.slug}
                aria-labelledby={`story-${solution.slug}`}
              >
                <div className="solutions-story-copy">
                  <h2 id={`story-${solution.slug}`}>{solution.eyebrow}</h2>
                  <p>{solution.subtitle}</p>
                  <ul>
                    {PREVIEWS[solution.slug].points.map((point) => (
                      <li key={point}>
                        <span aria-hidden="true">✓</span>
                        {point}
                      </li>
                    ))}
                  </ul>
                  <Button
                    variant="secondary"
                    size="lg"
                    href={`/solutions/${solution.slug}`}
                  >
                    {PREVIEWS[solution.slug].action}{' '}
                    <span aria-hidden="true">↗</span>
                  </Button>
                </div>
                <SolutionSketch kind={solution.slug} />
              </article>
            ))}
          </div>
        </Container>
      </Section>
      <WhitePaperBlock formPolicy={getFormPolicy()} />
      <FinalCTA
        headline="Your use case. Ready for takeoff."
        subtext="Bring the workflow, the hard questions, and the parts that need to fit. We’ll help you turn a promising agent into a product."
        primary={{ label: 'Explore our services', href: '/pricing#services' }}
        secondary={{ label: 'Read the docs', href: '/docs' }}
      />
    </div>
  );
}
