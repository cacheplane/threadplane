import { expect, test } from 'vitest';

import { loadLinkedInIngestConfig } from './config.ts';

test('ingest is off when unset or false', () => {
  expect(loadLinkedInIngestConfig({})).toEqual({ enabled: false });
  expect(
    loadLinkedInIngestConfig({ GROWTH_LINKEDIN_INGEST_ENABLED: 'false' })
  ).toEqual({ enabled: false });
});

test('enabled requires a threadplane.ai address distinct from the reply inbox', () => {
  expect(
    loadLinkedInIngestConfig({
      GROWTH_LINKEDIN_INGEST_ENABLED: 'true',
      GROWTH_LINKEDIN_INGEST_ADDRESS: 'LinkedIn@threadplane.ai',
    })
  ).toEqual({
    enabled: true,
    address: 'linkedin@threadplane.ai',
    forwardNotifications: false,
  });
  expect(() =>
    loadLinkedInIngestConfig({ GROWTH_LINKEDIN_INGEST_ENABLED: 'true' })
  ).toThrow();
  expect(() =>
    loadLinkedInIngestConfig({
      GROWTH_LINKEDIN_INGEST_ENABLED: 'true',
      GROWTH_LINKEDIN_INGEST_ADDRESS: 'brian@threadplane.ai',
    })
  ).toThrow();
  expect(() =>
    loadLinkedInIngestConfig({
      GROWTH_LINKEDIN_INGEST_ENABLED: 'yes',
      GROWTH_LINKEDIN_INGEST_ADDRESS: 'linkedin@threadplane.ai',
    })
  ).toThrow();
  expect(() =>
    loadLinkedInIngestConfig({
      GROWTH_LINKEDIN_INGEST_ENABLED: 'true',
      GROWTH_LINKEDIN_INGEST_ADDRESS: 'linkedin@threadplane.ai',
      GROWTH_LINKEDIN_FORWARD_NOTIFICATIONS: '1',
    })
  ).toThrow();
});

test('forward notifications opt in with an exact true', () => {
  expect(
    loadLinkedInIngestConfig({
      GROWTH_LINKEDIN_INGEST_ENABLED: 'true',
      GROWTH_LINKEDIN_INGEST_ADDRESS: 'linkedin@threadplane.ai',
      GROWTH_LINKEDIN_FORWARD_NOTIFICATIONS: 'true',
    })
  ).toEqual({
    enabled: true,
    address: 'linkedin@threadplane.ai',
    forwardNotifications: true,
  });
});
