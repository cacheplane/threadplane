import { describe, expect, it } from 'vitest';

import {
  FOUNDER_BOOKING_URL,
  campaignDraftViolations,
  normalizeCampaignDraft,
  renderCampaignTemplate,
  renderEvidenceCampaignTemplate,
} from './templates.js';

function wordCount(value: string): number {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}

describe('renderCampaignTemplate', () => {
  it.each([
    ['immediate', 'Engineer to engineer', 0, 0],
    ['day-3', 'Get your agent UI into production', 0, 1],
    ['day-8', 'Free engineering session with the Threadplane founder', 0, 1],
  ] as const)(
    'returns the fixed neutral %s template',
    (step, subject, questions, links) => {
      const message = renderCampaignTemplate(step);

      expect(message.subject).toBe(subject);
      expect(wordCount(message.body)).toBeLessThanOrEqual(120);
      expect(message.body.match(/\?/gu) ?? []).toHaveLength(questions);
      expect(message.body.match(/https:\/\/[^\s]+/gu) ?? []).toHaveLength(
        links
      );
      expect(campaignDraftViolations(message)).toEqual([]);
      expect(message.body).not.toMatch(/\nBrian$/u);
    }
  );

  it('opens with a founder session offer that carries no link and asks for a reply', () => {
    const message = renderCampaignTemplate('immediate');

    expect(
      message.body.startsWith('Saw you were checking out threadplane')
    ).toBe(true);
    expect(message.body.endsWith("Let me know if you're interested.")).toBe(
      true
    );
    expect(message.body).toContain('No sales, just getting you going.');
    // A booking URL in a first cold message is a deliverability risk, so the
    // call to action is a reply and the step carries no link at all.
    expect(message.body).not.toMatch(/https?:\/\//u);
    expect(message.body).not.toMatch(/\bI saw you\b/iu);
    // Steps two and three stay contraction-free; step one is deliberately the
    // founder's own conversational register.
  });

  it('follows up with a hands-on session offer that links only to the booking page', () => {
    const message = renderCampaignTemplate('day-3');

    expect(
      message.body.endsWith(`Book a time with me:\n${FOUNDER_BOOKING_URL}`)
    ).toBe(true);
    expect(message.body).toContain('No sales.');
    expect(message.body).not.toMatch(/\b\w+'\w+\b/u);
  });

  it('closes with a final founder offer that links only to the booking page', () => {
    const message = renderCampaignTemplate('day-8');

    expect(message.body.startsWith('One last note.')).toBe(true);
    expect(message.body).toContain(
      `Grab some time on my calendar:\n${FOUNDER_BOOKING_URL}`
    );
    expect(message.body).not.toMatch(/\b\w+'\w+\b/u);
  });

  it('accepts only the approved booking page as a scheduling link', () => {
    expect(
      campaignDraftViolations({
        subject: 'Hello',
        body: `Grab a time here:\n${FOUNDER_BOOKING_URL}`,
      })
    ).toEqual([]);
    for (const link of [
      'https://calendar.app.google/someone-else',
      'https://calendly.com/threadplane/demo',
      'https://cal.com/threadplane/demo',
      'https://calendar.google.com/calendar/appointments/schedules/abc',
    ]) {
      expect(
        campaignDraftViolations({ subject: 'Hello', body: `Book at ${link}` })
      ).not.toEqual([]);
    }
  });

  it('marks day 8 as the last automated follow-up', () => {
    expect(renderCampaignTemplate('day-8').body).toContain(
      'last automated follow-up'
    );
  });

  it('appends the last-follow-up notice to an evidence template only for the final step', () => {
    const final = renderEvidenceCampaignTemplate('event_state_boundary', {
      finalStep: true,
    });
    const earlier = renderEvidenceCampaignTemplate('event_state_boundary');

    expect(final.body).toContain('last automated follow-up');
    expect(final.body.endsWith('This is my last automated follow-up.')).toBe(
      true
    );
    expect(campaignDraftViolations(final)).toEqual([]);
    expect(earlier.body).not.toContain('last automated follow-up');
  });

  it('rejects an unknown campaign step at runtime', () => {
    expect(() => renderCampaignTemplate('day-30' as never)).toThrow();
  });
});

describe('normalizeCampaignDraft', () => {
  it('normalizes harmless whitespace without granting operational authority', () => {
    expect(
      normalizeCampaignDraft({
        subject: '  A useful pattern  ',
        body: 'A short note.  \r\n\r\nWould this help?   ',
      })
    ).toEqual({
      subject: 'A useful pattern',
      body: 'A short note.\n\nWould this help?',
    });
  });

  it('rejects a body over 120 words', () => {
    expect(() =>
      normalizeCampaignDraft({
        subject: 'Too long',
        body: `${'word '.repeat(121)}?`,
      })
    ).toThrow(/120 words/u);
  });

  it.each([
    ['two questions', 'Would this help? What is blocking you?'],
    [
      'two links',
      'Read https://threadplane.ai/docs and https://threadplane.ai/pilot-to-prod',
    ],
    ['HTML', '<p>Hello</p>'],
    ['tracking pixel', 'Open https://threadplane.ai/open.gif'],
    ['markdown image', '![pixel](https://threadplane.ai/docs)'],
    ['click wrapper', 'Read https://threadplane.ai/click?url=docs'],
    ['calendar domain', 'Book at https://calendly.com/threadplane/demo'],
    ['calendar path', 'Book at https://threadplane.ai/calendar/brian'],
    ['surveillance phrase', 'I saw you reading the docs.'],
    ['surveillance activity', 'Based on your activity, this may help.'],
    ['telemetry', 'Your telemetry says the stream completed.'],
    ['recipient email', 'Writing to ada@example.com.'],
    ['header injection', 'Hello\nBcc: victim@example.com'],
    ['indented header injection', 'Safe.\n Bcc: hidden-recipient'],
    ['markdown link', 'Read [the docs](/docs)'],
    ['protocol-relative link', 'Read //evil.example/path'],
    ['surveillance observation', 'We saw you reading the docs.'],
    ['current-directory link', 'See ./docs'],
    ['parent-directory link', 'See ../docs'],
    ['unsupported FTP scheme', 'See ftp://evil.example/file'],
    ['unsupported SSH scheme', 'See ssh://evil.example/repository'],
    ['unsupported file scheme', 'See file:///tmp/private'],
    ['telephone scheme', 'Call tel:+15551234567'],
    ['SMS scheme', 'Reply sms:+15551234567'],
    ['geolocation scheme', 'See geo:37.7,-122.4'],
    ['double-quoted FTP scheme', 'See "ftp://evil.example/file"'],
    ['double-quoted JavaScript scheme', 'See "javascript:alert(1)"'],
    ['double-quoted root-relative link', 'See "/docs"'],
    ['em-dash SSH scheme', 'See—ssh://evil.example/repository'],
    ['single-quoted FTP scheme', "See 'ftp://evil.example/file'."],
    ['single-quoted root-relative link', "See '/docs'."],
    ['single-quoted dot-relative link', "See '../docs'."],
    ['curly-quoted protocol-relative link', 'See “//evil.example/path”.'],
    ['usage surveillance', 'Your usage shows a completed stream.'],
    ['behavior surveillance', 'Your behavior reveals a persisted thread.'],
    ['signal surveillance', 'Your product signals show an interrupt.'],
    ['doctype markup', '<!DOCTYPE html>Safe'],
    ['HTML comment markup', 'Safe <!-- hidden -->'],
  ])('rejects %s', (_case, body) => {
    expect(() => normalizeCampaignDraft({ subject: 'Hello', body })).toThrow();
  });

  it.each([
    'Hello\nBcc: victim@example.com',
    '<b>Hello</b>',
    '<!DOCTYPE html> Hello',
    'Hello <!-- hidden -->',
    'Track https://threadplane.ai/docs',
  ])('rejects unsafe subject input: %s', (subject) => {
    expect(() =>
      normalizeCampaignDraft({ subject, body: 'A safe note.' })
    ).toThrow();
  });

  it('rejects unapproved, relative, non-HTTPS, and query-bearing URLs', () => {
    for (const body of [
      'See https://example.com/guide',
      'See /docs',
      'See http://threadplane.ai/docs',
      'See https://threadplane.ai/docs?utm_source=email',
    ]) {
      expect(() => normalizeCampaignDraft({ subject: 'Link', body })).toThrow();
    }
  });

  it('rejects model attempts to add scheduling or authorization fields', () => {
    for (const extra of [
      { recipientEmail: 'ada@example.com' },
      { outreachApprovedAt: '2026-09-01T12:00:00Z' },
      { dueAt: '2026-09-02T12:00:00Z' },
      { providerId: 'provider-1' },
      { authorized: true },
    ]) {
      expect(() =>
        normalizeCampaignDraft({
          subject: 'A note',
          body: 'A safe note.',
          ...extra,
        })
      ).toThrow();
    }
  });

  it('rejects recipient addresses on every validation call', () => {
    const draft = { subject: 'Hello', body: 'Writing to ada@example.com.' };

    expect(() => normalizeCampaignDraft(draft)).toThrow();
    expect(() => normalizeCampaignDraft(draft)).toThrow();
  });

  it('does not treat ordinary prose containing a colon as a URL scheme', () => {
    for (const body of [
      'One detail: this is ordinary prose.',
      'State: ready for review.',
    ]) {
      expect(
        normalizeCampaignDraft({ subject: 'A normal note', body })
      ).toEqual({ subject: 'A normal note', body });
    }
  });

  it.each([
    'Use and/or when either path works.',
    'See "https://threadplane.ai/docs".',
    'See (https://threadplane.ai/docs).',
    'See—https://threadplane.ai/docs.',
  ])('keeps safe prose and punctuation-wrapped approved links: %s', (body) => {
    expect(() =>
      normalizeCampaignDraft({ subject: 'A normal note', body })
    ).not.toThrow();
  });

  it('never normalizes unsafe input into accepted output', () => {
    const unsafe = {
      subject: 'Safe',
      body: 'A normal first line.\r\n  Bcc: hidden-recipient',
    };

    expect(campaignDraftViolations(unsafe)).toContain(
      'message contains an injected mail header'
    );
    expect(() => normalizeCampaignDraft(unsafe)).toThrow();
  });

  it('reports all applicable AI draft violations without throwing', () => {
    const violations = campaignDraftViolations({
      subject: 'Hello\nBcc: victim@example.com',
      body: `<img src="https://tracker.example/pixel.gif"> ${'word '.repeat(
        121
      )}Did you read it? Can we talk?`,
    });

    expect(violations).toEqual(
      expect.arrayContaining([
        'subject contains a newline',
        'message contains HTML',
        'body exceeds 120 words',
        'body contains more than one question',
        'message contains an unapproved link',
      ])
    );
  });
});
