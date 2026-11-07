import Image from 'next/image';
import { Container } from '../ui/Container';
import { Section } from '../ui/Section';
import { Button } from '../ui/Button';

/** Decorative abstractions, matching the homepage's quiet skeleton illustrations. */
function ProductSketch({ agent = false }: { agent?: boolean }) {
  if (!agent) {
    return (
      <div
        className="pricing-product-sketch pricing-grid-sketch"
        aria-hidden="true"
      >
        {Array.from({ length: 12 }, (_, index) => (
          <span key={index}>
            <i />
          </span>
        ))}
      </div>
    );
  }
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
            We build the tools, work through the hard parts, and bring that
            experience to your product. Our work is right here in the open.
          </p>
        </div>
        <div className="pricing-proof-grid">
          <article
            className="pricing-proof-card"
            aria-labelledby="pricing-proof-pretable"
          >
            <div className="pricing-product-brand">
              <span className="pricing-pretable-mark" aria-hidden="true" />
              <h3 id="pricing-proof-pretable">pretable</h3>
            </div>
            <p>
              The data side. A React data grid built for live updates, streaming
              AI output, and wrapped text that stays readable as the data moves.
            </p>
            <ProductSketch />
            <Button
              variant="secondary"
              size="lg"
              href="https://pretable.ai/"
              target="_blank"
              rel="noopener noreferrer"
              trailingIcon={<span>↗</span>}
            >
              Explore Pretable
            </Button>
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
            <Button
              variant="secondary"
              size="lg"
              href="https://b4.run/"
              target="_blank"
              rel="noopener noreferrer"
              trailingIcon={<span>↗</span>}
            >
              Explore b4.run
            </Button>
          </article>
        </div>
      </Container>
    </Section>
  );
}
