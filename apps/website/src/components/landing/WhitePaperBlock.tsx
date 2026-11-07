import type { PublicFormPolicy } from '../../lib/growth/form-policy';
import { Container } from '../ui/Container';
import { Section } from '../ui/Section';
import { Eyebrow } from '../ui/Eyebrow';
import { WhitePaperForm, type WhitepaperId } from './WhitePaperForm';
import { FIELD_REPORT } from '../../lib/field-report';
import { WHITEPAPERS } from '../../lib/whitepapers';

const ROWS = [
  {
    claim: 'Architecture, trade-offs and failure recovery',
    tail: 'practical guidance',
  },
  {
    claim: 'Angular and React implementation examples',
    tail: 'both frameworks',
  },
  {
    claim: 'Primary-source research and explicit API boundaries',
    tail: 'free',
  },
];

interface WhitePaperBlockProps {
  /** Whitepaper variant. Determines PDF path + analytics tag. */
  paper?: WhitepaperId;
  formPolicy: PublicFormPolicy;
}

export function WhitePaperBlock({
  formPolicy,
  paper = 'overview',
}: WhitePaperBlockProps) {
  const publication = WHITEPAPERS[paper];
  return (
    <Section surface="white" id="whitepaper-block" ariaLabelledBy="wp-heading">
      <Container>
        <div className="wp-grid">
          <div>
            <div className="wp-rail">
              <Eyebrow tone="accent" className="wp-eyebrow">
                Field report
              </Eyebrow>
              <span className="wp-rail-line" aria-hidden="true" />
            </div>
            <h2 id="wp-heading" className="wp-heading">
              Build agents people can depend on.
            </h2>
            <div className="wp-rows">
              {ROWS.map((r) => (
                <div key={r.claim} className="wp-row">
                  <p className="wp-row-claim">{r.claim}</p>
                  <p className="wp-row-tail">{r.tail}</p>
                </div>
              ))}
            </div>

            <WhitePaperForm
              paper={paper}
              formPolicy={formPolicy}
              surface="home_whitepaper"
              sourceSection="whitepaper-block"
              idPrefix={`wp-${paper}`}
            />
          </div>

          {/* Tilted whitepaper cover */}
          <div className="wp-cover-wrap" aria-hidden="true">
            <div className="wp-paper">
              <div>
                <div className="wp-cover-badge">
                  Field report
                  {paper === 'overview' ? ` · ${FIELD_REPORT.pages} pages` : ''}
                </div>
                <div className="wp-cover-title">{publication.title}</div>
                <div className="wp-cover-desc">{publication.subtitle}</div>
              </div>
              <div className="wp-cover-footer">Threadplane</div>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}
