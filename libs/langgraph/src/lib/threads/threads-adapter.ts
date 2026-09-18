import { Injectable, InjectionToken, inject, signal, type Signal, type WritableSignal } from '@angular/core';
import type { Client, Thread as SdkThread } from '@langchain/langgraph-sdk';
import type { Thread } from '@threadplane/chat';
import {
  createLangGraphClient,
  ɵcreateProtectedLangGraphClient,
} from '../client/create-langgraph-client';
import { LANGGRAPH_CLIENT_OPTIONS } from '../client/client-options';
import {
  createLangGraphRuntimeFetch,
  createSafeRequestError,
  sanitizeLangGraphClientOperationFailure,
  ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER,
} from '../runtime-operation-reporter';

/**
 * Configuration consumed by {@link LangGraphThreadsAdapter}. Provide
 * via {@link LANGGRAPH_THREADS_CONFIG} (typically in app.config.ts):
 *
 * ```ts
 * providers: [
 *   { provide: LANGGRAPH_THREADS_CONFIG, useValue: {
 *       apiUrl: environment.langGraphApiUrl,
 *   }},
 * ],
 * ```
 *
 * The adapter expects backends to write the thread title to
 * `metadata.title`. Spec 2026-05-19-llm-generated-labels-design.md
 * originally proposed `metadata.thread_title` for cockpit caps but
 * we converged on `title` to match the canonical demo and avoid a
 * per-cap configuration knob.
 */
export interface LangGraphThreadsConfig {
  /** Base URL for the LangGraph Platform API. Accepts both absolute
   *  URLs and relative `/api`-style paths. */
  apiUrl: string;
  /** Fallback label for threads whose title hasn't been written yet
   *  (e.g. created but never sent). Defaults to `'Untitled'`. */
  titleFallback?: string;
}

export const LANGGRAPH_THREADS_CONFIG = new InjectionToken<LangGraphThreadsConfig>(
  'LANGGRAPH_THREADS_CONFIG',
);

/** Optional adapter clients can pass an explicit Client (e.g. for
 *  testing). When omitted, the adapter constructs one via
 *  {@link createLangGraphClient}. */
export const LANGGRAPH_CLIENT = new InjectionToken<Client>('LANGGRAPH_CLIENT');

/**
 * SDK-backed thread store. Wraps `client.threads.*` and maps SDK
 * threads to the framework's {@link Thread} type for direct use with
 * `<chat-thread-list>` / `<chat-sidenav>`.
 *
 * Consumers wire the framework's `ThreadActionAdapter` to instance
 * methods (rename/delete/archive/pin/...) so the right-click menu
 * round-trips through the LangGraph SDK without per-app boilerplate.
 *
 * @example
 * ```ts
 * const svc = inject(LangGraphThreadsAdapter);
 * const actions: ThreadActionAdapter = {
 *   rename: (id, t) => svc.rename(id, t),
 *   delete: (id) => svc.delete(id),
 * };
 * ```
 */
@Injectable({ providedIn: 'root' })
export class LangGraphThreadsAdapter {
  private readonly config = inject(LANGGRAPH_THREADS_CONFIG);
  private readonly clientState = (() => {
    const clientOptions = inject(LANGGRAPH_CLIENT_OPTIONS, { optional: true }) ?? undefined;
    const reportOperationFailure =
      inject(ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER, { optional: true }) ??
      undefined;
    const injectedClient = inject(LANGGRAPH_CLIENT, { optional: true });
    const ownsProtectedClient =
      injectedClient === null &&
      (clientOptions?.defaultHeaders !== undefined ||
        reportOperationFailure !== undefined);
    return {
      client:
        injectedClient ??
        (ownsProtectedClient
          ? ɵcreateProtectedLangGraphClient(
              this.config.apiUrl,
              clientOptions,
              createLangGraphRuntimeFetch(reportOperationFailure)
            )
          : createLangGraphClient(this.config.apiUrl, clientOptions)),
      protectErrors:
        clientOptions?.defaultHeaders !== undefined || ownsProtectedClient,
      reportOperationFailure: ownsProtectedClient
        ? reportOperationFailure
        : undefined,
    };
  })();
  private readonly client: Client = this.clientState.client;

