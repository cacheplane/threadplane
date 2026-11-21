import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ChatMathRenderer, provideChatMath } from './katex-loader';

describe('ChatMathRenderer', () => {
  it('renders nothing and loads nothing without provideChatMath', async () => {
    TestBed.configureTestingModule({});
    const math = TestBed.inject(ChatMathRenderer);
    expect(math.render('x^2', false)).toBeNull();
    await math.loaded();
    expect(math.ready()).toBe(false);
    expect(math.render('x^2', false)).toBeNull();
  });

  describe('with the application KaTeX', () => {
    async function renderer() {
      TestBed.configureTestingModule({
        providers: [provideChatMath(() => import('katex'))],
      });
      const math = TestBed.inject(ChatMathRenderer);
      await math.loaded();
      return math;
    }

    it('renders inline LaTeX to KaTeX HTML', async () => {
      const math = await renderer();
      expect(math.ready()).toBe(true);
      expect(math.render('x^2 + y^2', false)).toContain('katex');
    });

    it('renders display LaTeX with displayMode markup', async () => {
      const html = (await renderer()).render('\\sum_{i=0}^n i', true);
      expect(html).toContain('katex-display');
    });

    it('returns null (raw-fallback signal) for invalid LaTeX, no throw', async () => {
      const math = await renderer();
      expect(() => math.render('\\frac{', false)).not.toThrow();
      expect(math.render('\\frac{', false)).toBeNull();
    });
  });

  it('loads once, and a failed load falls back to raw source', async () => {
    let calls = 0;
    TestBed.configureTestingModule({
      providers: [
        provideChatMath(() => {
          calls++;
          return Promise.reject(new Error('offline'));
        }),
      ],
    });
    const math = TestBed.inject(ChatMathRenderer);
    expect(math.render('x', false)).toBeNull();
    expect(math.render('y', false)).toBeNull();
    await math.loaded();
    expect(calls).toBe(1);
    expect(math.ready()).toBe(false);
  });
});
