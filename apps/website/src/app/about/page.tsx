import Link from 'next/link';
import { Container } from '../../components/ui/Container';
import { Section } from '../../components/ui/Section';
import { Eyebrow } from '../../components/ui/Eyebrow';
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
    <>
      <JsonLd data={aboutPageJsonLd(author)} />

      <Section surface="canvas" ariaLabelledBy="about-heading">
        <Container>
          <div className="about-section-inner">
            <Eyebrow tone="accent" className="about-eyebrow-spaced">About</Eyebrow>
            <h1 id="about-heading" className="about-h1">
              Who writes Threadplane
            </h1>
            <p className="about-body">{ABOUT_INTRO}</p>

            <h2 className="about-h2 about-h2-spaced">{ABOUT_HISTORY_HEADING}</h2>
            {ABOUT_HISTORY.map((paragraph) => (
              <p key={paragraph} className="about-body">
                {paragraph}
              </p>
            ))}

            <p className="about-body">{ABOUT_PRINCIPLES}</p>
            <p className="about-body">{ABOUT_PERSONAL}</p>

            <p className="about-body about-body-last">
              <a
                href={`https://github.com/${author.github}`}
                target="_blank"
                rel="noopener noreferrer"
                className="about-link"
              >
                github.com/{author.github}
              </a>
            </p>
          </div>
        </Container>
      </Section>

      <Section surface="tinted">
        <Container>
          <div className="about-section-inner">
            <h2 className="about-h2">What Threadplane is</h2>
            <p className="about-body">{LONG_SUBHEAD}</p>
            <p className="about-body about-body-last">
              The source is public at{' '}
              <a href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer" className="about-link">
                github.com/cacheplane/threadplane
              </a>
              .
            </p>
          </div>
        </Container>
      </Section>

      <Section surface="canvas">
        <Container>
          <div className="about-section-inner">
            <h2 className="about-h2">Open software, supported production</h2>
            <p className="about-body">
              Every published Threadplane package is MIT-licensed for commercial
              and noncommercial use. Production Assurance and enterprise delivery
              add expert support without changing the software. The{' '}
              <Link href="/pricing" className="about-link">pricing page</Link> has the details.
            </p>
            <p className="about-body about-body-last">
              Questions about a specific build go to{' '}
              <Link href="/contact" className="about-link">
                contact
              </Link>
              ; ongoing writing is on the <Link href="/blog" className="about-link">blog</Link>.
            </p>
          </div>
        </Container>
      </Section>
    </>
  );
}
