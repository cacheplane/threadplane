'use client';
import { Honeypot, readHoneypot } from '../form/Honeypot';
import { useState } from 'react';
import Link from 'next/link';
import type { PublicFormPolicy } from '../../lib/growth/form-policy';
import { FORM_POLICY_REFRESH_MESSAGE } from '../../lib/growth/form-client';
import { analyticsEvents, type CtaId } from '../../lib/analytics/events';
import { trackCtaClick, trackExternalLinkClick } from '../../lib/analytics/client';
import { DEMOS, demoCtaSuffix } from '../../lib/demos';
import { LogoMark } from '../ui/LogoMark';
import { Button } from '../ui/Button';
import { GitHubIcon } from '../ui/GitHubIcon';
import { GITHUB_REPO_URL } from '../../lib/positioning';
import { Eyebrow } from '../ui/Eyebrow';
import { Field, FormStatus, SubmitButton, TextInput, emailError, useGrowthForm } from '../form';


function NpmIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M0 0v16h16V0H0zm13 13H8V5h2.5v5.5H13V5h-1V3H3v10h10V0H0v16h16V0H0z" opacity="0" />
      <path d="M0 0v16h16V0H0zm13 13h-2.5V5.5H8V13H3V3h10v10z" />
    </svg>
  );
}

function NewsletterForm({ formPolicy }: { formPolicy: PublicFormPolicy }) {
  const [email, setEmail] = useState('');
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const form = useGrowthForm<{ website_url: string; email: string }>({
    route: '/api/newsletter',
    formPolicy,
    events: {
      submit: analyticsEvents.marketingNewsletterSignupSubmit,
      success: analyticsEvents.marketingNewsletterSignupSuccess,
      fail: analyticsEvents.marketingNewsletterSignupFail,
    },
    analytics: { surface: 'footer', source_section: 'newsletter-form' },
  });
  const disclosureId = 'footer-newsletter-growth-disclosure';

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const problem = emailError(email);
    setEmailMessage(problem);
    if (problem) {
      document.getElementById('footer-email')?.focus();
      return;
    }
    void form.submit({ website_url: readHoneypot(e.currentTarget), email: email.trim() });
  };

  if (form.status === 'sent') {
    return (
      <div className="footer-newsletter">
        <FormStatus tone="success" title="Subscribed." detail="The first note from Brian arrives within a day." />
      </div>
    );
  }

  if (form.status === 'stale') {
    return (
      <div className="footer-newsletter">
        <FormStatus tone="stale" title="This page is out of date." detail={FORM_POLICY_REFRESH_MESSAGE}>
          <Button type="button" size="md" onClick={() => window.location.reload()}>
            Refresh page
          </Button>
        </FormStatus>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="footer-newsletter" data-ui="form" data-compact="" noValidate>
      <Honeypot />
      <Field id="footer-email" label="Email" error={emailMessage}>
        <div data-ui="form-row">
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
          />
          <SubmitButton size="md" pending={form.status === 'pending'} pendingLabel="Subscribing…" aria-describedby={disclosureId}>
            Subscribe
          </SubmitButton>
        </div>
      </Field>
      <p id={disclosureId} data-ui="form-disclosure">
        {formPolicy.disclosures.newsletter}
      </p>
      {form.status === 'failed' ? (
        <FormStatus tone="failure" title="That did not send." detail="Try again in a moment." />
      ) : null}
    </form>
  );
}

