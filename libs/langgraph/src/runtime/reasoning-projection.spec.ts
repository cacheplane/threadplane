import { describe, expect, it } from 'vitest';
import { projectReasoning } from './reasoning-projection';

describe('owned reasoning projection', () => {
  it.each(['top', ''])('prefers the top-level string %j', (reasoning) => {
    expect(
      projectReasoning({
        reasoning,
        additional_kwargs: { reasoning_content: 'other' },
        content: [{ type: 'reasoning', text: 'block' }],
      })
    ).toBe(reasoning);
  });
  it.each(['kwargs', ''])(
    'falls through unsupported top-level data to kwargs %j',
    (reasoning_content) => {
      expect(
        projectReasoning({
          reasoning: {},
          additional_kwargs: { reasoning_content },
          content: [{ type: 'reasoning', text: 'block' }],
        })
      ).toBe(reasoning_content);
    }
  );
  it('concatenates supported block strings and summaries in order without duplicating thinking', () => {
    const raw = {
      reasoning: 1,
      additional_kwargs: { reasoning_content: [] },
      content: [
        { type: 'text', text: 'Answer' },
        {
          type: 'reasoning',
          text: 'A',
          summary: [{ text: 'B' }, { text: 4 }, { text: 'C' }],
        },
        { type: 'thinking', thinking: 'D', summary: [{ text: 'E' }] },
        { type: 'thinking', text: '', thinking: 'Ignored' },
        { type: 'thinking', text: 'F', thinking: 'Ignored' },
      ],
    };
    expect(projectReasoning(raw)).toBe('ABCDEF');
    expect(Object.isFrozen(raw.content)).toBe(false);
  });
  it.each([
    { content: 'Answer' },
    {
      content: [
        { type: 'text', text: 'Answer' },
        { type: 'image', text: 'Image' },
        { type: 'tool', text: 'Tool' },
      ],
    },
    { metadata: { reasoning: 'Other' } },
    {},
  ])('does not infer reasoning from unsupported data %j', (raw) => {
    expect(projectReasoning(raw)).toBeUndefined();
  });
  it.each(['reasoning', 'thinking'])(
    'distinguishes an empty recognized %s block from absence',
    (type) => {
      expect(
        projectReasoning({
          content: [{ type, text: {}, summary: [null, { text: [] }] }],
        })
      ).toBe('');
    }
  );
  it('captures supported getter strings once', () => {
    let reads = 0;
    const raw = {
      get reasoning() {
        return ++reads === 1 ? 'Captured' : 'Changed';
      },
    };
    expect(projectReasoning(raw)).toBe('Captured');
    expect(reads).toBe(1);
  });
});
