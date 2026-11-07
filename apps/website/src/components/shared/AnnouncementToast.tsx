'use client';
import { Honeypot, readHoneypot } from '../form/Honeypot';
import { useState, useEffect } from 'react';
import type { PublicFormPolicy } from '../../lib/growth/form-policy';
import { FORM_POLICY_REFRESH_MESSAGE } from '../../lib/growth/form-client';
import { analyticsEvents } from '../../lib/analytics/events';
import { track } from '../../lib/analytics/client';
import { Button } from '../ui/Button';
import {
  Field,
  FormStatus,
  SubmitButton,
  TextInput,
  emailError,
  useGrowthForm,
} from '../form';

/**
 * Bump this date to re-show the toast for all users.
 * Format: YYYY-MM-DD
 */
const ANNOUNCEMENT_DATE = '2026-04-07';
const STORAGE_KEY = `dismissed-announcement-${ANNOUNCEMENT_DATE}`;
const DELAY_MS = 30_000;

type Step = 'cta' | 'form' | 'sent' | 'stale';

export function AnnouncementToast({
  formPolicy,
}: {
  formPolicy: PublicFormPolicy;
}) {
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<Step>('cta');
  const [email, setEmail] = useState('');
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const disclosureId = 'toast-whitepaper-growth-disclosure';

  const form = useGrowthForm<{
    website_url: string;
    email: string;
    paper: 'overview';
  }>({
    route: '/api/whitepaper-signup',
    formPolicy,
    events: {
      submit: analyticsEvents.marketingWhitepaperSignupSubmit,
      success: analyticsEvents.marketingWhitepaperSignupSuccess,
      fail: analyticsEvents.marketingWhitepaperSignupFail,
    },
    analytics: {
      surface: 'toast',
      source_section: 'announcement-toast',
      paper: 'overview',
    },
  });

  const [timerDone, setTimerDone] = useState(false);
  const [scrolledEnough, setScrolledEnough] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === 'true') return;
    } catch {
      return;
    }
    const timer = setTimeout(() => setTimerDone(true), DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  // Intent gate (spec 2026-08-31): the toast waits for BOTH the delay and a
  // 40% scroll depth — it should meet readers who are reading, not arrivals.
  useEffect(() => {
    if (scrolledEnough) return undefined;
    let raf = 0;
    const check = () => {
      raf = 0;
      const doc = document.documentElement;
      const denom = Math.max(1, doc.scrollHeight - window.innerHeight);
      if (window.scrollY / denom >= 0.4) {
        setScrolledEnough(true);
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    check();
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scrolledEnough]);

  useEffect(() => {
    if (timerDone && scrolledEnough) setVisible(true);
  }, [timerDone, scrolledEnough]);

  useEffect(() => {
    if (visible) {
      // Next frame: flip mounted so the CSS transition runs from initial to final state.
      const id = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(id);
    }
    setMounted(false);
    return undefined;
  }, [visible]);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      /* ignore */
    }
  };

  // Mirror the hook's terminal states onto the toast's step machine.
  useEffect(() => {
    if (form.status === 'sent') {
      setStep('sent');
      const id = setTimeout(dismiss, 4000);
      return () => clearTimeout(id);
    }
    if (form.status === 'stale') setStep('stale');
    return undefined;
    // dismiss is stable for the component's lifetime; intentionally omitted.
  }, [form.status]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const problem = emailError(email);
    setEmailMessage(problem);
    if (problem) {
      document.getElementById('toast-email')?.focus();
      return;
    }
    void form.submit({
      website_url: readHoneypot(e.currentTarget),
      email: email.trim(),
      paper: 'overview',
    });
  };

  if (!visible) return null;

  return (
    // Non-modal dialog, not role="alert": an alert/live region must not hold
    // interactive content (the CTA button and email form live here), and
    // assertive announcement of a marketing prompt is hostile. Focus is never
    // stolen on entry; Escape dismisses once focus is inside.
    <div
      role="dialog"
      aria-labelledby="toast-title"
      className="toast-root"
      data-announcement-toast=""
      data-mounted={mounted || undefined}
      onKeyDown={(e) => {
        if (e.key === 'Escape') dismiss();
      }}
    >
      {/* Dismiss button */}
      <button onClick={dismiss} aria-label="Dismiss" className="toast-close">
        ×
      </button>

      {/* Eyebrow */}
      <p className="toast-eyebrow">Free Guide</p>

      {/* Title */}
      <p id="toast-title" className="toast-title">
        From Prototype to Production
      </p>

      {step === 'cta' && (
        <>
          <p className="toast-cta-copy">
            Architecture, evaluation and recovery for agent products, with
            Angular and React examples. Get the guide.
          </p>
          <div className="toast-button-row">
            <Button
              variant="primary"
              size="md"
              onClick={() => {
                track(analyticsEvents.marketingCtaClick, {
                  surface: 'toast',
                  source_section: 'announcement-toast',
                  cta_id: 'toast_get_guide',
                });
                setStep('form');
              }}
            >
              ↓ Get the Guide
            </Button>
            <button onClick={dismiss} className="toast-not-now">
              Not now
            </button>
          </div>
        </>
      )}

      {step === 'form' && (
        <form
          onSubmit={handleSubmit}
          className="toast-mt-section"
          data-ui="form"
          data-compact=""
          noValidate
        >
          <Honeypot />
          <Field id="toast-email" label="Work email" error={emailMessage}>
            <TextInput
              compact
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailMessage) setEmailMessage(emailError(e.target.value));
              }}
              onBlur={() => setEmailMessage(emailError(email))}
              disabled={form.status === 'pending'}
              autoFocus
            />
          </Field>
          <p id={disclosureId} data-ui="form-disclosure">
            {formPolicy.disclosures.whitepaper}
          </p>
          <div className="toast-button-row">
            <SubmitButton
              variant="primary"
              size="md"
              pending={form.status === 'pending'}
              pendingLabel="Sending the guide…"
              aria-describedby={disclosureId}
            >
              Get the field report
            </SubmitButton>
          </div>
          {form.status === 'failed' ? (
            <FormStatus
              tone="failure"
              title="That did not send."
              detail="Try again in a moment."
            />
          ) : null}
        </form>
      )}

      {step === 'stale' && (
        <div className="toast-mt-section">
          <FormStatus
            tone="stale"
            title="This page is out of date."
            detail={FORM_POLICY_REFRESH_MESSAGE}
          >
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => window.location.reload()}
            >
              Refresh page
            </Button>
          </FormStatus>
        </div>
      )}

      {step === 'sent' && (
        <div className="toast-mt-section">
          <FormStatus
            tone="success"
            title="Check your inbox."
            detail="The guide is on its way."
          />
        </div>
      )}
    </div>
  );
}
