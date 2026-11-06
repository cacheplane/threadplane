import { Container } from '../../components/ui/Container';
import { Section } from '../../components/ui/Section';
import { PricingSourceButton } from '../../components/pricing/PricingSourceButton';
import { PricingServices } from '../../components/pricing/PricingServices';
import { PricingProof } from '../../components/pricing/PricingProof';
import { PricingComparison } from '../../components/pricing/PricingDetails';
import { PricingFAQ } from '../../components/pricing/PricingFAQ';
import { EnterpriseCtaBand } from '../../components/pricing/EnterpriseCtaBand';
import { createPageMetadata } from '../../lib/site-metadata';
import '../../styles/pricing.css';

export const metadata = createPageMetadata({
  title: 'Pricing — Threadplane',
  description:
    'Every Threadplane package is MIT-licensed. Hire LiveLoveApp for Production Assurance, Pilot-to-Prod, and agent builds and integrations in your own stack.',
  pathname: '/pricing',
  type: 'website',
});

export default function PricingPage() {
  return (
    <div className="pricing-page">
      <Section ariaLabelledBy="pricing-heading" className="pricing-hero">
        <Container>
          <div className="pricing-page-hero-inner">
            <h1 id="pricing-heading" className="pricing-page-h1">
              Made you look!
            </h1>
            <p className="pricing-hero-punchline">It’s free. All of it.</p>
            <p className="pricing-page-subtitle">
              We gave away the framework. Forgot to build a cloud to lock you
              into. Honestly, we should have thought this through.
            </p>
          </div>
        </Container>
      </Section>

      <PricingServices />

      <Section ariaLabelledBy="pricing-source-heading">
        <Container>
          <div className="pricing-source">
            <div>
              <h2 id="pricing-source-heading">Steal our source code.</h2>
              <p>
                Legally, please. Every package is MIT licensed. Use Threadplane
                in commercial products, internal tools, and client work. Fork
                it. Change it. Ship it. Keep the license notice.
              </p>
              <PricingSourceButton />
            </div>
            <ul className="pricing-source-list">
              <li>
                <h3>The whole framework. $0.</h3>
                <p>
                  All packages and capabilities. Free for commercial and
                  noncommercial use.
                </p>
              </li>
              <li>
                <h3>No Threadplane cloud.</h3>
                <p>
                  Your application, your agents, your infrastructure. No account
                  or activation required.
                </p>
              </li>
              <li>
                <h3>Your product stays yours.</h3>
                <p>
                  Build independently. Bring us in when you want expertise,
                  support, or another pair of hands.
                </p>
              </li>
            </ul>
          </div>
        </Container>
      </Section>

      <PricingProof />

      <Section ariaLabelledBy="pricing-comparison-heading">
        <Container>
          <PricingComparison />
        </Container>
      </Section>

      <PricingFAQ />

      <EnterpriseCtaBand />
    </div>
  );
}
