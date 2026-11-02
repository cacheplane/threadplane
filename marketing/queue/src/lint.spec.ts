import { describe, expect, it } from 'vitest';
import { lintPublicCopy } from './lint.ts';

describe('lintPublicCopy', () => {
  it('CopilotKit is blocking competitor_name', () => {
    const flags = lintPublicCopy('Compared with copilotkit today', 'x');
    expect(flags).toContainEqual({ code: 'competitor_name', blocking: true, match: 'copilotkit' });
  });

  it('flags the other competitor names', () => {
    for (const name of ['assistant-ui', 'TanStack AI', 'Vercel AI SDK']) {
      expect(lintPublicCopy(`try ${name}`, 'blog').some((f) => f.code === 'competitor_name')).toBe(true);
    }
  });

  it('politics is blocking', () => {
    const flags = lintPublicCopy('The election changes nothing', 'linkedin');
    expect(flags).toContainEqual({ code: 'politics', blocking: true, match: 'election' });
  });

  it('banned phrases warn', () => {
    const flags = lintPublicCopy('A game-changing, blazing fast release', 'x');
    expect(flags.filter((f) => f.code === 'banned_phrase').every((f) => !f.blocking)).toBe(true);
    expect(flags.some((f) => f.code === 'banned_phrase')).toBe(true);
  });

  it('em dash warns on x but not blog', () => {
    expect(lintPublicCopy('one — two', 'x')).toContainEqual({ code: 'em_dash', blocking: false, match: '—' });
    expect(lintPublicCopy('one — two', 'blog').some((f) => f.code === 'em_dash')).toBe(false);
  });

  it('hashtags warn only above one and only on social', () => {
    expect(lintPublicCopy('ship it #angular', 'x')).toEqual([]);
    expect(lintPublicCopy('ship it #angular #ai', 'linkedin').some((f) => f.code === 'hashtags')).toBe(true);
    expect(lintPublicCopy('#a #b', 'devto').some((f) => f.code === 'hashtags')).toBe(false);
  });

  it('a [BRIAN: ...] marker is blocking on every channel', () => {
    for (const channel of ['x', 'linkedin', 'devto', 'blog'] as const) {
      expect(lintPublicCopy('shipped in [BRIAN: which version?] today', channel)).toContainEqual({
        code: 'brian_marker',
        blocking: true,
        match: '[BRIAN: which version?]',
      });
    }
  });

  it('machine-sounding words warn, inflections and curly apostrophes included', () => {
    for (const text of ['we leveraged signals', 'Seamlessly streams', 'here’s the thing about state']) {
      const flags = lintPublicCopy(text, 'x');
      expect(flags.some((f) => f.code === 'banned_phrase' && !f.blocking)).toBe(true);
    }
    expect(lintPublicCopy('the elevator pitch', 'x')).toEqual([]);
  });

  it('the "not X but Y" cadence warns, ordinary "not sure, but" does not', () => {
    expect(lintPublicCopy('it is not a library but a protocol', 'linkedin').some((f) => f.code === 'cadence')).toBe(true);
    expect(lintPublicCopy('not just faster, but simpler', 'x').some((f) => f.code === 'cadence')).toBe(true);
    expect(lintPublicCopy('not sure, but it works', 'x')).toEqual([]);
  });

  it('more than one emoji warns on social only', () => {
    expect(lintPublicCopy('love it 💚', 'x')).toEqual([]);
    expect(lintPublicCopy('love it 💚🔥', 'x')).toContainEqual({ code: 'emoji', blocking: false, match: '💚 🔥' });
    expect(lintPublicCopy('💚🔥', 'blog').some((f) => f.code === 'emoji')).toBe(false);
  });

  it('clean text has no flags', () => {
    expect(lintPublicCopy('Signals make streaming state easy to read.', 'x')).toEqual([]);
  });
});
