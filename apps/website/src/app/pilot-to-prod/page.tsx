import { Container } from '../../components/ui/Container';
import { Section } from '../../components/ui/Section';
import { Eyebrow } from '../../components/ui/Eyebrow';
import { Button } from '../../components/ui/Button';
import { Pill } from '../../components/ui/Pill';
import { FeatureBlock } from '../../components/landing/FeatureBlock';
import { BrowserFrame } from '../../components/ui/BrowserFrame';
import { WhitePaperBlock } from '../../components/landing/WhitePaperBlock';
import { FinalCTA } from '../../components/landing/FinalCTA';
import { DiagramSection } from '../../components/landing/DiagramSection';
import { PilotJourney } from '../../components/docs/diagrams';
import { createPageMetadata } from '../../lib/site-metadata';
import { getFormPolicy } from '../../lib/growth/form-policy';

export const metadata = createPageMetadata({
  title: 'Pilot to Production — Threadplane',
  description: 'An optionally scoped eight-week concierge engagement for Angular teams shipping an agent into production with their own runtime, data, and infrastructure.',
  pathname: '/pilot-to-prod',
  type: 'website',
});

export default function PilotToProdPage() {
  const formPolicy = getFormPolicy();
  return (
    <>
      {/* Hero */}
      <Section surface="canvas" ariaLabelledBy="pilot-hero-heading">
        <Container>
          <div className="pilot-hero-inner">
            <Eyebrow tone="accent" className="pilot-eyebrow-spaced">Pilot to production</Eyebrow>
            <h1 id="pilot-hero-heading" className="pilot-h1">
              8 weeks. One working agent. Production-ready patterns.
            </h1>
            <p className="pilot-hero-subtitle">
              Pilot-to-Prod is a concierge engagement. We ship your first Angular agent on your real data, in your real app — and your engineers own it at the end.
            </p>
            <div className="pilot-hero-buttons">
              <Button variant="primary" size="lg" href="#whitepaper-block">Read the field report</Button>
              <Button variant="secondary" size="lg" href="#contact">Book a discovery call</Button>
            </div>
            <div className="pilot-hero-pills">
              <Pill variant="accent">Fixed scope</Pill>
              <Pill variant="neutral">Source delivered</Pill>
              <Pill variant="neutral">IP yours</Pill>
              <Pill variant="neutral">No lock-in</Pill>
            </div>
          </div>
        </Container>
      </Section>

      <DiagramSection
        id="pilot-journey"
        eyebrow="The engagement"
        headline="Three phases, each with a gate you can point at"
        body="No open-ended consulting arc: each phase ends with a concrete deliverable — a roadmap, a working agent, an on-call runbook — not a status update."
      >
        <PilotJourney />
      </DiagramSection>

      {/* Discover */}
      <FeatureBlock
        id="discover"
        eyebrow="Week 1–2 · Discover"
        headline="Map your stack. Pick the work that earns its keep."
        body="We don't start with the model. We start with the workflow — the meeting where someone says 'this would be a great use of AI' and the friction that's stopping it from shipping."
        rows={[
          { claim: 'Audit your surfaces and agent-eligible workflows', api: 'stack audit' },
          { claim: 'Pick the one or two agents that earn their keep', api: 'roadmap' },
          { claim: 'Auth, residency, observability locked early', api: 'workshops' },
        ]}
        cta={{ label: 'See sample roadmap', href: '#whitepaper-block' }}
        visual={
          <BrowserFrame url="discover · scope · plan" elevation="md">
            <div className="pilot-visual-panel">
              <Eyebrow tone="accent" className="pilot-eyebrow-tight">Roadmap draft</Eyebrow>
              <ul className="pilot-roadmap-list">
                {[
                  ['W1', 'Stakeholder interviews + workflow audit'],
                  ['W2', 'Agent shortlist + integration plan'],
                  ['W3–5', 'Build + iterate on real data'],
                  ['W6–7', 'Harden + observability + deploy'],
                  ['W8', 'Train your team · handoff'],
                ].map(([w, desc]) => (
                  <li key={w} className="pilot-roadmap-item">
                    <span className="pilot-roadmap-week">{w}</span>
                    <span className="pilot-roadmap-desc">{desc}</span>
                  </li>
                ))}
              </ul>
            </div>
          </BrowserFrame>
        }
      />

      {/* Build */}
      <FeatureBlock
        id="build"
        eyebrow="Week 3–5 · Build"
        headline="Ship a working agent on your real data."
        body="Working code, not slideware. We integrate against your real backend, your real auth, and your real Angular app — paired with your engineers, not behind a curtain."
        rows={[
          { claim: 'A working agent on your real data', api: 'your repo, your engineers' },
          { claim: 'Streaming surface from the chat compositions', api: '@threadplane/chat' },
          { claim: 'Weekly demos to stakeholders', api: 'open progress' },
        ]}
        cta={{ label: 'See @threadplane/chat', href: '/chat' }}
        visualLeft
        visual={
          <BrowserFrame url="threadplane.ai/docs · Run" elevation="md">
            <img
              src="/screenshots/workspace-run.webp"
              alt="Threadplane Website workspace — live chat surface ready to receive a message"
              className="pilot-screenshot"
              loading="lazy"
              decoding="async"
            />
          </BrowserFrame>
        }
      />

      {/* Harden */}
      <FeatureBlock
        id="harden"
        eyebrow="Week 6–7 · Harden"
        headline="Production-ready, not demo-ready."
        body="Observability, error boundaries, fallback strategies, deploy paths, on-call runbook. The stuff that makes the difference between a demo and an app you can leave running on a Friday afternoon."
        rows={[
          { claim: 'Tracing, metrics, error budgets', api: 'Distributed tracing hooks' },
          { claim: 'Fallbacks across every agent surface', api: 'readiness + fallback' },
          { claim: 'Load tested, on-call ready', api: 'runbook, yours' },
        ]}
        cta={{ label: 'Production patterns', href: '/docs/angular/langgraph/guides/deployment' }}
        visual={
          <BrowserFrame url="grafana · agent dashboard" elevation="md">
            <div className="pilot-visual-panel">
              <Eyebrow tone="accent" className="pilot-eyebrow-tight">Production checklist</Eyebrow>
              <ul className="pilot-checklist-list">
                {[
                  'Streaming latency budget defined',
                  'Tool-call error boundaries wired',
                  'Fallback API per surface',
                  'Tracing → your dashboard',
                  'On-call runbook delivered',
                  'Deploy + rollback tested',
                ].map((item) => (
                  <li key={item} className="pilot-checklist-item">
                    <span className="pilot-checklist-badge">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </BrowserFrame>
        }
      />

      {/* Outcomes */}
      <Section surface="tinted" ariaLabelledBy="outcomes-heading">
        <Container>
          <div className="pilot-section-header">
            <div className="pilot-rail2">
              <Eyebrow tone="accent" className="pilot-eyebrow-tight">What you walk away with</Eyebrow>
              <span className="pilot-rail2-line" aria-hidden="true" />
            </div>
            <h2 id="outcomes-heading" className="pilot-h2">
              A working agent. A trained team. A runbook.
            </h2>
          </div>
          <div className="pilot-outcome-rows">
            {[
              { claim: 'Live on your data, in your app — not in a sandbox.', tail: 'working demo' },
              { claim: 'Error, fallback, and observability built in from the start.', tail: 'hardened patterns' },
              { claim: 'Integrated with your CI/CD, your auth, your data.', tail: 'deploy-ready' },
              { claim: 'Your engineers own the framework and the runbook.', tail: 'trained team' },
            ].map((o) => (
              <div className="pilot-outcome-row" key={o.tail}>
                <p className="pilot-outcome-claim">{o.claim}</p>
                <p className="pilot-outcome-tail">{o.tail}</p>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      <WhitePaperBlock formPolicy={formPolicy} />

      {/* Contact anchor */}
      <Section id="contact" surface="white" ariaLabelledBy="contact-heading">
        <Container>
          <div className="pilot-contact-inner">
            <Eyebrow tone="accent" className="pilot-eyebrow-spaced">Discovery call</Eyebrow>
            <h2 id="contact-heading" className="pilot-h2 pilot-h2-spaced">
              Tell us about your stack.
            </h2>
            <p className="pilot-contact-body">
              30-minute discovery call. We&apos;ll dig into your Angular surface, your agent-eligible workflows, and whether Pilot-to-Prod is the right fit. No pitch deck.
            </p>
            <Button variant="primary" size="lg" href="/pricing#enterprise">
              Request a discovery call
            </Button>
          </div>
        </Container>
      </Section>

      <FinalCTA />
    </>
  );
}
