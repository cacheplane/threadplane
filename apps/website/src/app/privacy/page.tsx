// SPDX-License-Identifier: MIT
import { Container } from '../../components/ui/Container';
import { Section } from '../../components/ui/Section';
import { createPageMetadata } from '../../lib/site-metadata';

const CONTACT_EMAIL = 'brian@threadplane.ai';

export const metadata = createPageMetadata({
  title: 'Privacy — Threadplane',
  description:
    'What Threadplane collects, why, who processes it, how long it is kept, and how to opt out or request deletion.',
  pathname: '/privacy',
  type: 'website',
});

/**
 * The single canonical statement of what Threadplane collects and why.
 *
 * It deliberately describes categories and purposes rather than an event or
 * property catalog. A catalog would be a maintenance trap: it goes stale the
 * first time an event is added, and a stale published catalog is worse than a
 * general one. For the same reason this page makes no claim about behavior it
 * cannot continuously verify.
 */
export default function PrivacyPage() {
  return (
    <Section
      surface="white"
      className="privacy-page"
      ariaLabelledBy="privacy-heading"
    >
      <Container>
        <div className="privacy-inner">
          <h1 id="privacy-heading" className="privacy-h1">
            Privacy
          </h1>
          <p className="privacy-body">
            This page describes what Threadplane collects, why it is collected,
            who processes it, and the choices available to you. It applies to
            the Threadplane website and to the Threadplane software libraries
            and services.
          </p>

          <h2 className="privacy-h2">Information you submit</h2>
          <p className="privacy-body">
            When you request a guide, subscribe to updates, or contact us, we
            receive what you enter in the form: your email address and, where
            the form asks for them, your name, company, and message. Replies you
            send to our email are received and read as ordinary correspondence.
          </p>

          <h2 className="privacy-h2">Website analytics</h2>
          <p className="privacy-body">
            We record how pages are used — pages viewed, referring source, and
            broad technical details such as browser and approximate region — to
            understand what people find useful. We also record content topics,
            campaign and referral context, and interactions with setup commands.
            A short-lived website session can connect this activity to a form
            you submit, helping us understand your interest and respond in
            context. We use both aggregate reporting and individual activity
            history.
          </p>

          <h2 className="privacy-h2">Product analytics</h2>
          <p className="privacy-body">
            Installing Threadplane chat, LangGraph, AG-UI, or render packages
            can automatically report package and environment details, a random
            installation identifier, configured Git name and full email, and the
            repository hosting provider and owner when available. This includes
            CI installations, which are labeled as automation. Set
            DO_NOT_TRACK=1 or TPLANE_TELEMETRY_DISABLED=1 before installation to
            disable this collection. A usable install-captured email may receive
            a short founder welcome sequence after the first linked development
            browser use, with at most three emails and an unsubscribe option. CI
            installation alone does not trigger this sequence.
          </p>
          <p className="privacy-body">
            In Angular development builds, supported browser runtimes
            automatically report package versions and progress such as a working
            connection, completed interaction, restored conversation, or mounted
            component. Production builds and server-side execution do not run
            this automatic browser collection. A random browser-origin
            identifier and a session with a 30-minute inactivity boundary
            connect these reports; they do not identify a repository or verified
            person. Storage failures fall back to memory. An opaque
            package-local token can link development use to an installation; it
            contains no email. Copied or cached installed packages can retain an
            earlier token, so this link does not verify who is operating the
            browser.
          </p>
          <p className="privacy-body">
            Set the browser localStorage key THREADPLANE_TELEMETRY_DISABLED to
            1, use the programmatic browser disable control, or configure
            telemetry: false to disable automatic runtime collection. A custom
            telemetry sink replaces the automatic destination for that runtime.
            Development announcements may appear in the console; no click is
            required to record progress. These reports exclude prompts,
            messages, tool inputs and outputs, application state, source code,
            private URLs, and credentials. They do not authorize marketing
            email.
          </p>

          <h2 className="privacy-h2">How the information is used</h2>
          <p className="privacy-body">
            To operate and support the product, to understand and improve how it
            is used, to answer you when you get in touch, and — where you have
            asked to hear from us — to send relevant email.
          </p>

          <h2 className="privacy-h2">Who processes it</h2>
          <p className="privacy-body">
            Threadplane relies on a small number of service providers who
            process data on our behalf: Vercel (hosting), Neon (database),
            PostHog (analytics), Resend (email delivery), Google (business email
            and calendar), and Anthropic (AI processing used to prepare internal
            summaries). Each processes data under its own agreement with us and
            for our purposes only.
          </p>

          <h2 className="privacy-h2">Retention</h2>
          <p className="privacy-body">
            Information is retained indefinitely by default, so that account and
            correspondence history stays intact. Where you ask us to delete
            information, we do so as described below.
          </p>

          <h2 className="privacy-h2">Your choices</h2>
          <p className="privacy-body">
            Every marketing email carries an unsubscribe link, and unsubscribing
            stops further marketing email. Replying to ask us to stop has the
            same effect. To request deletion of the information we hold about
            you, or to ask what that is, email{' '}
            <a className="privacy-link" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>{' '}
            and we will act on it. Some records are kept where we are required
            to keep them.
          </p>

          <h2 className="privacy-h2">Security</h2>
          <p className="privacy-body">
            Data is held with the providers named above, protected in transit
            and at rest by their standard controls, and access is limited to
            those who need it to run the product.
          </p>

          <h2 className="privacy-h2">International processing</h2>
          <p className="privacy-body">
            Our providers operate in the United States and elsewhere, so
            information may be processed outside the country where you live.
          </p>

          <h2 className="privacy-h2">Changes</h2>
          <p className="privacy-body">
            When this page changes materially, the change applies from the date
            it is published here.
          </p>

          <h2 className="privacy-h2">Contact</h2>
          <p className="privacy-body">
            Questions about this page or about the information we hold:{' '}
            <a className="privacy-link" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </div>
      </Container>
    </Section>
  );
}
