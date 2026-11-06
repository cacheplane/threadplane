'use client';

import { Container } from '../ui/Container';
import { Section } from '../ui/Section';
import { Button } from '../ui/Button';
import { trackCtaClick } from '../../lib/analytics/client';
import type { CtaId } from '../../lib/analytics/events';

const SERVICES: readonly {
  id: string;
  title: string;
  promise: string;
  description: string;
  features: readonly string[];
  action: string;
  ctaId: CtaId;
}[] = [
  {
    id: 'assurance',
    title: 'Production Assurance',
    promise: 'A second set of expert eyes.',
    description:
      'You own the product. Get the people who build Threadplane in your corner when the decisions get difficult.',
    features: [
      'Architecture and implementation reviews',
      'Private support with scoped response commitments',
      'Upgrade, migration, and security guidance',
    ],
    action: 'Discuss assurance',
    ctaId: 'pricing_tier_production_assurance',
  },
  {
    id: 'pilot',
    title: 'Pilot-to-Prod',
    promise: 'Clear the runway. Ship it.',
    description:
      'Your demo made the room nod. Now let’s make it hold up when real users, real data, and real failure modes arrive.',
    features: [
      'A focused plan from prototype to launch',
      'Implementation, evals, and release readiness',
      'Deployment and a handoff your team can own',
    ],
    action: 'Plan a launch',
    ctaId: 'pricing_tier_enterprise',
  },
  {
    id: 'build',
    title: 'Agent builds & integrations',
    promise: 'From agent to actual product.',
    description:
      'Bring the hard part. We connect your agents, tools, data, and interface, then help get the whole thing deployed.',
    features: [
      'Custom agents, tools, and workflows',
      'Product UI, design-system, and backend integration',
      'Deployment in the infrastructure you choose',
    ],
    action: 'Build with us',
    ctaId: 'pricing_tier_enterprise',
  },
];

export function PricingServices() {
  return (
    <Section id="services" ariaLabelledBy="pricing-services-heading">
      <Container>
        <div className="pricing-editorial-heading">
          <h2 id="pricing-services-heading">Free code. Very good people.</h2>
          <p>The framework is on us. The expertise is what you hire us for.</p>
        </div>
        <div className="pricing-service-grid">
          {SERVICES.map((service) => {
            const href = `/contact?intent=enterprise&entry=${service.ctaId}`;
            return (
              <article
                className="pricing-service-card"
                key={service.id}
                aria-labelledby={`service-${service.id}`}
              >
                <h3 id={`service-${service.id}`}>{service.title}</h3>
                <p className="pricing-service-promise">{service.promise}</p>
                <p className="pricing-service-description">
                  {service.description}
                </p>
                <ul>
                  {service.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <div className="pricing-service-action">
                  <Button
                    href={href}
                    variant="secondary"
                    size="lg"
                    onClick={() =>
                      trackCtaClick({
                        surface: 'pricing',
                        destination_url: href,
                        cta_id: service.ctaId,
                        cta_text: service.action,
                      })
                    }
                  >
                    {service.action}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
        <p className="pricing-scope-note">
          Every engagement is custom-priced and scoped with you. Support and
          delivery can be hired separately.
        </p>
      </Container>
    </Section>
  );
}
