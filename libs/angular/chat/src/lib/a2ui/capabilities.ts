import { A2UI_BASIC_CATALOG_ID, type A2uiClientCapabilities } from '@threadplane/a2ui';

/**
 * The A2UI client capabilities this renderer supports — the typed
 * `a2uiClientCapabilities` metadata a host attaches to agent requests so
 * the agent knows which component catalogs it may target
 * (catalog negotiation, A2UI v0.9 transport metadata).
 *
 * @example
 * ```ts
 * const metadata = { a2uiClientCapabilities: a2uiClientCapabilities() };
 * ```
 */
export function a2uiClientCapabilities(): A2uiClientCapabilities {
  return { supportedCatalogIds: [A2UI_BASIC_CATALOG_ID] };
}
