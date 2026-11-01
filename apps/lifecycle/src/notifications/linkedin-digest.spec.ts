import { describe, expect, it } from 'vitest';

import { renderLinkedInDigest } from './linkedin-digest.js';

const ORIGIN = 'https://threadplane.ai';
const REJECT_URL = `${ORIGIN}/api/growth/linkedin-decide?token=g1.reject.sig`;
const DENY_URL = `${ORIGIN}/api/growth/linkedin-decide?token=g1.deny.sig`;

function lead(overrides: Record<string, unknown> = {}) {
  return {
    displayName: 'Dana Builder',
    headline: 'Staff Engineer at Example Corp',
    profileUrl: 'https://www.linkedin.com/in/dana-builder',
    companyName: 'Example Corp',
    score: 70,
    previouslyRejected: false,
    engagements: [
      {
        kind: 'comment',
        commentText: 'Great write-up on agent streaming',
        postUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:1/',
        postUrn: 'urn:li:activity:1',
        occurredAt: new Date('2026-10-30T15:00:00.000Z'),
      },
      {
        kind: 'reaction',
        commentText: null,
        postUrl: null,
        postUrn: 'urn:li:activity:2',
        occurredAt: new Date('2026-10-30T16:00:00.000Z'),
      },
      {
        kind: 'repost',
        commentText: null,
        postUrl: null,
        postUrn: null,
        occurredAt: new Date('2026-10-30T17:00:00.000Z'),
      },
      {
        kind: 'mention',
        commentText: null,
        postUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:3/',
        postUrn: null,
        occurredAt: new Date('2026-10-30T18:00:00.000Z'),
      },
      {
        kind: 'reply',
        commentText: 'Agreed, thanks',
        postUrl: null,
        postUrn: 'urn:li:activity:1',
        occurredAt: new Date('2026-10-30T19:00:00.000Z'),
      },
    ],
    rejectUrl: REJECT_URL,
    denyUrl: DENY_URL,
    ...overrides,
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    businessDate: '2026-11-02',
    publicActionOrigin: ORIGIN,
    leads: [lead()],
    context: { unparsedCount: 2, dropCount: 3, ingestCount: 9 },
    ...overrides,
  };
}

