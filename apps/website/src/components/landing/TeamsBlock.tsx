'use client';

import type { PublicFormPolicy } from '../../lib/growth/form-policy';
import { Container } from '../ui/Container';
import { Section } from '../ui/Section';
import { trackCtaClick } from '../../lib/analytics/client';
import { WhitePaperForm } from './WhitePaperForm';
import { FieldReportCover } from './FieldReportCover';
import { FIELD_REPORT } from '../../lib/field-report';

/**
 * For teams: the field report is the ask, contact is the follow-up.
 *
 * The previous version inverted its own goals — the form sat at y=618 in a
 * 916px section, below a four-step pilot timeline that `/pilot-to-prod`
 * already covers in full, while a same-weight amber button sent people to
 * contact instead. The timeline and the outcome rows are gone, the form sits
 * beside a preview of the actual document, and contact is a link.
 *
 * Everything the section says about the report reads from FIELD_REPORT, which
 * is pinned to the PDF — this block previously advertised a page count and a
 * contents list that the file did not match.
 */
export function TeamsBlock({ formPolicy }: { formPolicy: PublicFormPolicy }) {
  return (
    <Section id="teams" ariaLabelledBy="field-report-heading" className="home-section home-report">
      <Container>
        <div className="teams-grid">
          <div>
            <h2 id="field-report-heading" className="teams-heading">
              Free preflight briefing for agentic UI
            </h2>
            <p className="home-report-description">What breaks between a demo and production—and how to prepare. A {FIELD_REPORT.pages}-page field report for teams building agent interfaces with Angular.</p>
            <WhitePaperForm
              paper="overview"
              formPolicy={formPolicy}
              surface="home_whitepaper"
              sourceSection="teams-block"
              idPrefix="teams-wp"
            />
          </div>
          <FieldReportCover />
        </div>

        <div className="teams-contact">
          <p className="teams-contact-copy">
            Shipping inside a large platform? Bring your backend, security
            model, and design system.
          </p>
          <a
            className="teams-contact-link"
            href="/contact?source=home_enterprise&track=enterprise"
            onClick={() =>
              trackCtaClick({
                cta_id: 'hero_talk_to_engineers',
                track: 'enterprise',
                surface: 'home',
              })
            }
          >
            Talk to an engineer <span aria-hidden="true">→</span>
          </a>
        </div>
      </Container>
    </Section>
  );
}
