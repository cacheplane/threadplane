import type { ReactNode } from 'react';
import Link from 'next/link';
import { Container } from '../../components/ui/Container';
import { Section } from '../../components/ui/Section';
import { Eyebrow } from '../../components/ui/Eyebrow';
import { Card } from '../../components/ui/Card';
import { CopyButton } from '../../components/docs/CopyButton';
import { DocsControlPlane } from '../../components/docs/DocsControlPlane';
import { DocsSearch } from '../../components/docs/DocsSearch';
import { DocsSearchFooter } from '../../components/docs/DocsSearchFooter';
import { createPageMetadata } from '../../lib/site-metadata';
import { DEFAULT_EXAMPLE_RUN_HREF } from '../../lib/docs-index-example';

export const metadata = createPageMetadata({
  title: 'Documentation — Threadplane',
  description:
    'Learn Threadplane for Angular and React. Framework guides, API reference, and working examples.',
  pathname: '/docs',
  type: 'website',
});

interface Backend {
  title: string;
  blurb: string;
  install: string;
  href: string;
  logoSrc: string;
  attribution: string;
}

const BACKENDS: Backend[] = [
  {
    title: 'LangGraph',
    blurb: 'For LangChain & LangGraph backends.',
    install: 'npm i @threadplane/chat @threadplane/langgraph @langchain/core @langchain/langgraph-sdk marked',
    href: '/docs/angular/langgraph/getting-started/quickstart',
    logoSrc: '/logos/langgraph.svg',
    attribution: 'LangChain',
  },
  {
    title: 'AG-UI',
    blurb: 'For CrewAI, Mastra, Pydantic AI, Strands, and more.',
    install: 'npm i @threadplane/chat @threadplane/ag-ui @ag-ui/client @ag-ui/core marked',
    href: '/docs/angular/ag-ui/getting-started/quickstart',
    logoSrc: '/logos/ag-ui.svg',
    attribution: 'AG-UI',
  },
];

interface GenerativeUi {
  title: string;
  blurb: string;
  href: string;
  logoSrc: string;
  attribution: string;
}

const GENERATIVE_UI: GenerativeUi[] = [
  {
    title: 'A2UI',
    blurb:
      'Agent-to-UI protocol — the agent streams and updates surfaces over the conversation.',
    href: '/docs/angular/a2ui/getting-started/introduction',
    logoSrc: '/logos/providers/google.svg',
    attribution: 'Google',
  },
  {
    title: 'json-render',
    blurb:
      'Render a fixed JSON spec into your own Angular components. You own the schema.',
    href: '/docs/angular/render/getting-started/introduction',
    logoSrc: '/logos/surface/vercel.svg',
    attribution: 'Vercel',
  },
];

interface SupportingLib {
  title: string;
  blurb: string;
  href: string;
  glyph: 'middleware' | 'pulse';
}

const SUPPORTING: SupportingLib[] = [
  {
    title: 'Middleware',
    blurb: 'JS & Python client-tool routing',
    href: '/docs/shared/middleware/getting-started/introduction',
    glyph: 'middleware',
  },
];

function ChatGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5h16v11H8l-4 4V5Z" />
    </svg>
  );
}

function PulseGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 13h4l3-8 4 16 3-8h4" />
    </svg>
  );
}

function MiddlewareGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16M4 17h16" />
      <path d="M7 4v6M17 14v6" />
    </svg>
  );
}

const GLYPHS = { middleware: MiddlewareGlyph, pulse: PulseGlyph } as const;

function StepLabel({ id, step, children }: { id: string; step?: number; children: ReactNode }) {
  return (
    <h2 id={id} className="docs-index-step-label">
      {step != null ? (
        <span aria-hidden="true" className="docs-index-step-badge">{step}</span>
      ) : null}
      {children}
    </h2>
  );
}

function LogoChip({ src }: { src: string }) {
  return (
    <span className="docs-index-logo-chip">
      <img
        src={src}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        className="docs-index-logo-img"
      />
    </span>
  );
}

function GlyphChip({ size, children }: { size: number; children: ReactNode }) {
  return <span className="docs-index-glyph-chip" style={{ '--glyph-size': `${size}px` } as React.CSSProperties}>{children}</span>;
}

