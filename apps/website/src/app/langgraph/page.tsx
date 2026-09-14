import { Container } from '../../components/ui/Container';
import { WEBSITE_SUPPORTED_ANGULAR_MAJORS } from '../../components/pricing/angular-support.mjs';
import { Section } from '../../components/ui/Section';
import { Eyebrow } from '../../components/ui/Eyebrow';
import { Button } from '../../components/ui/Button';
import { Pill } from '../../components/ui/Pill';
import { FeatureBlock } from '../../components/landing/FeatureBlock';
import { WhitePaperBlock } from '../../components/landing/WhitePaperBlock';
import { FinalCTA } from '../../components/landing/FinalCTA';
import { MediumSwitcher } from '../../components/landing/MediumSwitcher';
import { LangGraphCodeShowcase } from '../../components/landing/langgraph/LangGraphCodeShowcase';
import { StackDiagramSection } from '../../components/landing/StackDiagramSection';
import { createPageMetadata, SHORT_POSITIONING_DESCRIPTION } from '../../lib/site-metadata';
import { SECTION_MEDIA } from '../../lib/section-media';
import { buildPanes } from '../../lib/build-panes';
import { getFormPolicy } from '../../lib/growth/form-policy';

export const metadata = createPageMetadata({
  title: '@threadplane/langgraph — Threadplane',
  description: SHORT_POSITIONING_DESCRIPTION,
  pathname: '/langgraph',
  type: 'website',
});

export default async function LangGraphPage() {
  const formPolicy = getFormPolicy();
  const panes = await buildPanes(SECTION_MEDIA.libLanggraph, SECTION_MEDIA.libLanggraph.video?.url ?? '');

  return (
    <>
      {/* Hero */}
      <Section surface="canvas" ariaLabelledBy="angular-hero-heading">
        <Container>
          <div className="langgraph-page-hero-inner">
            <div className="lib-hero-rail">
              <Eyebrow tone="accent">@threadplane/langgraph · LangGraph adapter</Eyebrow>
              <span className="lib-hero-rail-line" aria-hidden="true" />
            </div>
            <h1 id="angular-hero-heading" className="langgraph-page-h1">
              LangGraph agent UI for Angular.
            </h1>
            <p className="langgraph-page-hero-subtitle">
              Ship LangGraph agents inside your Angular app. Agent state arrives as signals; threads survive reloads; <span className="marker-highlight">humans stay in the loop</span>.
            </p>
            <div className="langgraph-page-hero-buttons">
              <Button variant="primary" size="lg" href="/docs/langgraph/getting-started/introduction">Get started</Button>
              <Button variant="secondary" size="lg" href="https://github.com/cacheplane/threadplane" target="_blank" rel="noopener noreferrer">View source</Button>
            </div>
            <p className="langgraph-page-adapter-note">
              Not sure if LangGraph is right for your backend? See <a href="/docs/choosing-an-adapter" className="langgraph-page-adapter-link">Choosing an adapter</a>.
            </p>
            <div className="langgraph-page-hero-pills">
              <Pill variant="accent">MIT</Pill>
              <Pill variant="angular">{`Angular ${WEBSITE_SUPPORTED_ANGULAR_MAJORS[0]}–${WEBSITE_SUPPORTED_ANGULAR_MAJORS.at(-1)}`}</Pill>
              <Pill variant="neutral">LangGraph + AG-UI</Pill>
            </div>
          </div>
        </Container>
      </Section>

      <StackDiagramSection
        id="langgraph-architecture"
        eyebrow="Architecture"
        headline="Native LangGraph, behind the Agent contract"
        body="The adapter speaks LangGraph Platform directly — threads, runs, checkpoints — and hands your components the same signal-shaped contract every Threadplane surface consumes."
        highlight="langgraph"
      />

      <FeatureBlock
        id="providers"
        eyebrow="Providers"
        headline="Drop it into app.config.ts. Done."
        body="provideAgent wires LangGraph into Angular's DI container. From any component, injectAgent() returns a signal-based handle for messages, status, errors, and interrupts."
        rows={[
          { claim: 'Wire it once in app.config.ts', api: 'provideAgent' },
          { claim: 'A typed, signal-based handle, no args', api: 'injectAgent()' },
          { claim: 'Deterministic tests without a backend', api: 'MockAgentTransport' },
        ]}
        cta={{ label: 'API reference', href: '/docs/langgraph/api/inject-agent' }}
        visual={<MediumSwitcher sectionId="lib-langgraph" panes={panes} />}
      />

      <FeatureBlock
        id="signals"
        eyebrow="Signals"
        headline="Reactive without RxJS gymnastics."
        body="Every agent surface is exposed as a signal — message stream, tool progress, interrupts, errors, status. Compose with the rest of your Angular reactivity story. No subscriptions to leak."
        rows={[
          { claim: 'messages(), status(), error() — live signals', api: 'signal-native handle' },
          { claim: 'Human-in-the-loop gates', api: 'interrupt()' },
          { claim: 'Branch, history, time-travel built in', api: 'checkpoints' },
        ]}
        cta={{ label: 'Read the streaming guide', href: '/docs/langgraph/guides/streaming' }}
        visualLeft
        visual={<LangGraphCodeShowcase />}
      />

      <WhitePaperBlock formPolicy={formPolicy} paper="angular" />
      <FinalCTA variant="dark" />
    </>
  );
}
