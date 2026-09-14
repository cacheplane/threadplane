import React, { Suspense } from 'react';
import { Container } from '../../components/ui/Container';
import { Section } from '../../components/ui/Section';
import { Eyebrow } from '../../components/ui/Eyebrow';
import { FormCard } from '../../components/form';
import { ContactForm, type ContactIntent } from '../../components/contact/ContactForm';
import { GitHubStarsPill } from '../../components/contact/GitHubStarsPill';
import { createPageMetadata } from '../../lib/site-metadata';
import { getFormPolicy } from '../../lib/growth/form-policy';

export const metadata = createPageMetadata({
  title: 'Talk to an engineer — Threadplane',
  description: 'Tell us what you are shipping. We reply within one business day, usually with code, not a calendar invite.',
  pathname: '/contact',
  type: 'website',
});

// Entry points are analytics keys: lowercase snake_case, e.g. pricing_tier_enterprise. Anything else is dropped.
const ENTRY_POINT = /^[a-z0-9_]{1,64}$/u;

function readIntent(value: string | undefined): ContactIntent {
  return value === 'enterprise' ? 'enterprise' : 'contact';
}

function readEntryPoint(value: string | undefined): string | undefined {
  return value && ENTRY_POINT.test(value) ? value : undefined;
}

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string; entry?: string }>;
}) {
  const params = await searchParams;
  const intent = readIntent(params.intent);
  const entryPoint = readEntryPoint(params.entry);
  const formPolicy = getFormPolicy();
  return (
    <Section surface="tinted" ariaLabelledBy="contact-heading">
      <Container>
        <div className="contact-band">
          <div>
            <Eyebrow tone="accent" className="contact-band-eyebrow">
              {intent === 'enterprise' ? 'Enterprise' : 'Contact'}
            </Eyebrow>
            <h1 id="contact-heading" className="contact-page-h1">
              Talk to an engineer.
            </h1>
            <p className="contact-band-lede">
              Tell us what you are shipping. We reply within one business day, usually with code, not a calendar invite.
            </p>
            <p className="contact-band-note">
              Brian or someone on the team replies personally, from a real inbox, not <code>noreply@</code>. We read every message.
            </p>
            <div className="contact-band-channels">
              <Eyebrow tone="muted">Prefer not to use a form</Eyebrow>
              <div className="contact-chips">
                <a className="contact-chip" href="mailto:brian@threadplane.ai">brian@threadplane.ai</a>
                <a className="contact-chip" href="https://github.com/cacheplane/threadplane/issues">GitHub issues</a>
                <a className="contact-chip" href="https://discord.gg/cacheplane">Discord</a>
              </div>
              <Suspense fallback={null}>
                <GitHubStarsPill />
              </Suspense>
            </div>
          </div>
          <FormCard>
            <ContactForm formPolicy={formPolicy} intent={intent} entryPoint={entryPoint} />
          </FormCard>
        </div>
      </Container>
    </Section>
  );
}
