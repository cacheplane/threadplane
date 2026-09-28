import { describe, expect, it } from 'vitest';
import { classify } from './transition.js';
import type { MarkdownDocument } from './types.js';

const document = (
  content: string,
  phase: MarkdownDocument['phase'] = 'streaming',
  generation = 'a'
): MarkdownDocument => ({ content, phase, generation });
describe('Markdown transitions', () => {
  it.each([
    [document('hello'), document('hello'), { kind: 'noop' }],
    [
      document('hello', 'complete'),
      document('hello', 'complete'),
      { kind: 'noop' },
    ],
    [
      document('hello'),
      document('hello world'),
      { kind: 'append', suffix: ' world', finish: false },
    ],
    [
      document('hello'),
      document('hello world', 'complete'),
      { kind: 'append', suffix: ' world', finish: true },
    ],
    [
      document('hello'),
      document('hello', 'complete'),
      { kind: 'append', suffix: '', finish: true },
    ],
    [
      document(''),
      document('', 'complete'),
      { kind: 'append', suffix: '', finish: true },
    ],
    [
      document('hello'),
      document('hi'),
      { kind: 'violation', reason: 'content-shrink' },
    ],
    [
      document('hello'),
      document('world'),
      { kind: 'violation', reason: 'content-divergence' },
    ],
    [
      document('hello', 'complete'),
      document('hello'),
      { kind: 'violation', reason: 'complete-to-streaming' },
    ],
    [
      document('hello', 'complete'),
      document('hello!', 'complete'),
      { kind: 'violation', reason: 'post-completion-content-mutation' },
    ],
    [
      document('hello', 'complete'),
      document('', 'streaming', 'b'),
      { kind: 'replace' },
    ],
    [
      document('hello'),
      document('other', 'complete', 'b'),
      { kind: 'replace' },
    ],
  ])('classifies %j → %j', (prior, next, expected) => {
    expect(classify(prior, next)).toEqual(expected);
  });
});
