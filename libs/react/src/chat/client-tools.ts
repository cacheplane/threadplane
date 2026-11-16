'use client';
import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { PlainValue } from '@threadplane/core';
import type { ExecutionContext, FunctionTool } from '@threadplane/core/tools';

/** What an ask tool's view receives for one pending call. */
export interface AskToolViewProps<A, R> {
  readonly toolCallId: string;
  readonly name: string;
  /** The finalized arguments the tool was called with. */
  readonly args: A;
  /**
   * Returns the person's answer as the tool result, and the run continues. Only the first answer
   * counts; false means the call was already answered or stopped.
   */
  readonly answer: (result: R) => boolean;
}

/** A tool the model calls and the person answers in the transcript; see {@link ask}. */
export interface AskTool<A, R> {
  readonly kind: 'ask';
  readonly description: string;
  /** Optional caller-authored JSON Schema, sent unchanged as metadata. */
  readonly parameters?: PlainValue;
  /** Defaults to true; false persists the answer without another run. */
  readonly followUp?: boolean;
  /** Draws the control. Return an element; arguments are not validated before it is called. */
  readonly render: (props: AskToolViewProps<A, R>) => ReactNode;
}

/** Storage constraint for a catalog of ask tools with different argument and result types. */
export interface AskToolDefinition {
  readonly kind: 'ask';
  readonly description: string;
  readonly parameters?: PlainValue;
  readonly followUp?: boolean;
  readonly render: (props: never) => ReactNode;
}

/** A call a handler is waiting on the person to answer. */
export interface PendingClientToolCall {
  readonly name: string;
  readonly args: unknown;
}

/** The part of {@link ClientTools} that `Chat` reads; it never runs a tool itself. */
export interface ChatClientTools {
  /** Calls waiting for an answer, oldest first. A new array whenever one starts or ends. */
  getSnapshot(): readonly PendingClientToolCall[];
  subscribe(notify: () => void): () => void;
  /**
   * The view for a pending call of one of these tools, or `undefined` when the call is not one of
   * them, is already settled, or has no handler waiting (such as a call observed from history).
   */
  render(call: ClientToolCallLike): ReactNode | undefined;
}

/** The fields of a snapshot tool call that match it to a waiting handler. */
export interface ClientToolCallLike {
  readonly id: string;
  readonly name: string;
  readonly args?: unknown;
  readonly status: string;
}

type AskFunctionTool<T> = T extends {
  readonly render: (props: AskToolViewProps<infer A, infer R>) => ReactNode;
}
  ? FunctionTool<A, R>
  : never;

/** Ask tools as session function tools, plus the views `Chat` shows while they wait. */
export interface ClientTools<T extends Record<string, AskToolDefinition>>
  extends ChatClientTools {
  /** Pass to the session that runs the conversation, alone or spread beside other function tools. */
  readonly tools: { readonly [K in keyof T]: AskFunctionTool<T[K]> };
}

/**
 * Declares a tool the person answers. The model fills `args`; `render` draws the control in the
 * transcript below the message's tool calls, and the value passed to `answer` becomes the tool result.
 *
 * @example
 * ```tsx
 * const clientTools = createClientTools({
 *   pick_day: ask<{ days: string[] }, { day: string }>({
 *     description: 'Ask which day to plan.',
 *     render: ({ args, answer }) => <DayPicker days={args.days} onPick={(day) => answer({ day })} />,
 *   }),
 * });
 * ```
 */
export function ask<A, R>(tool: Omit<AskTool<A, R>, 'kind'>): AskTool<A, R> {
  return { ...tool, kind: 'ask' };
}

interface Waiting {
  readonly name: string;
  readonly args: unknown;
  readonly key: string;
  readonly answer: (result: unknown) => boolean;
  callId?: string;
}

/** Stable text for comparing a handler's arguments with a snapshot call's arguments. */
function argumentsKey(value: unknown): string {
  return (
    JSON.stringify(value, (_key, item: unknown) =>
      item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(
            Object.entries(item).sort(([a], [b]) =>
              a < b ? -1 : a > b ? 1 : 0
            )
          )
        : item
    ) ?? ''
  );
}

const cancelled = () =>
  new DOMException('Client tool cancelled.', 'AbortError');

