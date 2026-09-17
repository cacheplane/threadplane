import { describe, expect, it } from 'vitest';

import { renderInstallDigest } from './install-digest.js';

const candidate = {
  email: 'dev@bosch.example',
  companyDomain: 'bosch.example',
  gitDisplayName: 'Dev Person',
  repositoryProvider: 'github',
  repositoryOwner: 'bosch-org',
  gitConfigOrigin: 'global' as const,
  packages: [
    { packageName: '@threadplane/langgraph', packageVersion: '0.2.0' },
    { packageName: '@threadplane/chat', packageVersion: '0.2.0' },
  ],
  installCount: 3,
  firstSeenAt: new Date('2026-09-07T10:00:00.000Z'),
  lastSeenAt: new Date('2026-09-15T13:37:00.000Z'),
  approveUrl: 'https://threadplane.ai/api/growth/approve-install?token=g1.abc.def',
};

describe('renderInstallDigest', () => {
  it('renders one block per identity with the approve link and context lines', () => {
    const text = renderInstallDigest({
      businessDate: '2026-09-16',
      publicActionOrigin: 'https://threadplane.ai',
      candidates: [candidate],
      context: {
        since: new Date('2026-09-15T14:00:00.000Z'),
        anonymousInstallSubjects: 4,
        ciInstallSubjects: 12,
      },
    });
    expect(text).toContain('Threadplane install digest for 2026-09-16');
    expect(text).toContain('1 new install identity');
    expect(text).toContain('dev@bosch.example (Dev Person) — bosch.example');
    expect(text).toContain('Repository: github/bosch-org');
    expect(text).toContain('Packages: @threadplane/langgraph@0.2.0, @threadplane/chat@0.2.0');
    expect(text).toContain('Installs: 3, first 2026-09-07T10:00:00.000Z, last 2026-09-15T13:37:00.000Z');
    expect(text).toContain('Git identity: global config');
    expect(text).toContain('Approve outreach (valid 7 days):');
    expect(text).toContain(candidate.approveUrl);
    expect(text).toContain('Not reported: 4 install subjects without identity, 12 CI install subjects since 2026-09-15T14:00:00.000Z.');
    expect(text).toContain('This digest does not authorize or schedule any recipient email.');
  });

  it('pluralizes and omits absent fields', () => {
    const text = renderInstallDigest({
      businessDate: '2026-09-16',
      publicActionOrigin: 'https://threadplane.ai',
      candidates: [
        { ...candidate, gitDisplayName: null, repositoryProvider: null, repositoryOwner: null, gitConfigOrigin: 'local' },
        { ...candidate, email: 'two@corp.example', companyDomain: 'corp.example' },
      ],
      context: { since: new Date('2026-09-15T14:00:00.000Z'), anonymousInstallSubjects: 0, ciInstallSubjects: 0 },
    });
    expect(text).toContain('2 new install identities');
    expect(text).toContain('dev@bosch.example — bosch.example');
    expect(text).not.toContain('Repository: /');
    expect(text).toContain('Git identity: repository-local config');
  });

  it('rejects header-injection characters in any field', () => {
    expect(() =>
      renderInstallDigest({
        businessDate: '2026-09-16',
      publicActionOrigin: 'https://threadplane.ai',
        candidates: [{ ...candidate, gitDisplayName: 'Bad\r\nBcc: x' }],
        context: { since: new Date('2026-09-15T14:00:00.000Z'), anonymousInstallSubjects: 0, ciInstallSubjects: 0 },
      })
    ).toThrow();
    expect(() =>
      renderInstallDigest({
        businessDate: '2026-09-16',
      publicActionOrigin: 'https://threadplane.ai',
        candidates: [{ ...candidate, approveUrl: 'http://evil.example/x' }],
        context: { since: new Date('2026-09-15T14:00:00.000Z'), anonymousInstallSubjects: 0, ciInstallSubjects: 0 },
      })
    ).toThrow();
  });

  it('validates the approve link against the configured origin', () => {
    const context = { since: new Date('2026-09-15T14:00:00.000Z'), anonymousInstallSubjects: 0, ciInstallSubjects: 0 };
    const previewUrl = 'https://preview.example/api/growth/approve-install?token=g1.abc.def';
    expect(
      renderInstallDigest({
        businessDate: '2026-09-16',
        publicActionOrigin: 'https://preview.example',
        candidates: [{ ...candidate, approveUrl: previewUrl }],
        context,
      })
    ).toContain(previewUrl);
    expect(() =>
      renderInstallDigest({
        businessDate: '2026-09-16',
        publicActionOrigin: 'https://preview.example',
        candidates: [candidate],
        context,
      })
    ).toThrow();
    expect(() =>
      renderInstallDigest({
        businessDate: '2026-09-16',
        publicActionOrigin: 'https://threadplane.ai/',
        candidates: [candidate],
        context,
      })
    ).toThrow();
    expect(() =>
      renderInstallDigest({
        businessDate: '2026-09-16',
        publicActionOrigin: 'https://threadplane.ai',
        candidates: [{ ...candidate, approveUrl: `${candidate.approveUrl}&x=1` }],
        context,
      })
    ).toThrow();
  });
});
