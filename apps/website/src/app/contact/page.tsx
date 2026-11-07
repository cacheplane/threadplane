import { Container } from '../../components/ui/Container';
import { Section } from '../../components/ui/Section';
import { Button } from '../../components/ui/Button';
import { FormCard } from '../../components/form';
import {
  ContactForm,
  type ContactIntent,
} from '../../components/contact/ContactForm';
import { createPageMetadata } from '../../lib/site-metadata';
import { getFormPolicy } from '../../lib/growth/form-policy';
import '../../styles/services.css';

export const metadata = createPageMetadata({
  title: 'Talk to an engineer — Threadplane',
  description:
    'Tell us what you are shipping. We reply within one business day, usually with code, not a calendar invite.',
  pathname: '/contact',
  type: 'website',
});

// Entry points are analytics keys: lowercase snake_case. Drop anything else.
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
  return (
    <div className="services-page contact-page">
      <Section ariaLabelledBy="contact-heading" className="services-hero">
        <Container>
          <div className="services-hero-copy">
            <h1 id="contact-heading">Talk to an engineer.</h1>
            <p>
              Bring the product, the prototype, or the problem you’re still
              working through. Let’s figure out what comes next.
            </p>
          </div>
        </Container>
      </Section>
      <Section aria-label="Start a conversation">
        <Container>
          <div className="contact-editorial-grid">
            <FormCard className="contact-editorial-form">
              <h2 id="contact-form-heading">
                {intent === 'enterprise'
                  ? 'Let’s scope the work.'
                  : 'What are you building?'}
              </h2>
              <p className="contact-form-intro">
                A little context now makes the first conversation more useful.
              </p>
              <ContactForm
                formPolicy={getFormPolicy()}
                intent={intent}
                entryPoint={entryPoint}
              />
            </FormCard>
            <div className="contact-editorial-copy">
              <h2>
                Start with
                <br />
                the hard part.
              </h2>
              <p>
                Product assurance, a pilot headed for production, or an agent
                that needs to fit your stack. Tell us where you are and what
                needs to happen next.
              </p>
              <ul className="contact-preparation">
                <li>
                  <h3>Your product.</h3>
                  <p>
                    What you’re building, who it’s for, and the stack it needs
                    to work with.
                  </p>
                </li>
                <li>
                  <h3>Your next milestone.</h3>
                  <p>
                    A first integration, a production launch, or a second set of
                    eyes before you ship.
                  </p>
                </li>
                <li>
                  <h3>The sticking point.</h3>
                  <p>
                    The messy details are useful. You don’t need a polished
                    brief to start.
                  </p>
                </li>
              </ul>
              <div className="contact-direct">
                <h3>Real people. Real replies.</h3>
                <p>
                  Brian or someone on the team replies personally within one
                  business day. We read every message.
                </p>
                <Button
                  variant="secondary"
                  size="lg"
                  href="mailto:brian@threadplane.ai"
                >
                  brian@threadplane.ai <span aria-hidden="true">↗</span>
                </Button>
                <div className="contact-community">
                  <Button
                    variant="ghost"
                    href="https://github.com/cacheplane/threadplane/issues"
                  >
                    GitHub issues <span aria-hidden="true">↗</span>
                  </Button>
                  <Button variant="ghost" href="https://discord.gg/cacheplane">
                    Discord <span aria-hidden="true">↗</span>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </Container>
      </Section>
    </div>
  );
}
