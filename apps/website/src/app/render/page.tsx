import { Container } from '../../components/ui/Container';
import { Section } from '../../components/ui/Section';
import { Eyebrow } from '../../components/ui/Eyebrow';
import { Button } from '../../components/ui/Button';
import { Pill } from '../../components/ui/Pill';
import { FeatureBlock } from '../../components/landing/FeatureBlock';
import { WhitePaperBlock } from '../../components/landing/WhitePaperBlock';
import { FinalCTA } from '../../components/landing/FinalCTA';
import { MediumSwitcher } from '../../components/landing/MediumSwitcher';
import { DiagramSection } from '../../components/landing/DiagramSection';
import { RenderTransform } from '../../components/docs/diagrams';
import { RenderCodeShowcase } from '../../components/landing/render/RenderCodeShowcase';
import { createPageMetadata } from '../../lib/site-metadata';
import { SECTION_MEDIA } from '../../lib/section-media';
import { buildPanes } from '../../lib/build-panes';
import { getFormPolicy } from '../../lib/growth/form-policy';

export const metadata = createPageMetadata({
  title: '@threadplane/render — Generative UI for Angular',
  description: 'Agents that render UI without coupling to your frontend. Built on Vercel json-render spec.',
  pathname: '/render',
  type: 'website',
});

export default async function RenderPage() {
  const formPolicy = getFormPolicy();
  const panes = await buildPanes(SECTION_MEDIA.libRender, SECTION_MEDIA.libRender.video?.url ?? '');

  return (
    <>
      {/* Hero */}
      <Section surface="canvas" ariaLabelledBy="render-hero-heading">
        <Container>
          <div className="render-page-hero-inner">
            <div className="lib-hero-rail">
              <Eyebrow tone="accent">@threadplane/render · generative UI</Eyebrow>
              <span className="lib-hero-rail-line" aria-hidden="true" />
            </div>
            <h1 id="render-hero-heading" className="render-page-h1">
              Generative UI without a second framework.
            </h1>
            <p className="render-page-hero-subtitle">
              Server-emitted JSON specs render into Angular <span className="marker-highlight">components you already own</span>. Vercel json-render and Google A2UI both supported. Unknown specs degrade gracefully — no surprises.
            </p>
            <div className="render-page-hero-buttons">
              <Button variant="primary" size="lg" href="/docs/render/getting-started/introduction">Get started</Button>
              <Button variant="secondary" size="lg" href="https://github.com/cacheplane/threadplane" target="_blank" rel="noopener noreferrer">View source</Button>
            </div>
            <div className="render-page-hero-pills">
              <Pill variant="accent">MIT</Pill>
              <Pill variant="neutral">Vercel json-render</Pill>
              <Pill variant="neutral">Google A2UI</Pill>
            </div>
          </div>
        </Container>
      </Section>

      <DiagramSection
        id="render-transform"
        eyebrow="How it works"
        headline="Schema on the wire, your design system on screen"
        body="The agent emits a spec. Your registry, state, and handlers resolve it — and your own Angular components render it."
      >
        <RenderTransform />
      </DiagramSection>

      <FeatureBlock
        id="schemas"
        eyebrow="Schemas"
        headline="One spec. Your components."
        body="The agent emits structured UI as JSON. @threadplane/render maps each spec node to one of your Angular components — so the design system stays yours, and the agent gets to assemble it."
        rows={[
          { claim: 'One spec, rendered by components you own', api: 'component registry' },
          { claim: 'Both protocols spoken', api: 'json-render + A2UI' },
          { claim: 'Schema on the server, validation in the client', api: 'validated specs' },
        ]}
        cta={{ label: 'See @threadplane/render docs', href: '/docs/render/getting-started/introduction' }}
        visual={<MediumSwitcher sectionId="lib-render" panes={panes} />}
      />

      <FeatureBlock
        id="fallbacks"
        eyebrow="Fallbacks"
        headline="Readiness gate + per-component fallback."
        body="When the agent emits a spec your registry doesn't know how to render, @threadplane/render falls back gracefully — and surfaces it to your observability layer. No mystery white screens."
        rows={[
          { claim: 'Unknown components degrade, not crash', api: 'fallback API' },
          { claim: 'Renders hold until the surface is real', api: 'readiness gate' },
          { claim: 'Partial renders while streaming', api: 'streaming specs' },
        ]}
        cta={{ label: 'Fallback patterns', href: '/docs/render/guides/registry' }}
        visualLeft
        visual={<RenderCodeShowcase />}
      />

      <WhitePaperBlock formPolicy={formPolicy} paper="render" />
      <FinalCTA variant="dark" />
    </>
  );
}
