import { expect, test } from 'vitest';

import {
  isTrustedLinkedInSender,
  LINKEDIN_UNSUPPORTED_KINDS,
  parseLinkedInNotification,
} from './parser.ts';

const trusted = {
  from: 'LinkedIn <notifications-noreply@linkedin.com>',
  headers: {
    'authentication-results':
      'mx.example; spf=pass smtp.mailfrom=linkedin.com; dkim=pass header.d=linkedin.com',
  },
};

test('sender trust needs a linkedin.com From and passing spf and dkim', () => {
  expect(isTrustedLinkedInSender(trusted)).toBe(true);
  expect(
    isTrustedLinkedInSender({ ...trusted, from: 'x@linkedin.com.evil.example' })
  ).toBe(false);
  expect(
    isTrustedLinkedInSender({
      ...trusted,
      headers: { 'authentication-results': 'spf=pass; dkim=fail' },
    })
  ).toBe(false);
  expect(isTrustedLinkedInSender({ ...trusted, headers: {} })).toBe(false);
});

test('sender trust accepts linkedin.com subdomains and rejects invalid From values', () => {
  expect(
    isTrustedLinkedInSender({ ...trusted, from: 'jobs@mail.linkedin.com' })
  ).toBe(true);
  expect(isTrustedLinkedInSender({ ...trusted, from: 'not an address' })).toBe(
    false
  );
});

test('the stub classifies trusted mail as unparsed with no_fixtures_yet', () => {
  expect(
    parseLinkedInNotification({
      ...trusted,
      subject: 'x',
      text: 'y',
      html: null,
    })
  ).toEqual({ outcome: 'unparsed', reason: 'no_fixtures_yet' });
  expect(
    parseLinkedInNotification({
      from: 'a@example.com',
      headers: {},
      subject: null,
      text: null,
      html: null,
    })
  ).toEqual({ outcome: 'unparsed', reason: 'untrusted_sender' });
});

test('every notification kind is unsupported until fixtures exist', () => {
  expect([...LINKEDIN_UNSUPPORTED_KINDS].sort()).toEqual([
    'comment',
    'mention',
    'reaction',
    'reply',
    'repost',
  ]);
});
