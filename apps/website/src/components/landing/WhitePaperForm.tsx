'use client';
import { Honeypot, readHoneypot } from '../form/Honeypot';
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { PublicFormPolicy } from '../../lib/growth/form-policy';
import { FORM_POLICY_REFRESH_MESSAGE } from '../../lib/growth/form-client';
import { Button } from '../ui/Button';
import {
  analyticsEvents,
  type AnalyticsSurface,
  type WhitepaperId,
} from '../../lib/analytics/events';
import { trackWhitepaperDownloadClick } from '../../lib/analytics/client';
import {
  Field,
  FormStatus,
  SubmitButton,
  TextInput,
  emailError,
  useGrowthForm,
} from '../form';
import { WHITEPAPERS } from '../../lib/whitepapers';

export type { WhitepaperId };

export const PDF_PATHS = Object.fromEntries(
  Object.entries(WHITEPAPERS).map(([id, paper]) => [
    id,
    {
      href: `/${paper.pdf}`,
      download: paper.download,
    },
  ])
) as Record<WhitepaperId, { href: string; download: string }>;

interface WhitePaperFormProps {
  paper: WhitepaperId;
  formPolicy: PublicFormPolicy;
  /** Analytics surface + section, so the teams block and the library pages report separately. */
  surface: AnalyticsSurface;
  sourceSection: string;
  /** Ids must be unique per page; two forms on one page would collide. */
  idPrefix: string;
}

/** The whitepaper signup on the form kit: label above the field, inline submit, validation on blur. */
export function WhitePaperForm({
  paper,
  formPolicy,
  surface,
  sourceSection,
  idPrefix,
}: WhitePaperFormProps) {
  const pdf = PDF_PATHS[paper];
  const [email, setEmail] = useState('');
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const form = useGrowthForm<{
    website_url: string;
    email: string;
    paper: WhitepaperId;
  }>({
    route: '/api/whitepaper-signup',
    formPolicy,
    events: {
      submit: analyticsEvents.marketingWhitepaperSignupSubmit,
      success: analyticsEvents.marketingWhitepaperSignupSuccess,
      fail: analyticsEvents.marketingWhitepaperSignupFail,
    },
    analytics: { surface, source_section: sourceSection, paper },
  });
  const inputId = `${idPrefix}-email`;
  const disclosureId = `${idPrefix}-growth-disclosure`;

  const directLink = (label: string) => (
    <a
      href={pdf.href}
      download={pdf.download}
      onClick={() =>
        trackWhitepaperDownloadClick(paper, {
          surface,
          source_section: sourceSection,
          cta_id: 'home_whitepaper_direct',
        })
      }
    >
      {label}
    </a>
  );

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const problem = emailError(email);
    setEmailMessage(problem);
    if (problem) {
      document.getElementById(inputId)?.focus();
      return;
    }
    void form.submit({
      website_url: readHoneypot(e.currentTarget),
      email: email.trim(),
      paper,
    });
  };

  if (form.status === 'sent') {
    return (
      <FormStatus
        tone="success"
        title="Check your inbox."
        detail="The guide is on its way, and the PDF is here too."
      >
        {directLink('Download the PDF directly')}
      </FormStatus>
    );
  }
  if (form.status === 'stale') {
    return (
      <FormStatus
        tone="stale"
        title="This page is out of date."
        detail={FORM_POLICY_REFRESH_MESSAGE}
      >
        <Button
          type="button"
          variant="primary"
          size="lg"
          onClick={() => window.location.reload()}
        >
          Refresh page
        </Button>
      </FormStatus>
    );
  }
  return (
    <form onSubmit={submit} className="wp-form" data-ui="form" noValidate>
      <Honeypot />
      <Field id={inputId} label="Work email" error={emailMessage}>
        <div data-ui="form-row">
          <TextInput
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (emailMessage) setEmailMessage(emailError(e.target.value));
            }}
            onBlur={() => setEmailMessage(emailError(email))}
            disabled={form.status === 'pending'}
          />
          <SubmitButton
            variant="primary"
            size="lg"
            pending={form.status === 'pending'}
            pendingLabel="Sending the guide…"
            aria-describedby={disclosureId}
          >
            Get the field report
          </SubmitButton>
        </div>
      </Field>
      <p id={disclosureId} data-ui="form-disclosure">
        {formPolicy.disclosures.whitepaper}
      </p>
      {form.status === 'failed' ? (
        <FormStatus
          tone="failure"
          title="That did not send."
          detail="Try again in a moment."
        />
      ) : null}
    </form>
  );
}
