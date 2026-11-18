/** Catalog id of the standard A2UI basic component catalog that `a2uiBasicCatalog` renders. */
const BASIC_CATALOG_ID =
  'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';

/**
 * The A2UI client capabilities this renderer supports: the catalog ids an agent may target
 * (A2UI v0.9 catalog negotiation). Each call returns a new plain object.
 *
 * With the AG-UI runtime, send it in the run state under `a2ui_client_capabilities`, the key
 * the agent reads:
 *
 * ```ts
 * session.submit({ message, state: { a2ui_client_capabilities: a2uiClientCapabilities() } });
 * ```
 */
export function a2uiClientCapabilities(): { supportedCatalogIds: string[] } {
  return { supportedCatalogIds: [BASIC_CATALOG_ID] };
}
