import Link from 'next/link';
import { WEBSITE_SUPPORTED_ANGULAR_MAJORS } from '../../components/pricing/angular-support.mjs';
import { Container } from '../../components/ui/Container';
import { Section } from '../../components/ui/Section';
import { Eyebrow } from '../../components/ui/Eyebrow';
import { Button } from '../../components/ui/Button';
import { Pill } from '../../components/ui/Pill';
import { FeatureBlock } from '../../components/landing/FeatureBlock';
import { WhitePaperBlock } from '../../components/landing/WhitePaperBlock';
import { FinalCTA } from '../../components/landing/FinalCTA';
import { MediumSwitcher } from '../../components/landing/MediumSwitcher';
import { BackendsGrid } from '../../components/landing/ag-ui/BackendsGrid';
import { StackDiagramSection } from '../../components/landing/StackDiagramSection';
import { createPageMetadata, SHORT_POSITIONING_DESCRIPTION } from '../../lib/site-metadata';
import { SECTION_MEDIA } from '../../lib/section-media';
import { buildPanes } from '../../lib/build-panes';
import { getFormPolicy } from '../../lib/growth/form-policy';

export const metadata = createPageMetadata({
  title: '@threadplane/ag-ui — Threadplane',
  description: SHORT_POSITIONING_DESCRIPTION,
  pathname: '/ag-ui',
  type: 'website',
});

export default async function AgUiPage() {
  const formPolicy = getFormPolicy();
  const panes = await buildPanes(SECTION_MEDIA.libAgUi, SECTION_MEDIA.libAgUi.video?.url ?? '');

  return (
    <>
      {/* Hero */}
      <Section surface="canvas" ariaLabelledBy="ag-ui-hero-heading">
        <Container>
          <div className="ag-ui-page-hero-inner">
            <div className="lib-hero-rail">
              <Eyebrow tone="accent">@threadplane/ag-ui · protocol adapter</Eyebrow>
              <span className="lib-hero-rail-line" aria-hidden="true" />
            </div>
            <h1 id="ag-ui-hero-heading" className="ag-ui-page-h1">
              One adapter. Seven backends.
            </h1>
            <p className="ag-ui-page-hero-subtitle">
              Build the Angular UI once, on the AG-UI protocol — seven runtimes speak it today, and new ones <span className="marker-highlight">work the day they ship</span>. History and checkpoint behavior stays with your backend.
            </p>
            <div className="ag-ui-page-hero-buttons">
              <Button variant="primary" size="lg" href="/docs/ag-ui/getting-started/quickstart">Get started</Button>
              <Button variant="secondary" size="lg" href="https://github.com/cacheplane/threadplane" target="_blank" rel="noopener noreferrer">View source</Button>
            </div>
            <p className="ag-ui-page-adapter-note">
              Talking to LangGraph Platform directly? See <a href="/docs/choosing-an-adapter" className="ag-ui-page-adapter-link">Choosing an adapter</a>.
            </p>
            <div className="ag-ui-page-hero-pills">
              <Pill variant="accent">MIT</Pill>
              <Pill variant="angular">{`Angular ${WEBSITE_SUPPORTED_ANGULAR_MAJORS[0]}–${WEBSITE_SUPPORTED_ANGULAR_MAJORS.at(-1)}`}</Pill>
              <Pill variant="neutral">AG-UI protocol</Pill>
            </div>
            <p className="ag-ui-page-langgraph-note">
              Already on LangGraph?{' '}
              <Link href="/langgraph" className="ag-ui-page-langgraph-link">
                See @threadplane/langgraph
              </Link>{' '}
              for native streaming, checkpoints, and the typed LangGraph SDK path.
            </p>
          </div>
        </Container>
      </Section>

      <StackDiagramSection
        id="ag-ui-architecture"
        eyebrow="Architecture"
        headline="The adapter is the only part that speaks AG-UI"
        body="Everything above the seam is plain Angular — signals in, components out. toAgent() keeps the protocol at the boundary, so nothing in your UI changes when the backend does."
        highlight="ag-ui"
      />

      <FeatureBlock
        id="backends"
        eyebrow="Runtime choice"
        headline="Pick a backend. Keep the UI."
        body="The AG-UI protocol decouples your agent runtime from your front-end. @threadplane/ag-ui wraps any AG-UI AbstractAgent into the runtime-neutral Agent contract that @threadplane/chat consumes — so the same Angular components ship against seven different runtimes."
        rows={[
          { claim: 'Stream from Python, .NET, or TypeScript', api: 'AG-UI protocol' },
          { claim: 'Tool calls, state deltas, citations — standardized', api: 'protocol events' },
          { claim: 'New AG-UI runtimes work day one', api: 'no adapter needed' },
        ]}
        cta={{ label: 'Browse the AG-UI protocol', href: 'https://github.com/ag-ui-protocol/ag-ui' }}
        visual={<BackendsGrid />}
      />

      <FeatureBlock
        id="primitives"
        eyebrow="Same primitives"
        headline="Drop-in for everything @threadplane/chat ships."
        body="provideAgent registers an AG-UI client and exposes the same Agent contract that @threadplane/langgraph provides. Chat rendering, status, tool calls, generative UI, and citations use the same Angular primitives; durable checkpointed threads and history depend on the backend protocol, so use @threadplane/langgraph when you need the native LangGraph thread API."
        rows={[
          { claim: 'Same names across adapters', api: 'provideAgent + injectAgent' },
          { claim: 'Same components, themes, citations', api: '@threadplane/chat' },
          { claim: 'Same deterministic testing', api: 'MockAgentTransport' },
        ]}
        cta={{ label: 'API reference', href: '/docs/langgraph/api/inject-agent' }}
        visualLeft
        visual={<MediumSwitcher sectionId="lib-ag-ui" panes={panes} />}
      />

      <WhitePaperBlock formPolicy={formPolicy} paper="overview" />
      <FinalCTA variant="dark" />
    </>
  );
}