export function Footer({
  formPolicy,
  showNewsletter = true,
}: {
  formPolicy: PublicFormPolicy;
  showNewsletter?: boolean;
}) {
  /**
   * `ctaId` defaults to a slug of the label. Pass it explicitly when the visible
   * text changes but the analytics series should stay continuous — renaming
   * "Render" to "json-render" would otherwise silently split footer_render into
   * a new footer_json_render series.
   */
  const trackFooterCta = (label: string, href: string, ctaId?: CtaId) => {
    trackCtaClick({
      surface: 'footer',
      destination_url: href,
      cta_id:
        ctaId ?? `footer_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`,
      cta_text: label,
    });
  };

  return (
    <footer className="px-6 md:px-8 py-16 mt-24 footer-root">
      <div className="max-w-6xl mx-auto">

        {/* Top section: brand + columns */}
        <div className="grid grid-cols-1 md:grid-cols-6 gap-10 md:gap-8">
          {/* Brand */}
          <div className="md:col-span-2">
            <div className="mb-2">
              <LogoMark size="md" />
            </div>
            <p className="text-sm mb-4 footer-tagline">
              The Angular UI layer for production agents.
            </p>
            {showNewsletter ? <NewsletterForm formPolicy={formPolicy} /> : null}
            {/* Social links */}
            <div className="flex items-center gap-4">
              <a href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackExternalLinkClick(GITHUB_REPO_URL, {
                  surface: 'footer',
                  cta_id: 'footer_github_icon',
                  cta_text: 'GitHub',
                })}
                className="transition-colors footer-social-link"
                aria-label="GitHub">
                <GitHubIcon size={18} />
              </a>
              <a href="https://www.npmjs.com/package/@threadplane/langgraph"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackExternalLinkClick('https://www.npmjs.com/package/@threadplane/langgraph', {
                  surface: 'footer',
                  cta_id: 'footer_npm_icon',
                  cta_text: 'npm',
                })}
                className="transition-colors footer-social-link"
                aria-label="npm">
                <NpmIcon />
              </a>
            </div>
          </div>

          {/* Product column */}
          <div className="flex flex-col gap-3 text-sm">
            <Eyebrow tone="accent" className="footer-column-eyebrow">Product</Eyebrow>
            <Link href="/docs" className="transition-colors footer-link"
              onClick={() => trackFooterCta('Documentation', '/docs')}>
              Documentation
            </Link>
            <Link href="/docs/api" className="transition-colors footer-link"
              onClick={() => trackFooterCta('API Reference', '/docs/api')}>
              API Reference
            </Link>
            {DEMOS.map((demo) => (
              <a key={demo.key} href={demo.href} className="transition-colors footer-link"
                onClick={() => trackExternalLinkClick(demo.href, {
                  surface: 'footer',
                  cta_id: `footer_demo_${demoCtaSuffix(demo.key)}`,
                  cta_text: demo.label,
                })}>
                {demo.label}
              </a>
            ))}
            <Link href="/pricing" className="transition-colors footer-link"
              onClick={() => trackFooterCta('Pricing', '/pricing')}>
              Pricing
            </Link>
            <a href={GITHUB_REPO_URL}
              target="_blank" rel="noopener noreferrer"
              className="transition-colors footer-link"
              onClick={() => trackExternalLinkClick(GITHUB_REPO_URL, {
                surface: 'footer',
                cta_id: 'footer_github',
                cta_text: 'GitHub',
              })}>
              GitHub
            </a>
          </div>

          {/* Libraries column */}
          <div className="flex flex-col gap-3 text-sm">
            <Eyebrow tone="accent" className="footer-column-eyebrow">Libraries</Eyebrow>
            <Link href="/langgraph" className="transition-colors footer-link"
              onClick={() => trackFooterCta('LangGraph', '/langgraph')}>
              LangGraph
            </Link>
            <Link href="/ag-ui" className="transition-colors footer-link"
              onClick={() => trackFooterCta('AG-UI', '/ag-ui')}>
              AG-UI
            </Link>
            <Link href="/render" className="transition-colors footer-link"
              onClick={() => trackFooterCta('json-render', '/render', 'footer_render')}>
              json-render
            </Link>
            <Link href="/chat" className="transition-colors footer-link"
              onClick={() => trackFooterCta('Chat', '/chat')}>
              Chat
            </Link>
          </div>

          {/* Solutions column */}
          <div className="flex flex-col gap-3 text-sm">
            <Eyebrow tone="accent" className="footer-column-eyebrow">Solutions</Eyebrow>
            <Link href="/solutions/compliance" className="transition-colors footer-link"
              onClick={() => trackFooterCta('Compliance', '/solutions/compliance')}>
              Compliance
            </Link>
            <Link href="/solutions/analytics" className="transition-colors footer-link"
              onClick={() => trackFooterCta('Analytics', '/solutions/analytics')}>
              Analytics
            </Link>
            <Link href="/solutions/customer-support" className="transition-colors footer-link"
              onClick={() => trackFooterCta('Customer Support', '/solutions/customer-support')}>
              Customer Support
            </Link>
            <Link href="/solutions" className="transition-colors footer-link"
              onClick={() => trackFooterCta('All Solutions', '/solutions')}>
              All solutions
            </Link>
          </div>

          {/* Resources column */}
          <div className="flex flex-col gap-3 text-sm">
            <Eyebrow tone="accent" className="footer-column-eyebrow">Resources</Eyebrow>
            <Link href="/pilot-to-prod" className="transition-colors footer-link"
              onClick={() => trackFooterCta('Pilot to Prod', '/pilot-to-prod')}>
              Pilot to Prod
            </Link>
            <Link href="/blog" className="transition-colors footer-link"
              onClick={() => trackFooterCta('Blog', '/blog')}>
              Blog
            </Link>
            <a href="https://www.npmjs.com/package/@threadplane/langgraph"
              target="_blank" rel="noopener noreferrer"
              className="transition-colors footer-link"
              onClick={() => trackExternalLinkClick('https://www.npmjs.com/package/@threadplane/langgraph', {
                surface: 'footer',
                cta_id: 'footer_npm_package',
                cta_text: 'npm Package',
              })}>
              npm Package
            </a>
            <Link href="/about" className="transition-colors footer-link"
              onClick={() => trackFooterCta('About', '/about')}>
              About
            </Link>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-12 pt-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs footer-bottom-bar">
          <span>&copy; {new Date().getFullYear()} Threadplane. All rights reserved.</span>
          <span className="footer-legal-links">
            <Link
              href="/pricing"
              className="transition-colors footer-legal-link"
              onClick={() => trackFooterCta('Pricing Bottom', '/pricing')}
            >
              Pricing
            </Link>
            <Link
              href="/privacy"
              className="transition-colors footer-legal-link"
              onClick={() => trackFooterCta('Privacy Bottom', '/privacy')}
            >
              Privacy
            </Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
