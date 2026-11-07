import { Container } from '../../components/ui/Container';
import { Section } from '../../components/ui/Section';
import { Button } from '../../components/ui/Button';
import '../../styles/editorial.css';
import { JsonLd } from '../../components/shared/JsonLd';
import { aboutPageJsonLd, REPOSITORY_URL } from '../../lib/structured-data';
import { getAuthor } from '../../lib/blog-authors';
import { createPageMetadata } from '../../lib/site-metadata';
import { LONG_SUBHEAD } from '../../lib/positioning';
import {
  ABOUT_HISTORY,
  ABOUT_HISTORY_HEADING,
  ABOUT_INTRO,
  ABOUT_PERSONAL,
  ABOUT_PRINCIPLES,
} from '../../lib/about-content';

/**
 * The single author record the site already publishes (blog bylines read the
 * same object), so the Person node and every BlogPosting byline state one name
 * and one role rather than two that happen to agree.
 */
const author = getAuthor('brian');

export const metadata = createPageMetadata({
  title: 'About — Threadplane',
  description: `Who writes Threadplane: ${author.name}, ${author.role}. ${author.bio}`,
  pathname: '/about',
  type: 'website',
});

export default function AboutPage() {
  return (
    <div className="editorial-page about-page">
      <JsonLd data={aboutPageJsonLd(author)} />
      <Section ariaLabelledBy="about-heading" className="about-story-section">
        <Container>
          <header className="editorial-hero">
            <h1 id="about-heading">
              Behind the
              <br />
              threadplane.
            </h1>
          </header>
          <div className="about-story-grid" data-about-biography>
            <aside className="about-author" aria-label="About the author">
              <h2>{author.name}</h2>
              <p>{author.role}</p>
              <Button
                variant="secondary"
                href={`https://github.com/${author.github}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                github.com/{author.github}
                <span aria-hidden="true"> ↗</span>
              </Button>
            </aside>
            <div className="about-story">
              <p className="about-intro">{ABOUT_INTRO}</p>
              <h2>{ABOUT_HISTORY_HEADING}</h2>
              {ABOUT_HISTORY.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              <div className="about-principles">
                <p>{ABOUT_PRINCIPLES}</p>
              </div>
              <p>{ABOUT_PERSONAL}</p>
            </div>
          </div>
        </Container>
      </Section>
      <Section aria-label="The project and the people behind it">
        <Container>
          <div className="about-product-grid">
            <div>
              <h2>
                A UI layer.
                <br />
                Your architecture.
              </h2>
              <p>{LONG_SUBHEAD}</p>
              <Button
                variant="secondary"
                href={REPOSITORY_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Explore the source<span aria-hidden="true"> ↗</span>
              </Button>
            </div>
            <div>
              <h2>
                Free code.
                <br />
                Very good people.
              </h2>
              <p>
                Every published Threadplane package is MIT-licensed for
                commercial and noncommercial use. Production Assurance and
                enterprise delivery add expert support without changing the
                software.
              </p>
              <Button variant="secondary" href="/pricing">
                Meet the services<span aria-hidden="true"> ↗</span>
              </Button>
            </div>
          </div>
        </Container>
      </Section>
      <Section ariaLabelledBy="about-contact-heading">
        <Container>
          <div className="editorial-closing">
            <h2 id="about-contact-heading">What are you building?</h2>
            <p>
              Bring the product, the prototype, or the part that keeps you up at
              night. Let’s work out what comes next.
            </p>
            <div className="editorial-actions">
              <Button variant="primary" size="lg" href="/contact">
                Talk to us
              </Button>
              <Button variant="secondary" size="lg" href="/blog">
                Read the latest
              </Button>
            </div>
          </div>
        </Container>
      </Section>
    </div>
  );
}