describe('renderLinkedInDigest', () => {
  it('renders the header, one block per lead, both links and the footer', () => {
    const text = renderLinkedInDigest(input());
    expect(text).toContain('Threadplane LinkedIn leads for 2026-11-02');
    expect(text).toContain('Dana Builder — Staff Engineer at Example Corp');
    expect(text).toContain('Company: Example Corp');
    expect(text).toContain('Profile: https://www.linkedin.com/in/dana-builder');
    expect(text).toContain('Score: 70');
    expect(text).toContain(
      'commented: "Great write-up on agent streaming" on https://www.linkedin.com/feed/update/urn:li:activity:1/ 2026-10-30T15:00:00.000Z'
    );
    expect(text).toContain(
      'reacted on urn:li:activity:2 2026-10-30T16:00:00.000Z'
    );
    expect(text).toContain(
      'reposted on an unknown post 2026-10-30T17:00:00.000Z'
    );
    expect(text).toContain(
      'mentioned you on https://www.linkedin.com/feed/update/urn:li:activity:3/ 2026-10-30T18:00:00.000Z'
    );
    expect(text).toContain(
      'replied: "Agreed, thanks" on urn:li:activity:1 2026-10-30T19:00:00.000Z'
    );
    expect(text).toContain(`Reject (valid 7 days):\n${REJECT_URL}`);
    expect(text).toContain(
      `Deny forever (also denies company Example Corp) (valid 7 days):\n${DENY_URL}`
    );
    expect(text).not.toContain('previously rejected');
    expect(text).toContain(
      'Since last digest: 9 received, 2 unparsed, 3 dropped by the deny list.'
    );
    expect(text).toContain(
      'No approve link: approvals happen in the /week session.'
    );
    expect(text.toLowerCase()).not.toContain('approve (valid');
  });

  it('marks previously rejected leads and omits an empty headline and company', () => {
    const text = renderLinkedInDigest(
      input({
        leads: [
          lead({ previouslyRejected: true, headline: '', companyName: null }),
          lead({ displayName: 'Second Person' }),
        ],
      })
    );
    expect(text).toContain('previously rejected');
    expect(text).toMatch(/^Dana Builder$/mu);
    expect(text).toContain('Second Person — Staff Engineer at Example Corp');
    expect(text.match(/Company: /gu)).toHaveLength(1);
    expect(text.match(/^Deny forever \(valid 7 days\):$/gmu)).toHaveLength(1);
    expect(
      text.match(
        /^Deny forever \(also denies company Example Corp\) \(valid 7 days\):$/gmu
      )
    ).toHaveLength(1);
    expect(text.match(/Reject \(valid 7 days\):/gu)).toHaveLength(2);
  });

  it('renders a counts-only digest when there are no leads', () => {
    const text = renderLinkedInDigest(input({ leads: [] }));
    expect(text).toContain('No new leads.');
    expect(text).not.toContain('Reject (valid 7 days):');
    expect(text).toContain(
      'Since last digest: 9 received, 2 unparsed, 3 dropped by the deny list.'
    );
  });

  it('truncates comment text to 500 characters', () => {
    const long = 'x'.repeat(600);
    const text = renderLinkedInDigest(
      input({
        leads: [
          lead({
            engagements: [
              {
                kind: 'comment',
                commentText: long,
                postUrl: null,
                postUrn: 'urn:li:activity:1',
                occurredAt: new Date('2026-10-30T15:00:00.000Z'),
              },
            ],
          }),
        ],
      })
    );
    expect(text).toContain(`commented: "${'x'.repeat(500)}…"`);
    expect(text).not.toContain('x'.repeat(501));
  });

  it('rejects an http link', () => {
    expect(() =>
      renderLinkedInDigest(
        input({
          leads: [
            lead({
              rejectUrl:
                'http://threadplane.ai/api/growth/linkedin-decide?token=g1.a.b',
            }),
          ],
        })
      )
    ).toThrow();
  });

  it('rejects a link that is not on the public action origin', () => {
    expect(() =>
      renderLinkedInDigest(
        input({
          leads: [
            lead({
              denyUrl:
                'https://evil.example/api/growth/linkedin-decide?token=g1.a.b',
            }),
          ],
        })
      )
    ).toThrow();
  });

  it.each([
    `${ORIGIN}/api/growth/approve-install?token=g1.a.b`,
    `${ORIGIN}/api/growth/linkedin-decide?token=g1.a.b&reason=approve`,
    `${ORIGIN}/api/growth/linkedin-decide?id=g1.a.b`,
    `${ORIGIN}/api/growth/linkedin-decide?token=g1.a.b#frag`,
  ])('rejects a malformed decide link: %s', (url) => {
    expect(() =>
      renderLinkedInDigest(input({ leads: [lead({ rejectUrl: url })] }))
    ).toThrow();
  });

  it('rejects CRLF in a headline and control characters in other fields', () => {
    expect(() =>
      renderLinkedInDigest(
        input({ leads: [lead({ headline: 'Engineer\r\nBcc: x@y.example' })] })
      )
    ).toThrow();
    expect(() =>
      renderLinkedInDigest(
        input({ leads: [lead({ displayName: 'Dana\u0007' })] })
      )
    ).toThrow();
    expect(() =>
      renderLinkedInDigest(
        input({
          leads: [
            lead({
              engagements: [
                {
                  kind: 'comment',
                  commentText: 'line one\nline two',
                  postUrl: null,
                  postUrn: null,
                  occurredAt: new Date('2026-10-30T15:00:00.000Z'),
                },
              ],
            }),
          ],
        })
      )
    ).toThrow();
  });

  it.each([
    ['a bidi override', 'Engineer \u202Eroc elpmaxE'],
    ['a bidi isolate', 'Engineer \u2067x\u2069'],
    ['a C1 control', 'Engineer\u0085 at Example'],
  ])('rejects %s in a headline', (_label, headline) => {
    expect(() =>
      renderLinkedInDigest(input({ leads: [lead({ headline })] }))
    ).toThrow();
  });

  it('rejects a profile link that is not a LinkedIn member profile', () => {
    expect(() =>
      renderLinkedInDigest(
        input({ leads: [lead({ profileUrl: 'https://example.com/in/dana' })] })
      )
    ).toThrow();
    expect(() =>
      renderLinkedInDigest(
        input({
          leads: [lead({ profileUrl: 'http://www.linkedin.com/in/dana' })],
        })
      )
    ).toThrow();
  });
});
