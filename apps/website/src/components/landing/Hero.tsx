'use client';

import React, { useCallback, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Container } from '../ui/Container';
import { Section } from '../ui/Section';
import { Button } from '../ui/Button';
import { AngularMark, ReactMark } from '../ui/FrameworkMarks';
import { trackCtaClick } from '../../lib/analytics/client';
import {
  HERO_H1_LINES,
  HERO_PRIMARY_LABEL,
  HERO_SECONDARY_HREF,
  HERO_SECONDARY_LABEL,
} from '../../lib/positioning';
import { HeroDemo } from './HeroDemo';
import { InstallDialog } from './InstallDialog';

export function Hero() {
  const [installOpen, setInstallOpen] = useState(false);
  const openInstall = useCallback(() => {
    trackCtaClick({ cta_id: 'hero_install_open', track: 'developer', surface: 'home' });
    setInstallOpen(true);
  }, []);
  const closeInstall = useCallback(() => setInstallOpen(false), []);

  return (
    <Section surface="signal" ariaLabelledBy="hero-heading">
      <Container>
        <div className="hero-stack">
          <h1 id="hero-heading" className="hero-heading">
            {HERO_H1_LINES.map((line, i) => (
              <React.Fragment key={line}>
                {i > 0 ? ' ' : ''}
                <span className={line === '(and free)' ? 'hero-heading-line hero-heading-aside' : 'hero-heading-line'}>{line}</span>
              </React.Fragment>
            ))}
          </h1>
          <div className="hero-cta-row">
            <Button variant="primary" size="lg" onClick={openInstall}>{HERO_PRIMARY_LABEL}</Button>
            <a
              className="hero-text-link"
              href={HERO_SECONDARY_HREF}
              onClick={() => trackCtaClick({ cta_id: 'hero_live_demo', track: 'developer', surface: 'home', destination_url: HERO_SECONDARY_HREF })}
            >
              {HERO_SECONDARY_LABEL}
            </a>
          </div>
          <div className="hero-frameworks" role="group" aria-label="Frameworks and agent integrations">
            <Link className="hero-framework-link" href="/docs/react/getting-started/quickstart" aria-label="React quickstart">
              <ReactMark />
              <span>React</span>
            </Link>
            <Link className="hero-framework-link" href="/docs/langgraph/getting-started/quickstart" aria-label="Angular quickstart">
              <AngularMark />
              <span>Angular</span>
            </Link>
            <Link className="hero-framework-link" href="/langgraph" aria-label="LangGraph integration">
              <Image className="hero-integration-logo" src="/logos/langgraph.svg" width={28} height={28} alt="" aria-hidden="true" />
              <span>LangGraph</span>
            </Link>
            <Link className="hero-framework-link" href="/ag-ui" aria-label="AG-UI integration">
              <Image className="hero-integration-logo" src="/logos/ag-ui.svg" width={16} height={19} alt="" aria-hidden="true" />
              <span>AG-UI</span>
            </Link>
          </div>
          <HeroDemo />
        </div>
      </Container>
      <InstallDialog open={installOpen} onClose={closeInstall} />
    </Section>
  );
}
