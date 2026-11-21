import { describe, expect, it } from 'vitest';
import { A2UI_BASIC_CATALOG_ID } from '@threadplane/a2ui';
import { a2uiClientCapabilities } from './capabilities';

describe('a2uiClientCapabilities', () => {
  it('advertises the basic catalog', () => {
    expect(a2uiClientCapabilities()).toEqual({
      supportedCatalogIds: [A2UI_BASIC_CATALOG_ID],
    });
  });
});
