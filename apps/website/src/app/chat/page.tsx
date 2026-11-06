import { Container } from '../../components/ui/Container';
import { Section } from '../../components/ui/Section';
import { Eyebrow } from '../../components/ui/Eyebrow';
import { Button } from '../../components/ui/Button';
import { Pill } from '../../components/ui/Pill';
import { FeatureBlock } from '../../components/landing/FeatureBlock';
import { WhitePaperBlock } from '../../components/landing/WhitePaperBlock';
import { FinalCTA } from '../../components/landing/FinalCTA';
import { MediumSwitcher } from '../../components/landing/MediumSwitcher';
import { ChatLandingCodeShowcase } from '../../components/landing/chat-landing/ChatLandingCodeShowcase';
import { createPageMetadata } from '../../lib/site-metadata';
import { SECTION_MEDIA } from '../../lib/section-media';
import { buildPanes } from '../../lib/build-panes';
import { getFormPolicy } from '../../lib/growth/form-policy';

export const metadata = createPageMetadata({
  title: '@threadplane/chat — Batteries-Included Agent Chat for Angular',
  description: 'Production agent chat UI in days, not sprints. Built on Vercel json-render and Google A2UI specs.',
  pathname: '/chat',
  type: 'website',
});

export default async function ChatPage() {
  const formPolicy = getFormPolicy();
  const panes = await buildPanes(SECTION_MEDIA.libChat, SECTION_MEDIA.libChat.video?.url ?? '');

  return (
    <>
      {/* Hero */}
      <Section surface="canvas" ariaLabelledBy="chat-hero-heading">
        <Container>
          <div className="chat-page-hero-inner">
            <div className="lib-hero-rail">
              <Eyebrow tone="accent">@threadplane/chat · chat compositions</Eyebrow>
              <span className="lib-hero-rail-line" aria-hidden="true" />
            </div>
            <h1 id="chat-hero-heading" className="chat-page-h1">
              Drop-in chat for Angular agents.
            </h1>
            <p className="chat-page-hero-subtitle">
              chat-timeline + chat-debug + GenUI surfaces. <span className="marker-highlight">Production-shaped from day one</span>, themable to your design system, or use the headless primitives if you want full control.
            </p>
            <div className="chat-page-hero-buttons">
              <Button variant="primary" size="lg" href="/docs/angular/chat/getting-started/introduction">Get started</Button>
              <Button variant="ghost" size="lg" href="/docs/angular/chat/guides/generative-ui?mode=run">
                See it live →
              </Button>
            </div>
            <div className="chat-page-hero-pills">
              <Pill variant="accent">MIT</Pill>
              <Pill variant="neutral">Vercel json-render</Pill>
              <Pill variant="neutral">Google A2UI</Pill>
            </div>
          </div>
        </Container>
      </Section>

      <FeatureBlock
        id="compositions"
        eyebrow="Compositions"
        headline="Opinionated shells, swappable parts."
        body="chat-timeline is a drop-in conversation surface that handles streaming, tool calls, interrupts, branching, and time-travel. chat-debug ships devtools alongside — tool-call inspector, message replay, thread history."
        rows={[
          { claim: 'A drop-in production conversation surface', api: 'chat-timeline' },
          { claim: 'Devtools beside it, ship-ready', api: 'chat-debug' },
          { claim: 'Thread navigation and history search', api: 'sidenav + palette' },
        ]}
        cta={{ label: 'See @threadplane/chat docs', href: '/docs/angular/chat/getting-started/introduction' }}
        visual={<MediumSwitcher sectionId="lib-chat" panes={panes} />}
      />

      <FeatureBlock
        id="headless"
        eyebrow="Headless"
        headline="Or skip the shell — use the primitives."
        body="If you have a design system, use the headless primitives directly. They're the same building blocks the compositions are made of — bring your own DOM, keep our state machine."
        rows={[
          { claim: 'Unstyled primitives, your design tokens', api: 'message + tool primitives' },
          { claim: 'The approval gate as a component', api: 'interrupt primitive' },
          { claim: 'Composes against the streaming contract', api: 'Agent contract' },
        ]}
        cta={{
          label: 'Headless API',
          href: '/docs/angular/chat/concepts/primitives-vs-compositions',
        }}
        visualLeft
        visual={<ChatLandingCodeShowcase />}
      />

      <WhitePaperBlock formPolicy={formPolicy} paper="chat" />
      <FinalCTA variant="dark" />
    </>
  );
}