/**
 * Turns ask tools into function tools for an app-owned session and keeps the calls that wait for
 * an answer. Create it once, pass `tools` to the session and the whole object to `Chat` as
 * `clientTools`. Stopping the run aborts a waiting call; nothing is persisted here.
 *
 * A handler is not told its call ID, so a waiting call is paired with the transcript call of the
 * same name and equal arguments, or else the oldest waiting call of that name. Identical calls
 * are interchangeable, and a view always answers the arguments it was drawn with.
 */
export function createClientTools<
  const T extends Record<string, AskToolDefinition>
>(definitions: T): ClientTools<T> {
  const owned = new Map(Object.entries(definitions));
  const listeners = new Set<() => void>();
  const waiting: Waiting[] = [];
  const claimed = new Map<string, Waiting>();
  let snapshot: readonly PendingClientToolCall[] = Object.freeze([]);
  function publish() {
    snapshot = Object.freeze(
      waiting.map(({ name, args }) => Object.freeze({ name, args }))
    );
    for (const notify of [...listeners]) notify();
  }
  function handler(name: string) {
    return (args: unknown, { signal }: ExecutionContext) =>
      new Promise<unknown>((resolve, reject) => {
        if (signal.aborted) {
          reject(cancelled());
          return;
        }
        let open = true;
        const close = () => {
          open = false;
          signal.removeEventListener('abort', abort);
          waiting.splice(waiting.indexOf(request), 1);
          if (request.callId !== undefined) claimed.delete(request.callId);
          publish();
        };
        const abort = () => {
          if (!open) return;
          close();
          reject(cancelled());
        };
        const request: Waiting = {
          name,
          args,
          key: argumentsKey(args),
          answer(result) {
            if (!open) return false;
            close();
            resolve(result);
            return true;
          },
        };
        signal.addEventListener('abort', abort, { once: true });
        waiting.push(request);
        publish();
      });
  }
  const tools = Object.freeze(
    Object.fromEntries(
      [...owned].map(([name, definition]) => [
        name,
        Object.freeze({
          description: definition.description,
          ...(definition.parameters !== undefined
            ? { parameters: definition.parameters }
            : {}),
          ...(definition.followUp !== undefined
            ? { followUp: definition.followUp }
            : {}),
          handler: handler(name),
        }),
      ])
    )
  ) as ClientTools<T>['tools'];
  return Object.freeze({
    tools,
    getSnapshot: () => snapshot,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    render(call: ClientToolCallLike) {
      if (call.status !== 'pending' && call.status !== 'running')
        return undefined;
      const definition = owned.get(call.name);
      if (!definition) return undefined;
      let request = claimed.get(call.id);
      if (!request) {
        // Pairing is idempotent, so a repeated or discarded render reaches the same result.
        const free = waiting.filter(
          (item) => item.name === call.name && item.callId === undefined
        );
        const key = argumentsKey(call.args);
        request = free.find((item) => item.key === key) ?? free[0];
        if (!request) return undefined;
        request.callId = call.id;
        claimed.set(call.id, request);
      }
      const render = definition.render as (
        props: AskToolViewProps<unknown, unknown>
      ) => ReactNode;
      return render({
        toolCallId: call.id,
        name: call.name,
        args: request.args,
        answer: request.answer,
      });
    },
  });
}

const NONE: readonly PendingClientToolCall[] = Object.freeze([]);
const noSubscription = () => () => undefined;
const none = () => NONE;

/** Calls waiting for the person, re-read whenever one starts or ends. Empty without `clientTools`. */
export function usePendingClientToolCalls(
  clientTools: ChatClientTools | undefined
): readonly PendingClientToolCall[] {
  const read = clientTools?.getSnapshot ?? none;
  return useSyncExternalStore(
    clientTools?.subscribe ?? noSubscription,
    read,
    read
  );
}

/**
 * A `renderToolCallPrompt` for `MessageList` that draws waiting ask tools below the message's tool
 * calls. `Chat` does this itself through its `clientTools` prop. The function changes only when a
 * call starts or stops waiting, so rows keep their memo otherwise.
 */
export function useClientToolCalls<TCall extends ClientToolCallLike>(
  clientTools: ChatClientTools | undefined
): ((call: TCall) => ReactNode) | undefined {
  // Read for its identity: a new array is a new set of waiting calls, so a new function.
  const pending = usePendingClientToolCalls(clientTools);
  return useMemo(
    () =>
      clientTools && pending
        ? (call: TCall) => clientTools.render(call)
        : undefined,
    [clientTools, pending]
  );
}
