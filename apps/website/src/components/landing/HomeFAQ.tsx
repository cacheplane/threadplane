import { Container } from '../ui/Container';
import { Section } from '../ui/Section';
import { FAQ, type FAQItem } from '../ui/FAQ';

// Five questions the page above does not answer (live-stage spec §3; the
// runtime one from spec 2026-09-11). Copy here
// is scanned by lib/public-copy-contract.ts: absolute claims ("installation is
// inert") and retired routes (/docs/telemetry/**) are barred — a previous FAQ
// answer shipped both and only the production crawl caught it.
const ITEMS: FAQItem[] = [
  {
    q: 'Is Threadplane a backend agent framework?',
    a: (
      <>
        No. Threadplane is the UI layer. Your agent runs in LangGraph, in an
        AG-UI-compatible runtime, or in your own service.{' '}
        <a href="/docs/choosing-an-adapter">Choosing an adapter</a>
      </>
    ),
  },
  {
    q: 'Can I use my existing component library and design system?',
    a: (
      <>
        Yes. Keep your components and style the interface to match your application.
        For Angular, generated UI renders components you register. <a href="/render">Generated UI</a>
      </>
    ),
  },
  {
    q: 'Does generated UI execute arbitrary code?',
    a: (
      <>
        No. The agent emits constrained structured output that is validated against a schema, and
        Angular renders registered components with a per-component fallback.{' '}
        <a href="/docs/angular/render/concepts/json-render-vs-a2ui">json-render and A2UI</a>
      </>
    ),
  },
  {
    q: 'Does Threadplane require a hosted service or an account?',
    a: (
      <>
        No. Every package is MIT and runs inside your application against a backend you
        host. <a href="/pricing">Pricing</a>
      </>
    ),
  },
  {
    q: 'Does Threadplane have a runtime I need to deploy?',
    a: (
      <>
        No. The adapters call your LangGraph or AG-UI server from the browser. There is no
        Threadplane server in the request path, no key, and no production tier.{' '}
        <a href="/docs/choosing-an-adapter">How it is wired</a>
      </>
    ),
  },
];

export function HomeFAQ() {
  return (
    <Section id="questions" ariaLabelledBy="faq-heading" className="home-section home-questions">
      <Container>
        <div className="home-faq-intro home-section-heading">
          <h2 id="faq-heading" className="home-faq-heading">
            A few things<br />worth knowing.
          </h2>
          <p>From the first integration to production.</p>
        </div>
        <div className="home-faq-body">
          <FAQ items={ITEMS} />
        </div>
      </Container>
    </Section>
  );
}
