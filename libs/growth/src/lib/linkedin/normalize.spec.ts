import { expect, test } from 'vitest';

import {
  companyMatchesDenyName,
  companyNameFromHeadline,
  domainsInText,
  headlineSignal,
  normalizeCompanyName,
  normalizeLinkedInProfileUrl,
} from './normalize.ts';

test('profile urls normalize to the canonical in/ form', () => {
  expect(
    normalizeLinkedInProfileUrl(
      'https://www.linkedin.com/in/Jane-Doe-123/?trk=x'
    )
  ).toBe('https://www.linkedin.com/in/jane-doe-123');
  expect(normalizeLinkedInProfileUrl('http://uk.linkedin.com/in/jane')).toBe(
    'https://www.linkedin.com/in/jane'
  );
  expect(
    normalizeLinkedInProfileUrl('https://www.linkedin.com/company/acme')
  ).toBeNull();
  expect(normalizeLinkedInProfileUrl('https://example.com/in/jane')).toBeNull();
});

test('company names strip punctuation and legal suffixes', () => {
  expect(normalizeCompanyName('Acme, Inc.')).toBe('acme');
  expect(normalizeCompanyName('Acme Widgets GmbH')).toBe('acme widgets');
});

test('current company comes from at/@ and never from ex- phrasing', () => {
  expect(companyNameFromHeadline('Staff Engineer at Acme | Angular')).toBe(
    'Acme'
  );
  expect(companyNameFromHeadline('CTO @ Acme Widgets, ex-Globex')).toBe(
    'Acme Widgets'
  );
  expect(companyNameFromHeadline('ex-Acme, building things')).toBeNull();
  expect(companyNameFromHeadline('Formerly at Acme')).toBeNull();
  expect(companyNameFromHeadline('Angular developer')).toBeNull();
});

test('current company accepts @ without a following space', () => {
  expect(companyNameFromHeadline('Engineer @Acme')).toBe('Acme');
  expect(companyNameFromHeadline('Engineer @Acme AI | Angular')).toBe(
    'Acme AI'
  );
  expect(companyNameFromHeadline('ex-@Acme')).toBeNull();
  expect(companyNameFromHeadline('previously @Acme')).toBeNull();
  expect(companyNameFromHeadline('jane@acme.example')).toBeNull();
});

test('a bare "<segment> | <segment>" headline yields no company', () => {
  // Skill lists ("Angular | TypeScript") are indistinguishable from
  // "<Company> | <title>", and deny-forever would deny the skill as a company.
  expect(companyNameFromHeadline('Angular | TypeScript | RxJS')).toBeNull();
  expect(companyNameFromHeadline('Acme | Building agent UIs')).toBeNull();
  expect(companyNameFromHeadline('Globex | CTO at Acme')).toBe('Acme');
});

test('deny company names match as whole words inside the current company', () => {
  expect(companyMatchesDenyName('Acme AI', 'acme')).toBe(true);
  expect(companyMatchesDenyName('Acme, Inc.', 'acme')).toBe(true);
  expect(companyMatchesDenyName('The Acme Group', 'acme group')).toBe(true);
  expect(companyMatchesDenyName('Acmeco', 'acme')).toBe(false);
  expect(companyMatchesDenyName('Acme AI', 'acme labs')).toBe(false);
  expect(companyMatchesDenyName('Acme', '')).toBe(false);
});

test('headline signal', () => {
  expect(headlineSignal('Principal Angular Engineer')).toBe('icp');
  expect(headlineSignal('Technical Recruiter at Acme')).toBe('negative');
  expect(headlineSignal('Growth hacker | Angular fan')).toBe('negative');
  expect(headlineSignal('Photographer')).toBe('neutral');
});

test('domains in text exclude linkedin hosts', () => {
  expect(domainsInText('CTO at acme.example | linkedin.com/in/x')).toEqual([
    'acme.example',
  ]);
});
