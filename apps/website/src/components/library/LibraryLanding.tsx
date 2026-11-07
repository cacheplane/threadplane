import type { ReactNode } from 'react';
import { Container } from '../ui/Container';
import { Section } from '../ui/Section';
import { Button } from '../ui/Button';
import { AngularMark, ReactMark } from '../ui/FrameworkMarks';
import { MediumSwitcher, type MediumPane } from '../landing/MediumSwitcher';
import { WhitePaperForm, type WhitepaperId } from '../landing/WhitePaperForm';
import {
  CapabilityIllustration,
  type Capability,
} from '../landing/CapabilityIllustration';
import { LibrarySketch } from './LibrarySketch';
import type { PublicFormPolicy } from '../../lib/growth/form-policy';
import '../../styles/libraries.css';

export interface LibraryFeature {
  id: string;
  title: string;
  body: string;
  points: string[];
  illustration: Capability | 'components' | 'connections';
  takeaway: string;
}

interface LibraryLandingProps {
  name: string;
  slug: string;
  headline: ReactNode;
  description: string;
  reactDocs: string;
  angularDocs: string;
  features: LibraryFeature[];
  panes: MediumPane[];
  code?: ReactNode;
  technicalNote: string;
  demoHref: string;
  guideHref: string;
  guideLabel: string;
  paper: WhitepaperId;
  formPolicy: PublicFormPolicy;
}

/** A shared editorial shell; examples, forms, and analytics retain their own behavior. */
export function LibraryLanding({
  name,
  slug,
  headline,
  description,
  reactDocs,
  angularDocs,
  features,
  panes,
  code,
  technicalNote,
  demoHref,
  guideHref,
  guideLabel,
  paper,
  formPolicy,
}: LibraryLandingProps) {
  return (
    <div className="library-page">
      <Section className="library-hero" ariaLabelledBy={`${slug}-hero-heading`}>
        <Container>
          <h1 id={`${slug}-hero-heading`}>{headline}</h1>
          <p>{description}</p>
          <div
            className="library-frameworks"
            role="group"
            aria-label={`${name} framework documentation`}
          >
            <Button
              variant="primary"
              size="lg"
              href={reactDocs}
              leadingIcon={<ReactMark />}
            >
              React docs
            </Button>
            <Button
              variant="secondary"
              size="lg"
              href={angularDocs}
              leadingIcon={<AngularMark />}
            >
              Angular docs
            </Button>
          </div>
          <p className="library-framework-note">
            React guides cover the current source-build integration.
          </p>
        </Container>
      </Section>

      <Section aria-label={`${name} capabilities`}>
        <Container>
          <div className="library-features">
            {features.map((feature) => (
              <article
                className="library-feature"
                key={feature.id}
                id={feature.id}
                aria-labelledby={`${feature.id}-heading`}
              >
                <div className="library-feature-copy">
                  <h2 id={`${feature.id}-heading`}>{feature.title}</h2>
                  <p>{feature.body}</p>
                  <ul>
                    {feature.points.map((point) => (
                      <li key={point}>
                        <span aria-hidden="true">✓</span>
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="library-feature-art">
                  <div aria-hidden="true">
                    {feature.illustration === 'components' ||
                    feature.illustration === 'connections' ? (
                      <LibrarySketch kind={feature.illustration} />
                    ) : (
                      <CapabilityIllustration
                        capability={feature.illustration}
                      />
                    )}
                  </div>
                  <p>{feature.takeaway}</p>
                </div>
              </article>
            ))}
          </div>
        </Container>
      </Section>

      <Section id="in-practice" ariaLabelledBy="library-practice-heading">
        <Container>
          <header className="library-section-heading">
            <h2 id="library-practice-heading">See how it fits.</h2>
            <p>{technicalNote}</p>
          </header>
          <div className="library-demo-grid">
            <div className="library-demo">
              <MediumSwitcher sectionId={`lib-${slug}`} panes={panes} />
            </div>
            <aside
              className="library-guides"
              aria-label="Explore the implementation"
            >
              <div>
                <h3>Take the controls.</h3>
                <p>
                  Explore the working example in the docs, with the
                  implementation close at hand.
                </p>
                <Button variant="secondary" href={demoHref}>
                  See it live <span aria-hidden="true">↗</span>
                </Button>
              </div>
              <div>
                <h3>Go a little deeper.</h3>
                <p>
                  Trace the integration choices before you wire them into your
                  own application.
                </p>
                <Button variant="secondary" href={guideHref}>
                  {guideLabel}
                  <span aria-hidden="true">↗</span>
                </Button>
              </div>
            </aside>
          </div>
          {code ? (
            <details
              className="library-code-examples"
              aria-label="Angular implementation examples"
            >
              <summary>Explore the Angular code</summary>
              <div>{code}</div>
            </details>
          ) : null}
        </Container>
      </Section>

      <Section id="whitepaper-block" ariaLabelledBy="wp-heading">
        <Container>
          <div className="library-report">
            <div>
              <h2 id="wp-heading">A little ground school.</h2>
              <p>
                Our Angular field report walks through six production-readiness
                dimensions: streaming, persistence, tool calls, approvals,
                generative UI, and testing.
              </p>
            </div>
            <div className="library-report-form">
              <WhitePaperForm
                paper={paper}
                formPolicy={formPolicy}
                surface="home_whitepaper"
                sourceSection="whitepaper-block"
                idPrefix={`wp-${paper}`}
              />
            </div>
          </div>
        </Container>
      </Section>
    </div>
  );
}
