import { Container } from '../../components/ui/Container';
import { Section } from '../../components/ui/Section';
import { Button } from '../../components/ui/Button';
import { PilotSketch } from '../../components/services/PilotSketch';
import { createPageMetadata } from '../../lib/site-metadata';
import '../../styles/services.css';

export const metadata = createPageMetadata({
  title: 'Pilot to Production — Threadplane',
  description:
    'A scoped delivery engagement to bring your agent into production with your own runtime, data, and infrastructure. Build with our team, then own the result.',
  pathname: '/pilot-to-prod',
  type: 'website',
});

const CONTACT_HREF = '/contact?intent=enterprise&entry=pilot_to_prod';

const PHASES = [
  {
    id: 'discover',
    title: 'Map the route.',
    body: 'Start with the workflow, not the model. We work through the product, the people using it, and the constraints that will decide whether it ships.',
    timing: 'Weeks 1–2 in an example eight-week engagement.',
    points: [
      'A workflow and stack review',
      'A focused scope with acceptance criteria',
      'An integration plan for auth, data, and deployment',
    ],
    deliverable: 'A plan your team can build against.',
    sketch: 'plan',
  },
  {
    id: 'build',
    title: 'Make it work. In your app.',
    body: 'Build against real data and real authentication, alongside your engineers. Stakeholders see working software as the agent and its interface take shape.',
    timing: 'Weeks 3–5 in an example eight-week engagement.',
    points: [
      'Agent and interface integration',
      'Streaming, tool activity, and human decisions',
      'Working demos and feedback from your team',
    ],
    deliverable: 'A working agent in your product.',
    sketch: 'build',
  },
  {
    id: 'harden',
    title: 'Clear it for launch.',
    body: 'Work through the failures, the fallbacks, and the deployment path. Then hand over the knowledge your team needs to operate and improve what you shipped.',
    timing: 'Weeks 6–8 in an example eight-week engagement.',
    points: [
      'Testing, tracing, and recovery paths',
      'Deployment and rollback preparation',
      'A runbook, training, and source-code handoff',
    ],
    deliverable: 'A launch plan. A team ready to own it.',
    sketch: 'launch',
  },
] as const;

export default function PilotToProdPage() {
  return (
    <div className="services-page pilot-page">
      <Section ariaLabelledBy="pilot-hero-heading" className="services-hero">
        <Container>
          <div className="services-hero-copy">
            <h1 id="pilot-hero-heading">
              Your pilot.
              <br />
              Ready for production.
            </h1>
            <p>
              A promising demo is a start. Bring your real app, your data, and
              your engineers. We’ll help you get the rest ready to ship.
            </p>
            <div className="services-actions">
              <Button variant="primary" size="lg" href={CONTACT_HREF}>
                Plan a launch
              </Button>
              <Button variant="secondary" size="lg" href="#pilot-journey">
                See the engagement
              </Button>
            </div>
          </div>
        </Container>
      </Section>

      <Section id="pilot-journey" ariaLabelledBy="pilot-journey-heading">
        <Container>
          <header className="services-section-heading">
            <h2 id="pilot-journey-heading">
              A clear route.
              <br />
              Concrete handoffs.
            </h2>
            <p>
              Three phases, each with a tangible deliverable. The eight-week
              plan below is an example; we agree the scope, timing, and
              acceptance criteria together.
            </p>
          </header>
          <div className="pilot-phases">
            {PHASES.map((phase) => (
              <article
                className="pilot-phase"
                id={phase.id}
                key={phase.id}
                aria-labelledby={phase.id + '-heading'}
              >
                <div className="pilot-phase-copy">
                  <h2 id={phase.id + '-heading'}>{phase.title}</h2>
                  <p>{phase.body}</p>
                  <ul>
                    {phase.points.map((point) => (
                      <li key={point}>
                        <span aria-hidden="true">✓</span>
                        {point}
                      </li>
                    ))}
                  </ul>
                  <p className="pilot-phase-timing">{phase.timing}</p>
                </div>
                <PilotSketch kind={phase.sketch} takeaway={phase.deliverable} />
              </article>
            ))}
          </div>
        </Container>
      </Section>

      <Section ariaLabelledBy="outcomes-heading">
        <Container>
          <div className="pilot-ownership">
            <div>
              <h2 id="outcomes-heading">
                Your code.
                <br />
                Your team’s next chapter.
              </h2>
              <p>
                We’re here to help you ship and keep going. The result belongs
                in your repository, your infrastructure, and your engineers’
                hands.
              </p>
              <Button
                variant="secondary"
                size="lg"
                href="/docs/angular/langgraph/guides/deployment"
              >
                Explore production patterns <span aria-hidden="true">↗</span>
              </Button>
            </div>
            <ul className="pilot-outcomes">
              <li>
                <h3>Working software.</h3>
                <p>
                  Integrated with the app, data, and authentication you actually
                  use.
                </p>
              </li>
              <li>
                <h3>A path to operate it.</h3>
                <p>
                  Tests, observability, deployment guidance, and a runbook
                  shaped around the agreed scope.
                </p>
              </li>
              <li>
                <h3>Engineers who own it.</h3>
                <p>
                  Source code, training, and a handoff that makes the next
                  iteration yours.
                </p>
              </li>
            </ul>
          </div>
        </Container>
      </Section>

      <Section id="contact" ariaLabelledBy="pilot-contact-heading">
        <Container>
          <div className="services-closing">
            <h2 id="pilot-contact-heading">
              Tell us about
              <br />
              your runway.
            </h2>
            <p>
              Your stack, your workflow, and what’s keeping it from production.
              We’ll start there and work out whether Pilot-to-Prod is the right
              fit.
            </p>
            <Button variant="primary" size="lg" href={CONTACT_HREF}>
              Request a discovery call
            </Button>
          </div>
        </Container>
      </Section>
    </div>
  );
}
