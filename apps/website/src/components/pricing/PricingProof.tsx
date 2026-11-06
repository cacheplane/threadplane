import Image from 'next/image';
import { Container } from '../ui/Container';
import { Section } from '../ui/Section';

/** Decorative abstractions, matching the homepage's quiet skeleton illustrations. */
function ProductSketch({ agent = false }: { agent?: boolean }) {
  return (
    <div
      className={`pricing-product-sketch ${
        agent ? 'pricing-product-sketch-agent' : ''
      }`}
      aria-hidden="true"
    >
      <div className="pricing-sketch-sidebar">
        <i />
        <i />
        <i />
      </div>
      <div className="pricing-sketch-main">
        <div className="pricing-sketch-lines">
          <i />
          <i />
        </div>
        <div className="pricing-sketch-tools">
          <span />
          <span />
          <span />
        </div>
        <div className="pricing-sketch-lines">
          <i />
          <i />
        </div>
      </div>
    </div>
  );
}

export function PricingProof() {
  return (
    <Section ariaLabelledBy="pricing-proof-heading">
      <Container>
        <div className="pricing-editorial-heading">
          <h2 id="pricing-proof-heading">We build this stuff.</h2>
          <p>
            We’re LiveLoveApp. We build the tools, work through the hard parts,
            and bring that experience to your product. Our work is right here in
            the open.
          </p>
          <a
            className="pricing-text-link"
            href="https://liveloveapp.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Meet LiveLoveApp <span aria-hidden="true">↗</span>
          </a>
        </div>
        <div className="pricing-proof-grid">
          <article
            className="pricing-proof-card"
            aria-labelledby="pricing-proof-threadplane"
          >
            <div className="pricing-product-brand">
              <Image src="/brand/mark.svg" alt="" width={32} height={32} />
              <h3 id="pricing-proof-threadplane">threadplane</h3>
            </div>
            <p>
              The UI side. Threads, approvals, tools, and generative interfaces
              that make agents usable in your product.
            </p>
            <ProductSketch />
            <a className="pricing-text-link" href="/docs">
              Explore Threadplane <span aria-hidden="true">→</span>
            </a>
          </article>
          <article
            className="pricing-proof-card"
            aria-labelledby="pricing-proof-b4"
          >
            <div className="pricing-product-brand">
              <h3 id="pricing-proof-b4">
                <Image
                  src="/logos/b4-wordmark.svg"
                  alt="b4.run"
                  width={145}
                  height={32}
                />
              </h3>
            </div>
            <p>
              The agent side. A TypeScript framework on LangGraph.js for typed
              tools, planning, memory, and evals.
            </p>
            <ProductSketch agent />
            <a
              className="pricing-text-link"
              href="https://b4.run/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Explore b4.run <span aria-hidden="true">↗</span>
            </a>
          </article>
        </div>
      </Container>
    </Section>
  );
}
