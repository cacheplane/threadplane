'use client';

import { Container } from '../ui/Container';
import { Section } from '../ui/Section';
import { Button } from '../ui/Button';
import { DemoCtaPair } from './DemoCtaPair';
import { trackCtaClick } from '../../lib/analytics/client';
import type { CtaId } from '../../lib/analytics/events';

interface FinalCTAProps {
  /** Headline. Defaults to the product closer. */
  headline?: string;
  /** Sub-headline. Defaults to the homepage closer. */
  subtext?: string;
  /** Override CTA. When omitted, renders the LangGraph + AG-UI demo pair. */
  primary?: { label: string; href: string; external?: boolean; ctaId?: CtaId } | null;
  /** Optional secondary CTA. Defaults to the live Website workspace. */
  secondary?: { label: string; href: string; external?: boolean; ctaId?: CtaId } | null;
  /**
   * Optional trailing caption. There is no default: the old
   * "Installation is inert" promise line was retired with the promises
   * section (#980), so a caption only appears where a caller passes one.
   */
  caption?: string | null;
  /** Optional link rendered after the caption text (e.g. "Talk to an engineer"). */
  captionLink?: { label: string; href: string } | null;
  /** Further caption links, rendered after `captionLink`. */
  captionLinks?: readonly { label: string; href: string }[];
  /**
   * 'dark' renders on the dark band. Rule (amended 2026-08-31): dark closes
   * PRODUCT pages — the homepage and the four library pages. Commerce pages
   * keep the default tinted surface.
   */
  variant?: 'default' | 'dark';
}

const DEFAULT_SECONDARY = {
  label: 'See each feature in action →',
  href: '/docs/angular/langgraph/guides/streaming?mode=run',
};

export function FinalCTA({
  headline = 'Stop stalling on agentic Angular.',
  subtext = 'Install the framework, read the docs, and have a streaming chat in your app this afternoon.',
  primary = null,
  secondary = DEFAULT_SECONDARY,
  caption = null,
  captionLink = null,
  captionLinks = [],
  variant = 'default',
}: FinalCTAProps = {}) {
  return (
    <Section
      surface={variant === 'dark' ? 'dark' : 'tinted'}
      className={variant === 'dark' ? 'final-cta-dark' : undefined}
      ariaLabelledBy="final-cta-heading"
    >
      <Container>
        <div className="final-cta-inner">
          {variant === 'dark' ? (
            <div className="final-cta-mark" aria-hidden="true">
              →
            </div>
          ) : null}
          <h2 id="final-cta-heading" className="final-cta-heading">
            {headline}
          </h2>
          <p className="final-cta-subtext">
            {subtext}
          </p>
          <div className="final-cta-row">
            {primary ? (
              <Button
                variant="primary"
                size="lg"
                href={primary.href}
                onClick={
                  primary.ctaId
                    ? () =>
                        trackCtaClick({
                          cta_id: primary.ctaId,
                          track: 'developer',
                          surface: 'final_cta',
                          destination_url: primary.href,
                        })
                    : undefined
                }
                {...((primary as { external?: boolean }).external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              >
                {primary.label}
              </Button>
            ) : (
              <DemoCtaPair surface="final_cta" size="lg" />
            )}
            {secondary ? (
              <Button
                variant="ghost"
                size="lg"
                href={secondary.href}
                onClick={
                  secondary.ctaId
                    ? () =>
                        trackCtaClick({
                          cta_id: secondary.ctaId,
                          track: 'developer',
                          surface: 'final_cta',
                          destination_url: secondary.href,
                        })
                    : undefined
                }
                {...(secondary.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              >
                {secondary.label}
              </Button>
            ) : null}
          </div>
          {caption || captionLink || captionLinks.length > 0 ? (
            <p className="final-cta-caption">
              {caption}
              {captionLink ? (
                <>
                  {caption ? ' · ' : null}
                  <a href={captionLink.href}>{captionLink.label}</a>
                </>
              ) : null}
              {captionLinks.map((link, i) => (
                <span key={link.href}>
                  {caption || captionLink || i > 0 ? ' · ' : null}
                  <a href={link.href}>{link.label}</a>
                </span>
              ))}
            </p>
          ) : null}
        </div>
      </Container>
    </Section>
  );
}
