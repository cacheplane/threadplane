import { Client } from '@langchain/langgraph-sdk';
import type { LangGraphClientOptions } from '../../runtime/transport.types.d.ts';

/**
 * Construct a LangGraph SDK Client that accepts both absolute URLs
 * (`http://localhost:2024`) and relative `/api`-style paths that get
 * proxied by middleware in production. The SDK itself rejects
 * relative URLs, so this helper rewrites them against
 * `window.location.origin` when running in the browser.
 *
 * Single source of truth for the absolute-URL rewrite — the streaming
 * transport (`fetch-stream.transport.ts`) and the threads adapter
 * (`LangGraphThreadsAdapter`) both go through here.
 *
 * `clientOptions.maxRetries` maps to the SDK's `callerOptions.maxRetries`,
 * which governs how many times a failed request (including the initial
 * stream connect) is retried with exponential backoff before the error
 * surfaces. Omitted → the SDK default (currently 4). Apps under test set
 * `0` so a forced connection failure surfaces immediately instead of after
 * the full backoff window.
 *
 * @example
 * ```ts
 * const client = createLangGraphClient(environment.langGraphApiUrl);
 * const threads = await client.threads.search({ limit: 50 });
 * ```
 */
export function createLangGraphClient(
  apiUrl: string,
  clientOptions?: LangGraphClientOptions,
): Client {
  return constructLangGraphClient(apiUrl, clientOptions);
}

/** @internal Default-transport-only constructor with a protected SDK fetch seam. */
export function ɵcreateProtectedLangGraphClient(
  apiUrl: string,
  clientOptions: LangGraphClientOptions | undefined,
  runtimeFetch: typeof fetch,
): Client {
  return constructLangGraphClient(apiUrl, clientOptions, runtimeFetch);
}

function constructLangGraphClient(
  apiUrl: string,
  clientOptions?: LangGraphClientOptions,
  runtimeFetch?: typeof fetch,
): Client {
  return new Client({
    apiUrl: toAbsoluteApiUrl(apiUrl),
    // Never attach a deployment key from the browser adapter, and never let
    // the SDK read one from the environment. Credentials belong on the
    // endpoint the app owns; `defaultHeaders` carries a per-user session
    // token for LangGraph custom auth.
    apiKey: null,
    ...(clientOptions?.defaultHeaders !== undefined
      ? { defaultHeaders: clientOptions.defaultHeaders }
      : {}),
    ...(clientOptions?.maxRetries !== undefined || runtimeFetch !== undefined
      ? {
          callerOptions: {
            ...(clientOptions?.maxRetries !== undefined
              ? { maxRetries: clientOptions.maxRetries }
              : {}),
            ...(runtimeFetch !== undefined ? { fetch: runtimeFetch } : {}),
          },
        }
      : {}),
  });
}

/** Exported separately so non-Client callers (e.g. raw fetch) can
 *  share the same normalization logic. */
export function toAbsoluteApiUrl(apiUrl: string): string {
  if (apiUrl.startsWith('http://') || apiUrl.startsWith('https://')) return apiUrl;
  const browser = globalThis as typeof globalThis & { window?: { location: { origin: string } } };
  return browser.window !== undefined ? `${browser.window.location.origin}${apiUrl}` : apiUrl;
}
