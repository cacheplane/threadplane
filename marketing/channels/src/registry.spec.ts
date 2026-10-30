import { describe, expect, it } from 'vitest';
import { createAdapter, getAdapter } from './registry.ts';

describe('registry', () => {
  it('createAdapter returns fresh instances and getAdapter stays a singleton', () => {
    const options = { devto: { credentials: { apiKey: 'k' } } };
    const a = createAdapter('devto', options);
    const b = createAdapter('devto', options);
    expect(a).not.toBe(b);
    expect(a.id).toBe('devto');

    const prev = process.env.DEVTO_API_KEY;
    process.env.DEVTO_API_KEY = 'env-key';
    try {
      expect(getAdapter('devto')).toBe(getAdapter('devto'));
    } finally {
      if (prev === undefined) delete process.env.DEVTO_API_KEY;
      else process.env.DEVTO_API_KEY = prev;
    }
  });

  it('createAdapter builds x and linkedin from injected credentials without env', () => {
    const x = createAdapter('x', {
      x: {
        credentials: {
          clientId: 'c',
          clientSecret: 's',
          accessToken: 'a',
          refreshToken: 'r',
          userHandle: 'h',
        },
      },
    });
    const li = createAdapter('linkedin', {
      linkedin: { credentials: { accessToken: 't', authorUrn: 'urn:li:person:a' } },
    });
    expect(x.id).toBe('x');
    expect(li.id).toBe('linkedin');
  });
});
