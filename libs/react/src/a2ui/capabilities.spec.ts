import { describe, expect, it } from 'vitest';
import { a2uiClientCapabilities } from './index';

describe('a2uiClientCapabilities', () => {
  it('advertises the basic catalog the React renderer supports', () => {
    // The same id as A2UI_BASIC_CATALOG_ID in @threadplane/a2ui, which this layer cannot import.
    expect(a2uiClientCapabilities()).toEqual({
      supportedCatalogIds: [
        'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
      ],
    });
  });

  it('returns a new plain object each call', () => {
    const first = a2uiClientCapabilities();
    first.supportedCatalogIds.push('other');
    expect(a2uiClientCapabilities().supportedCatalogIds).toHaveLength(1);
    expect(Object.getPrototypeOf(first)).toBe(Object.prototype);
  });
});
