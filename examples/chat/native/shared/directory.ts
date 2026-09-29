import { Client, type ClientConfig } from '@langchain/langgraph-sdk';
import type { DirectoryResult, ThreadDirectory } from './contracts.js';
import { projectThread, projectThreads } from './projection.js';

export interface DirectoryOptions {
  readonly apiBase: string;
  readonly browserOrigin: string;
  readonly fetch?: typeof fetch;
}

// Identity is private to the owned fetch boundary. SDK errors and arbitrary
// thrown objects cannot manufacture a missing-conversation result.
class RejectedResponse extends Error {
  constructor(readonly status: number) {
    super('Directory request failed');
  }
}

const failure = (signal: AbortSignal) =>
  Object.freeze({
    kind: signal.aborted ? ('cancelled' as const) : ('failed' as const),
  });

export function createThreadDirectory(
  options: DirectoryOptions
): ThreadDirectory {
  const api = new URL(options.apiBase);
  if (
    !['http:', 'https:'].includes(api.protocol) ||
    api.origin !== new URL(options.browserOrigin).origin ||
    api.username ||
    api.password ||
    api.search ||
    api.hash
  )
    throw new Error('Directory requires an absolute same-origin API base');

  const fetchRequest = options.fetch ?? globalThis.fetch;
  const config: ClientConfig = {
    apiUrl: api.href,
    apiKey: null,
    callerOptions: {
      maxRetries: 0,
      fetch: async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        let response: Response;
        try {
          response = await fetchRequest(input, init);
        } catch {
          // Do not let the SDK inspect untrusted thrown values or messages.
          throw new Error('Directory request failed');
        }
        if (!response.ok) {
          // SDK HTTPError reads response.text(). Intercept before it can read
          // a hostile or indefinitely held error body, releasing transport.
          await response.body?.cancel().catch(() => {});
          throw new RejectedResponse(response.status);
        }
        return response;
      },
    },
  };
  const client = new Client(config);
  async function perform<T>(
    signal: AbortSignal,
    work: () => Promise<T>
  ): Promise<DirectoryResult<T>> {
    if (signal.aborted) return failure(signal);
    try {
      const value = await work();
      return signal.aborted
        ? failure(signal)
        : Object.freeze({ kind: 'ready', value });
    } catch {
      return failure(signal);
    }
  }
  return Object.freeze({
    async get(id: string, signal: AbortSignal) {
      if (signal.aborted) return failure(signal);
      // URL normalizes these segments even if their dots are percent encoded.
      if (id === '.' || id === '..') return failure(signal);
      try {
        const value = projectThread(
          await client.threads.get(encodeURIComponent(id), { signal })
        );
        return signal.aborted
          ? failure(signal)
          : Object.freeze({ kind: 'ready' as const, value });
      } catch (error) {
        if (
          !signal.aborted &&
          error instanceof RejectedResponse &&
          (error.status === 404 || error.status === 422)
        )
          return Object.freeze({ kind: 'missing' as const });
        return failure(signal);
      }
    },
    list(signal: AbortSignal) {
      return perform(signal, async () =>
        projectThreads(
          await client.threads.search({ limit: 50, offset: 0, signal })
        )
      );
    },
    create(signal: AbortSignal) {
      return perform(signal, async () =>
        projectThread(await client.threads.create({ signal }))
      );
    },
  });
}
