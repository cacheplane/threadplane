import type { Message } from '@threadplane/core';
import { copyData, messageKey } from './authority';

export type ChildStatus =
  | 'Receiving'
  | 'Observed response'
  | 'Stopped'
  | 'Incomplete';
export interface ChildRow {
  readonly key: string;
  readonly role: string;
  readonly text: string;
  readonly status: ChildStatus;
}
interface Entry {
  readonly namespace: readonly string[];
  readonly role?: string;
  readonly task?: string;
  readonly messages: readonly Message[];
}
interface Context {
  readonly generation: string;
  readonly rootIds: ReadonlySet<string>;
  readonly terminal: boolean;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === 'string' && !!value.trim();
const roles = ['research', 'booking', 'itinerary'];

/** One physical turn's local observations; never associates a child with a root call. */
export class ChildObservations {
  private entries = new Map<string, Entry>();
  private generation?: string;
  private unsafe = false;
  private ended = false;
  private status: ChildStatus = 'Receiving';

  constructor(private readonly view: string, private readonly turn: string) {}

  observe(input: readonly unknown[], context: Context): boolean {
    if (this.unsafe || this.ended) return false;
    try {
      const children = copyData(input);
      if (
        !Array.isArray(children) ||
        !text(context.generation) ||
        (this.generation !== undefined &&
          this.generation !== context.generation)
      )
        throw new Error('Invalid child generation');
      const next = new Map<string, Entry>();
      for (const child of children) {
        if (
          !record(child) ||
          !Array.isArray(child['namespace']) ||
          !child['namespace'].length ||
          !child['namespace'].every(text) ||
          !Array.isArray(child['messages']) ||
          !Array.isArray(child['interrupts']) ||
          child['interrupts'].length ||
          child['error']
        )
          throw new Error('Invalid child observation');
        const namespace = child['namespace'] as string[];
        const key = JSON.stringify(namespace);
        if (next.has(key)) throw new Error('Duplicate child namespace');
        const prior = this.entries.get(key);
        const values = child['values'];
        if (
          values !== undefined &&
          (!record(values) ||
            Object.keys(values).some(
              (key) => !['subagent_type', 'task_description'].includes(key)
            ))
        )
          throw new Error('Invalid child values');
        const role = record(values) ? values['subagent_type'] : undefined;
        const task = record(values) ? values['task_description'] : undefined;
        if (
          (record(values) &&
            Object.hasOwn(values, 'subagent_type') &&
            (!text(role) || !roles.includes(role))) ||
          (record(values) &&
            Object.hasOwn(values, 'task_description') &&
            !text(task)) ||
          (prior?.role !== undefined && prior.role !== role) ||
          (prior?.task !== undefined && prior.task !== task)
        )
          throw new Error('Changed child identity');
        const messages = child['messages'] as Message[];
        const ids = new Set<string>();
        for (const [index, message] of messages.entries()) {
          if (
            !record(message) ||
            !text(message.id) ||
            ids.has(message.id) ||
            context.rootIds.has(message.id) ||
            message.role !== 'assistant' ||
            typeof message.content !== 'string' ||
            message.toolCallId !== undefined ||
            (message.toolCallIds !== undefined &&
              (!Array.isArray(message.toolCallIds) ||
                message.toolCallIds.length)) ||
            !record(message.delivery) ||
            message.delivery.generation !== context.generation ||
            !['streaming', 'complete'].includes(message.delivery.phase) ||
            (message.delivery.phase === 'complete'
              ? message.delivery.outcome !== 'success'
              : 'outcome' in message.delivery &&
                message.delivery.outcome !== undefined)
          )
            throw new Error('Invalid child message');
          ids.add(message.id);
          const previous = prior?.messages[index];
          if (
            previous &&
            (previous.id !== message.id ||
              (previous.delivery.phase === 'complete' &&
                (message.delivery.phase !== 'complete' ||
                  messageKey(previous) !== messageKey(message))))
          )
            throw new Error('Changed child message');
        }
        if (prior && messages.length < prior.messages.length)
          throw new Error('Missing child message');
        if (
          context.terminal &&
          (!text(role) ||
            !text(task) ||
            !messages.length ||
            messages.some((message) => message.delivery.phase !== 'complete'))
        )
          throw new Error('Incomplete child observation');
        next.set(
          key,
          Object.freeze({
            namespace,
            role: role as string | undefined,
            task: task as string | undefined,
            messages,
          })
        );
      }
      for (const key of this.entries.keys())
        if (!next.has(key)) throw new Error('Missing child namespace');
      this.entries = next;
      this.generation = context.generation;
      return true;
    } catch {
      this.unsafe = true;
      return false;
    }
  }

  finish(status: Exclude<ChildStatus, 'Receiving'>): boolean {
    if (this.ended) return this.status === status && !this.unsafe;
    if (
      status === 'Observed response' &&
      (this.unsafe ||
        [...this.entries.values()].some(
          (entry) =>
            !entry.role ||
            !entry.task ||
            !entry.messages.length ||
            entry.messages.some(
              (message) =>
                message.delivery.phase !== 'complete' ||
                message.delivery.outcome !== 'success'
            )
        ))
    ) {
      this.unsafe = true;
      return false;
    }
    this.status = status;
    this.ended = true;
    return !this.unsafe;
  }

  rows(): readonly ChildRow[] {
    return Object.freeze(
      [...this.entries.values()].flatMap((entry) => {
        if (!entry.role || !entry.task) return [];
        const content = entry.messages
          .map((message) => message.content)
          .filter(text)
          .join('\n\n');
        return content.trim()
          ? [
              Object.freeze({
                key: JSON.stringify([this.view, this.turn, entry.namespace]),
                role: entry.role,
                text: content,
                status: this.status,
              }),
            ]
          : [];
      })
    );
  }
}