  private readonly fallback: string = this.config.titleFallback ?? 'Untitled';

  private readonly _threads: WritableSignal<Thread[]> = signal<Thread[]>([]);
  private readonly _archived: WritableSignal<Thread[]> = signal<Thread[]>([]);

  /** Active (non-archived) threads, sorted with pinned first. */
  readonly threads: Signal<Thread[]> = this._threads.asReadonly();
  /** Threads whose `metadata.archived === true`. */
  readonly archivedThreads: Signal<Thread[]> = this._archived.asReadonly();

  /** Fetch the latest thread list from the server. Failures are
   *  logged via `console.error` (not swallowed silently — silent
   *  catches have masked prod issues in the past).
   *
   *  Invocation and resolution are logged at `console.debug` so prod
   *  inspection can distinguish "never called" from "called but
   *  resolved empty" from "called and threw." This was prompted by a
   *  demo.threadplane.ai cold-load bug where the sidenav stayed empty
   *  with no visible signal. Tighten the log volume if it becomes
   *  noisy. */
  async refresh(): Promise<void> {
    console.debug('[LangGraphThreadsAdapter.refresh] invoked');
    try {
      const list = await this.client.threads.search({ limit: 50 });
      console.debug('[LangGraphThreadsAdapter.refresh] resolved', list.length);
      const mapped = list.map((t) => this.toThread(t));
      this._threads.set(
        mapped
          .filter((t) => t.status !== 'archived')
          .sort((a, b) => {
            const aP = a.pinned === true;
            const bP = b.pinned === true;
            if (aP !== bP) return Number(bP) - Number(aP);
            if (aP && bP) {
              const aO = typeof a['pinnedOrder'] === 'number' ? (a['pinnedOrder'] as number) : Infinity;
              const bO = typeof b['pinnedOrder'] === 'number' ? (b['pinnedOrder'] as number) : Infinity;
              return aO - bO;
            }
            return 0;
          }),
      );
      this._archived.set(mapped.filter((t) => t.status === 'archived'));
    } catch (e) {
      console.error('[LangGraphThreadsAdapter.refresh] failed:', this.safeError(e));
    }
  }

  /** Fetch a single thread by id. Returns `null` when the server
   *  returns 404 (thread doesn't exist) so callers can distinguish
   *  "missing" from "couldn't reach the server" — genuine network
   *  errors rethrow. Used by URL-based thread routing to validate a
   *  pasted/shared thread id before activating it. */
  async getThread(threadId: string): Promise<Thread | null> {
    try {
      const t = await this.client.threads.get(threadId);
      return this.toThread(t);
    } catch (e) {
      // SDK throws HTTPError-like objects without a typed error class;
      // sniff status on the error or its nested response. Treat both
      // 404 (server says "no such thread") and 422 (server says "id
      // isn't even a valid UUID") as "missing" — both warrant the
      // same caller behavior (redirect to a fresh chat).
      const status = safeThreadErrorStatus(e);
      if (status === 404 || status === 422) return null;
      throw this.safeError(e);
    }
  }

  async create(metadata: Record<string, unknown> = {}): Promise<string | null> {
    try {
      const t = await this.client.threads.create({ metadata });
      await this.refresh();
      return t.thread_id;
    } catch (e) {
      console.error('[LangGraphThreadsAdapter.create] failed:', this.safeError(e));
      return null;
    }
  }

  async delete(threadId: string): Promise<void> {
    await this.request(() => this.client.threads.delete(threadId));
    await this.refresh();
  }

