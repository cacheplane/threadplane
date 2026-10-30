import { describe, expect, it } from 'vitest';
import { validateCues } from './encode-docs-media.mjs';

describe('recorded documentation captions', () => {
  it('accepts readable captions tied to the measured recording', () => {
    expect(() =>
      validateCues([{ from: 0, to: 3, text: 'Send a message.' }], 4)
    ).not.toThrow();
  });
  it('rejects gaps in evidence, overlaps, overflow and unreadable captions', () => {
    expect(() => validateCues([], 4)).toThrow();
    expect(() =>
      validateCues([{ from: 0, to: 5, text: 'Send.' }], 4)
    ).toThrow();
    expect(() =>
      validateCues([{ from: 0, to: 0.1, text: 'Send a message.' }], 4)
    ).toThrow();
    expect(() =>
      validateCues(
        [
          { from: 0, to: 2, text: 'Send.' },
          { from: 1, to: 3, text: 'Read.' },
        ],
        4
      )
    ).toThrow();
  });
});
