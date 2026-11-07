'use client';
import { Container } from '../ui/Container';
import { Section } from '../ui/Section';
import { Button } from '../ui/Button';
import { GitHubIcon } from '../ui/GitHubIcon';
import { GITHUB_REPO_URL } from '../../lib/positioning';
import { trackCtaClick } from '../../lib/analytics/client';

export function HomeOwnership() {
  return (
    <Section
      id="open-source"
      ariaLabelledBy="open-source-heading"
      className="home-section"
    >
      <Container>
        <div className="home-ownership">
          <div>
            <h2 id="open-source-heading">
              Steal our source code.
            </h2>
            <p>
              MIT-licensed packages. Source you can inspect, change, and ship.
              Run Threadplane in your application against the backend you host.
            </p>
            <Button
              variant="primary"
              size="lg"
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              leadingIcon={<GitHubIcon />}
              onClick={() =>
                trackCtaClick({
                  cta_id: 'hero_github',
                  track: 'developer',
                  surface: 'home',
                  destination_url: GITHUB_REPO_URL,
                })
              }
            >
              Explore on GitHub
            </Button>
          </div>
          <ul className="home-ownership-list">
            <li>
              <h3>Open from the start.</h3>
              <p>Every package is MIT licensed, including production use.</p>
            </li>
            <li>
              <h3>Your infrastructure.</h3>
              <p>No Threadplane-hosted service or account required.</p>
            </li>
            <li>
              <h3>Help when you need it.</h3>
              <p>
                Build independently, or{' '}
                <a href="/pricing">work with our team</a> for production
                support.
              </p>
            </li>
          </ul>
        </div>
      </Container>
    </Section>
  );
}