  async rename(threadId: string, newTitle: string): Promise<void> {
    await this.request(() => this.client.threads.update(threadId, { metadata: { title: newTitle } }));
    await this.refresh();
  }

  async archive(threadId: string): Promise<void> {
    await this.request(() => this.client.threads.update(threadId, { metadata: { archived: true } }));
    await this.refresh();
  }

  async unarchive(threadId: string): Promise<void> {
    await this.request(() => this.client.threads.update(threadId, { metadata: { archived: false } }));
    await this.refresh();
  }

  async pin(threadId: string): Promise<void> {
    await this.request(() => this.client.threads.update(threadId, { metadata: { pinned: true } }));
    await this.refresh();
  }

  async unpin(threadId: string): Promise<void> {
    await this.request(() => this.client.threads.update(threadId, { metadata: { pinned: false } }));
    await this.refresh();
  }

  async moveToProject(threadId: string, projectId: string | null): Promise<void> {
    await this.request(() => this.client.threads.update(threadId, { metadata: { projectId } }));
    await this.refresh();
  }

  /** Re-stamp `metadata.pinnedOrder = 0,1,2,...` for the pinned slice
   *  to reflect the new ordering. */
  async reorderPinned(threadId: string, beforeId: string | null): Promise<void> {
    const current = this._threads().filter((t) => t.pinned === true);
    const moved = current.find((t) => t.id === threadId);
    if (!moved) return;
    const rest = current.filter((t) => t.id !== threadId);
    const next: Thread[] = [];
    for (const t of rest) {
      if (t.id === beforeId) next.push(moved);
      next.push(t);
    }
    if (beforeId === null) next.push(moved);

    await this.request(() =>
      Promise.all(
        next.map((t, idx) =>
          this.client.threads.update(t.id, { metadata: { pinnedOrder: idx } }),
        ),
      ),
    );
    await this.refresh();
  }

  private async request<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw this.safeError(error);
    }
  }

  private safeError(error: unknown): unknown {
    if (!this.clientState.protectErrors) return error;
    if (this.clientState.reportOperationFailure !== undefined) {
      return sanitizeLangGraphClientOperationFailure(
        error,
        this.clientState.reportOperationFailure
      );
    }
    return createSafeRequestError();
  }

  private toThread(t: SdkThread): Thread {
    const meta = (t.metadata ?? {}) as Record<string, unknown>;
    const rawTitle = meta['title'];
    const archived = meta['archived'] === true;
    const pinned = meta['pinned'] === true;
    const projectId = typeof meta['projectId'] === 'string' && (meta['projectId'] as string).length > 0
      ? (meta['projectId'] as string)
      : null;
    const pinnedOrder = typeof meta['pinnedOrder'] === 'number' ? (meta['pinnedOrder'] as number) : undefined;
    return {
      id: t.thread_id,
      title: typeof rawTitle === 'string' && rawTitle.length > 0 ? rawTitle : this.fallback,
      status: archived ? 'archived' : 'active',
      pinned,
      projectId,
      pinnedOrder,
      updatedAt: t.updated_at ? Date.parse(t.updated_at) : undefined,
    };
  }
}

function safeThreadErrorStatus(error: unknown): number | null {
  try {
    if ((typeof error !== 'object' || error === null) && typeof error !== 'function') return null;
    const own = Object.getOwnPropertyDescriptor(error, 'status');
    if (own && 'value' in own && typeof own.value === 'number') return own.value;
    const responseDescriptor = Object.getOwnPropertyDescriptor(error, 'response');
    if (!responseDescriptor || !('value' in responseDescriptor)) return null;
    const response = responseDescriptor.value as unknown;
    if ((typeof response !== 'object' || response === null) && typeof response !== 'function') return null;
    const nested = Object.getOwnPropertyDescriptor(response, 'status');
    return nested && 'value' in nested && typeof nested.value === 'number'
      ? nested.value
      : null;
  } catch {
    return null;
  }
}
