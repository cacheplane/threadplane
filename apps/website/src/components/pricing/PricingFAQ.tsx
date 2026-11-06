import { Container } from '../ui/Container';
import { Section } from '../ui/Section';
import { FAQ, type FAQItem } from '../ui/FAQ';

const ITEMS: FAQItem[] = [
  {
    q: 'Does Threadplane have a cloud service?',
    a: 'No. Threadplane runs inside your application. You operate your application, agent runtime, data stores, hosting, and model-provider accounts.',
  },
  {
    q: 'Does Threadplane store my conversations or agent data?',
    a: 'No hosted Threadplane persistence service is included. The connected runtime and persistence layer determine storage, checkpointing, retention, authorization, and cross-device behavior.',
  },
  {
    q: 'Are model or hosting costs included?',
    a: 'No. Model inference, agent runtime, database, observability, hosting, and other infrastructure charges remain with the providers you select.',
  },
  {
    q: 'What am I paying for?',
    a: 'Paid engagements provide expert support, architecture guidance, response commitments, security and procurement assistance, or hands-on delivery. The software remains MIT-licensed.',
  },
  {
    q: 'What is Production Assurance?',
    a: 'Production Assurance is a scoped support relationship for teams running Threadplane in production. It can include private support, response commitments, architecture reviews, migration guidance, and security assistance.',
  },
  {
    q: 'What is Pilot-to-Prod?',
    a: 'Pilot-to-Prod is a separately scoped delivery engagement for teams that want hands-on help moving an agent experience from prototype to a production-ready implementation.',
  },
];

export function PricingFAQ() {
  return (
    <Section ariaLabelledBy="pricing-faq-heading" className="pricing-questions">
      <Container>
        <div id="faq" className="pricing-faq-header">
          <h2 id="pricing-faq-heading" className="pricing-faq-heading">Pricing FAQ.</h2>
          <p className="pricing-section-body">Yes, really free. Here’s how the rest works.</p>
        </div>
        <div className="pricing-faq-items"><FAQ items={ITEMS} /></div>
      </Container>
    </Section>
  );
}
