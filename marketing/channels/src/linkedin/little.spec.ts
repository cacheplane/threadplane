import { describe, expect, it } from 'vitest';
import { escapeLittleText } from './little';

describe('escapeLittleText', () => {
  it('leaves plain text alone', () => {
    expect(escapeLittleText("It's simple → AG-UI.\n\nNew line.")).toBe(
      "It's simple → AG-UI.\n\nNew line.",
    );
  });

  it('escapes every reserved character', () => {
    expect(escapeLittleText('|{}@[]()<>\\*_~')).toBe(
      '\\|\\{\\}\\@\\[\\]\\(\\)\\<\\>\\\\\\*\\_\\~',
    );
  });

  it('escapes parentheses that would otherwise truncate a post', () => {
    expect(escapeLittleText('streams work (text, tool calls, and state) live')).toBe(
      'streams work \\(text, tool calls, and state\\) live',
    );
  });

  it('keeps hashtags live and escapes a stray #', () => {
    expect(escapeLittleText('#Angular #AIAgents and item # 2')).toBe(
      '#Angular #AIAgents and item \\# 2',
    );
  });

  it('keeps underscores in URLs readable by escaping them', () => {
    expect(escapeLittleText('https://threadplane.ai/?utm_source=x')).toBe(
      'https://threadplane.ai/?utm\\_source=x',
    );
  });
});
