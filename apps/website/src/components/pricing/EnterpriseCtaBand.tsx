'use client';
import { Container } from '../ui/Container';
import { Section } from '../ui/Section';
import { Button } from '../ui/Button';
import { trackCtaClick } from '../../lib/analytics/client';

const HREF = '/contact?intent=enterprise&entry=pricing_enterprise_band';

export function EnterpriseCtaBand() {
  return (
    <Section id="enterprise" ariaLabelledBy="enterprise-band-heading">
      <Container>
        <div className="enterprise-band">
          <h2 id="enterprise-band-heading" className="enterprise-band-heading">
            Good at code. Questionable at charging for it.
          </h2>
          <p className="enterprise-band-lede">
            Take the framework. Hire the team. Tell us what you’re building,
            where you’re stuck, and what needs to ship. We’ll scope the work together.
          </p>
          <Button
            href={HREF}
            variant="primary"
            size="lg"
            onClick={() =>
              trackCtaClick({
                surface: 'pricing',
                destination_url: HREF,
                cta_id: 'pricing_enterprise_band',
                cta_text: 'Request a conversation',
              })
            }
          >
            Request a conversation
          </Button>
        </div>
      </Container>
    </Section>
  );
}
