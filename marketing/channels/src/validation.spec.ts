import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateDraft, ValidationError } from './validation.ts';
import type { Draft } from './types.ts';

function baseX(): Draft {
  return { channel: 'x', text: 'hello' };
}

describe('validateDraft (X)', () => {
  it('accepts a minimal valid single-tweet draft', () => {
    expect(() => validateDraft(baseX())).not.toThrow();
  });

  it('rejects when both text and threadParts are set', () => {
    const d: Draft = { channel: 'x', text: 'hi', threadParts: ['a', 'b'] };
    expect(() => validateDraft(d)).toThrow(ValidationError);
    try {
      validateDraft(d);
    } catch (e) {
      expect((e as ValidationError).rule).toBe('exclusive-text-thread');
    }
  });

  it('rejects when neither text nor threadParts is set', () => {
    const d: Draft = { channel: 'x' };
    expect(() => validateDraft(d)).toThrow(/either text or threadParts/i);
  });

  it('rejects text > 280 chars', () => {
    const d: Draft = { channel: 'x', text: 'a'.repeat(281) };
    expect(() => validateDraft(d)).toThrow(/280/);
  });

  it('accepts text of exactly 280 chars', () => {
    const d: Draft = { channel: 'x', text: 'a'.repeat(280) };
    expect(() => validateDraft(d)).not.toThrow();
  });

  it('counts Unicode code points, not bytes, for length', () => {
    // 4-byte UTF-8 emoji is 1 code point. 280 of them = 280 code points.
    const d: Draft = { channel: 'x', text: '🎉'.repeat(280) };
    expect(() => validateDraft(d)).not.toThrow();
  });

  it('rejects threadParts length < 2', () => {
    const d: Draft = { channel: 'x', threadParts: ['only one'] };
    expect(() => validateDraft(d)).toThrow(/at least 2/i);
  });

  it('rejects any threadParts[i] > 280 chars', () => {
    const d: Draft = { channel: 'x', threadParts: ['ok', 'a'.repeat(281)] };
    expect(() => validateDraft(d)).toThrow(/280/);
  });

  it('rejects > 4 media', () => {
    const m = { png: Buffer.from('a'), alt: 'x' };
    const d: Draft = { channel: 'x', text: 'hi', media: [m, m, m, m, m] };
    expect(() => validateDraft(d)).toThrow(/at most 4 media/i);
  });

  it('rejects empty alt text', () => {
    const d: Draft = {
      channel: 'x',
      text: 'hi',
      media: [{ png: Buffer.from('a'), alt: '' }],
    };
    expect(() => validateDraft(d)).toThrow(/alt text/i);
  });

  it('rejects alt text > 1000 chars', () => {
    const d: Draft = {
      channel: 'x',
      text: 'hi',
      media: [{ png: Buffer.from('a'), alt: 'a'.repeat(1001) }],
    };
    expect(() => validateDraft(d)).toThrow(/1000/);
  });

  it('rejects PNG > 5 MB', () => {
    const d: Draft = {
      channel: 'x',
      text: 'hi',
      media: [{ png: Buffer.alloc(5 * 1024 * 1024 + 1), alt: 'x' }],
    };
    expect(() => validateDraft(d)).toThrow(/5 ?MB/i);
  });

  it('rejects unknown channel for X adapter sanity check', () => {
    const d: Draft = { channel: 'linkedin' as 'x', text: 'hi' };
    expect(() => validateDraft(d, { adapterId: 'x' })).toThrow(/channel mismatch/i);
  });
});

describe('validateDraft (other channels)', () => {
  it('throws not-yet-implemented for reddit', () => {
    const d: Draft = { channel: 'reddit', text: 'hi' };
    expect(() => validateDraft(d)).toThrow(/not yet implemented/i);
  });
});

function baseLinkedIn(): Draft {
  return { channel: 'linkedin', text: 'hello' };
}

function ruleOf(d: Draft): string | undefined {
  try {
    validateDraft(d);
  } catch (e) {
    return (e as ValidationError).rule;
  }
  return undefined;
}