export default function DocsLandingPage() {
  return (
    <div className="flex min-h-screen docs-shell-page">
      <DocsSearch />
      {/* The index is library-neutral: it is where you pick one. */}
      <DocsControlPlane
        activeLibrary={null}
        activeSection=""
        activeSlug=""
        runHref={DEFAULT_EXAMPLE_RUN_HREF}
      />
      {/* Deliberately outside the article measure the [slug] route uses — the
       * card grids need their own width, and the prose column would flatten
       * them. The shell supplies the chrome, not the content width. */}
      <div className="flex-1 min-w-0 docs-shell-body docs-index-body">

      {/* Hero */}
      <Section surface="canvas" ariaLabelledBy="docs-heading">
        <Container>
          <div className="docs-index-hero-inner">
            <Eyebrow tone="accent" className="docs-index-eyebrow-spaced">
              Documentation
            </Eyebrow>
            <h1 id="docs-heading" className="docs-index-h1">
              Start building with Threadplane
            </h1>
            <p className="docs-index-subtitle">
              Streaming agent interfaces with runtime adapters, a shared Agent contract,
              and a drop-in chat surface. Every package is MIT-licensed, with optional
              production assurance and delivery services for teams that want expert support.
            </p>
          </div>
        </Container>
      </Section>

      <Section surface="canvas" tight ariaLabelledBy="framework-heading">
        <Container>
          <StepLabel id="framework-heading">Choose your framework</StepLabel>
          <div className="docs-index-grid">
            <Link href="/docs/angular/getting-started/introduction" className="docs-index-card-link">
              <Card padding="lg" hoverable accent><h3 className="docs-index-card-title">Angular</h3>
                <p className="docs-index-card-blurb">Install the published packages and build your first agent interface.</p>
                <span className="docs-index-cta">Start with Angular →</span></Card>
            </Link>
            <Link href="/docs/react/getting-started/introduction" className="docs-index-card-link">
              <Card padding="lg" hoverable accent><h3 className="docs-index-card-title">React</h3>
                <p className="docs-index-card-blurb">Explore the React guides and working examples. The React SDK is currently an unpublished development package.</p>
                <span className="docs-index-cta">Start with React →</span></Card>
            </Link>
          </div>
        </Container>
      </Section>
      {/* Step 1 — backend */}
      <Section surface="canvas" tight ariaLabelledBy="backend-heading">
        <Container>
          <StepLabel id="backend-heading" step={1}>Angular: pick your backend</StepLabel>
          <div className="docs-index-grid">
            {BACKENDS.map((b) => (
              <Link key={b.href} href={b.href} className="docs-index-card-link">
                <Card padding="lg" hoverable accent className="docs-index-fill-height">
                  <div className="docs-index-card-header">
                    <LogoChip src={b.logoSrc} />
                    <div>
                      <h3 className="docs-index-card-title">{b.title}</h3>
                      <div className="docs-index-attribution">{b.attribution}</div>
                    </div>
                  </div>
                  <p className="docs-index-card-blurb">{b.blurb}</p>
                  <div className="docs-index-snippet-row">
                    <code className="docs-index-snippet-code">{b.install}</code>
                    <CopyButton text={b.install} />
                  </div>
                  <span className="docs-index-cta">Adapter quickstart →</span>
                </Card>
              </Link>
            ))}
          </div>
          <p className="docs-index-helper">
            Not sure which to use?{' '}
            <Link href="/docs/choosing-an-adapter" className="docs-index-helper-link">
              Choosing an adapter →
            </Link>
            {' '}Want the drop-in UI first?{' '}
            <Link href="/docs/angular/chat/getting-started/quickstart" className="docs-index-helper-link">
              Chat quickstart →
            </Link>
            {' '}Running a non-LangGraph backend?{' '}
            <Link href="/docs/angular/runtimes/getting-started/introduction" className="docs-index-helper-link">
              Agent runtimes →
            </Link>
            {' '}Building on the Deep Agents framework?{' '}
            <Link href="/docs/angular/deep-agents/getting-started/introduction" className="docs-index-helper-link">
              Deep Agents →
            </Link>
          </p>
        </Container>
      </Section>

      {/* Step 2 — generative UI */}
      <Section surface="canvas" tight ariaLabelledBy="genui-heading">
        <Container>
          <div className="docs-index-divider" />
          <StepLabel id="genui-heading" step={2}>Generative UI</StepLabel>
          <div className="docs-index-grid">
            {GENERATIVE_UI.map((g) => (
              <Link key={g.href} href={g.href} className="docs-index-card-link">
                <Card padding="lg" hoverable accent className="docs-index-fill-height">
                  <div className="docs-index-card-header">
                    <LogoChip src={g.logoSrc} />
                    <div>
                      <h3 className="docs-index-card-title">{g.title}</h3>
                      <div className="docs-index-attribution">{g.attribution}</div>
                    </div>
                  </div>
                  <p className="docs-index-card-blurb">{g.blurb}</p>
                  <span className="docs-index-cta docs-index-cta-block">Get started →</span>
                </Card>
              </Link>
            ))}
          </div>
          <p className="docs-index-helper">
            Which fits my use case?{' '}
            <Link href="/docs/angular/render/concepts/json-render-vs-a2ui" className="docs-index-helper-link">
              json-render vs A2UI →
            </Link>
          </p>
        </Container>
      </Section>

      {/* Step 3 — chat */}
      <Section surface="canvas" tight ariaLabelledBy="chat-heading">
        <Container>
          <div className="docs-index-divider" />
          <StepLabel id="chat-heading" step={3}>Chat UI</StepLabel>
          <Link href="/docs/angular/chat/getting-started/introduction" className="docs-index-card-link">
            <Card padding="lg" hoverable className="docs-index-fill-height">
              <div className="docs-index-card-header">
                <GlyphChip size={30}><ChatGlyph /></GlyphChip>
                <div>
                  <h3 className="docs-index-card-title">Chat</h3>
                  <div className="docs-index-attribution">Threadplane</div>
                </div>
              </div>
              <p className="docs-index-card-blurb">
                Drop-in chat components — message list, input, streaming, tool
                calls, interrupts, subagents. Renders A2UI & json-render surfaces
                inline.
              </p>
            </Card>
          </Link>
        </Container>
      </Section>

      {/* Supporting libraries */}
      <Section surface="canvas" tight ariaLabelledBy="supporting-heading">
        <Container>
          <div className="docs-index-divider" />
          <StepLabel id="supporting-heading">Supporting libraries</StepLabel>
          <div className="docs-index-grid">
            {SUPPORTING.map((s) => {
              const Glyph = GLYPHS[s.glyph];
              return (
                <Link key={s.href} href={s.href} className="docs-index-card-link">
                  <Card padding="lg" hoverable className="docs-index-fill-height">
                    <div className="docs-index-card-header-inline">
                      <GlyphChip size={26}><Glyph /></GlyphChip>
                      <div>
                        <h3 className="docs-index-card-title docs-index-card-title-sm">{s.title}</h3>
                        <p className="docs-index-card-blurb docs-index-card-blurb-sm">{s.blurb}</p>
                      </div>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        </Container>
      </Section>

      {/* Search prompt */}
      <DocsSearchFooter />
      </div>
    </div>
  );
}
