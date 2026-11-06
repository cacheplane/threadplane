import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXAMPLE_RESOLUTION,
  DEFAULT_EXAMPLE_RUN_HREF,
} from './docs-index-example';

describe('docs index default example', () => {
  it('resolves the default example to a mapped capability so the Run link cannot be dead', () => {
    expect(DEFAULT_EXAMPLE_RESOLUTION.kind).toBe('mapped');
    expect(DEFAULT_EXAMPLE_RUN_HREF).toBe(
      '/docs/angular/langgraph/guides/streaming?mode=run'
    );
  });
});