describe('validateDraft (LinkedIn)', () => {
  let partnerComments: string | undefined;
  beforeEach(() => {
    partnerComments = process.env.LINKEDIN_PARTNER_COMMENTS;
    process.env.LINKEDIN_PARTNER_COMMENTS = '1';
  });
  afterEach(() => {
    if (partnerComments === undefined) delete process.env.LINKEDIN_PARTNER_COMMENTS;
    else process.env.LINKEDIN_PARTNER_COMMENTS = partnerComments;
  });

  it('rejects firstComment without partner access, before anything is posted', () => {
    delete process.env.LINKEDIN_PARTNER_COMMENTS;
    expect(ruleOf({ ...baseLinkedIn(), firstComment: 'link' })).toBe(
      'linkedin-comment-needs-partner',
    );
    expect(ruleOf(baseLinkedIn())).toBeUndefined();
  });

  it('accepts text with one image and a first comment', () => {
    const d: Draft = {
      ...baseLinkedIn(),
      media: [{ png: Buffer.from('a'), alt: 'alt' }],
      firstComment: 'link: https://threadplane.ai',
    };
    expect(() => validateDraft(d)).not.toThrow();
  });

  it('requires non-blank text', () => {
    expect(ruleOf({ channel: 'linkedin' })).toBe('linkedin-text-required');
    expect(ruleOf({ channel: 'linkedin', text: '  ' })).toBe('linkedin-text-required');
  });

  it('accepts 3000 code points and rejects 3001', () => {
    expect(ruleOf({ channel: 'linkedin', text: '→'.repeat(3000) })).toBeUndefined();
    expect(ruleOf({ channel: 'linkedin', text: '→'.repeat(3001) })).toBe('linkedin-text-too-long');
  });

  it('rejects threads and link previews', () => {
    expect(ruleOf({ ...baseLinkedIn(), threadParts: ['a', 'b'] })).toBe('linkedin-no-threads');
    expect(ruleOf({ ...baseLinkedIn(), link: { url: 'https://threadplane.ai' } })).toBe(
      'linkedin-no-link-preview',
    );
  });

  it('bounds firstComment to 1-1250 code points', () => {
    expect(ruleOf({ ...baseLinkedIn(), firstComment: '' })).toBe('linkedin-comment-length');
    expect(ruleOf({ ...baseLinkedIn(), firstComment: 'a'.repeat(1250) })).toBeUndefined();
    expect(ruleOf({ ...baseLinkedIn(), firstComment: 'a'.repeat(1251) })).toBe(
      'linkedin-comment-length',
    );
  });

  it('allows at most one image, with alt text and the 5MB cap', () => {
    const img = { png: Buffer.from('a'), alt: 'alt' };
    expect(ruleOf({ ...baseLinkedIn(), media: [img, img] })).toBe('linkedin-too-many-media');
    expect(ruleOf({ ...baseLinkedIn(), media: [{ ...img, alt: '' }] })).toBe('alt-required');
    expect(
      ruleOf({ ...baseLinkedIn(), media: [{ ...img, png: Buffer.alloc(5 * 1024 * 1024 + 1) }] }),
    ).toBe('png-too-large');
  });
});

describe('validateDraft (Dev.to)', () => {
  function baseDevTo(): Draft {
    return {
      channel: 'devto',
      text: '# Title\n\nBody content here.',
      article: {
        title: 'My Article',
        tags: ['angular', 'tutorial'],
        canonicalUrl: 'https://threadplane.ai/blog/my-article',
        description: 'A description.',
      },
    };
  }

  it('accepts a minimal valid devto draft', () => {
    expect(() => validateDraft(baseDevTo())).not.toThrow();
  });

  it('rejects missing text', () => {
    const d = baseDevTo();
    delete d.text;
    expect(() => validateDraft(d)).toThrow(/body markdown.*is required/i);
  });

  it('rejects empty text', () => {
    const d = baseDevTo();
    d.text = '';
    expect(() => validateDraft(d)).toThrow(/body markdown.*is required/i);
  });

  it('rejects missing article', () => {
    const d = baseDevTo();
    delete d.article;
    expect(() => validateDraft(d)).toThrow(/article is required/i);
  });

  it('rejects missing title', () => {
    const d = baseDevTo();
    d.article!.title = '';
    expect(() => validateDraft(d)).toThrow(/title must be 1-128/i);
  });

  it('rejects title > 128 chars', () => {
    const d = baseDevTo();
    d.article!.title = 'a'.repeat(129);
    expect(() => validateDraft(d)).toThrow(/title must be 1-128/i);
  });

  it('rejects > 4 tags', () => {
    const d = baseDevTo();
    d.article!.tags = ['a', 'b', 'c', 'd', 'e'];
    expect(() => validateDraft(d)).toThrow(/at most 4 tags/i);
  });

  it('rejects tag with hyphen', () => {
    const d = baseDevTo();
    d.article!.tags = ['lang-graph'];
    expect(() => validateDraft(d)).toThrow(/tag "lang-graph"/);
  });

  it('rejects tag with uppercase', () => {
    const d = baseDevTo();
    d.article!.tags = ['Angular'];
    expect(() => validateDraft(d)).toThrow(/tag "Angular"/);
  });

  it('rejects tag with underscore', () => {
    const d = baseDevTo();
    d.article!.tags = ['lang_graph'];
    expect(() => validateDraft(d)).toThrow(/tag "lang_graph"/);
  });

  it('rejects tag > 30 chars', () => {
    const d = baseDevTo();
    d.article!.tags = ['a'.repeat(31)];
    expect(() => validateDraft(d)).toThrow(/tag .* must match/);
  });

  it('rejects non-https canonical URL', () => {
    const d = baseDevTo();
    d.article!.canonicalUrl = 'http://insecure.example.com';
    expect(() => validateDraft(d)).toThrow(/must use https:/);
  });

  it('rejects invalid canonical URL', () => {
    const d = baseDevTo();
    d.article!.canonicalUrl = 'not-a-url';
    expect(() => validateDraft(d)).toThrow(/not a valid URL/);
  });

  it('rejects threadParts set on devto draft', () => {
    const d = baseDevTo();
    d.threadParts = ['part 1', 'part 2'];
    expect(() => validateDraft(d)).toThrow(/does not support threads/i);
  });

  it('rejects media set on devto draft', () => {
    const d = baseDevTo();
    d.media = [{ png: Buffer.from('a'), alt: 'a' }];
    expect(() => validateDraft(d)).toThrow(/does not accept media uploads/i);
  });

  it('accepts draft with no tags', () => {
    const d = baseDevTo();
    delete d.article!.tags;
    expect(() => validateDraft(d)).not.toThrow();
  });

  it('accepts draft with no canonical URL', () => {
    const d = baseDevTo();
    delete d.article!.canonicalUrl;
    expect(() => validateDraft(d)).not.toThrow();
  });
});
