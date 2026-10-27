import type { Message } from '@threadplane/core';
import {
  ConversationBudget,
  copyData,
  displayUnits,
  LIMITS,
  literal,
  record,
  sameData,
  text,
  validMessageMetadata,
} from './authority';

export type ChildStatus =
  | 'Receiving'
  | 'Observed response'
  | 'Stopped'
  | 'Incomplete';
export interface ChildRow {
  readonly key: string;
  readonly namespace: readonly string[];
  readonly text: string;
  readonly messages: readonly Message[];
  readonly status: ChildStatus;
}
export interface ChildContext {
  readonly owner: string;
  readonly turn: string;
  readonly generation: string;
}
interface Entry {
  readonly namespace: readonly string[];
  readonly messages: readonly Message[];
  readonly text: string;
  readonly interrupted: boolean;
}
interface TurnEntry {
  readonly turn: string;
  readonly generation: string;
  entries: Map<string, Entry>;
  status: ChildStatus;
  incomplete: boolean;
  ended: boolean;
}

/** App-owned observations survive native load. Namespace tuples are scoped by
 * local owner/turn/generation; no parent call identity is inferred. */
export class ChildObservations {
  private turns: TurnEntry[] = [];
  private current?: TurnEntry;
  constructor(
    private readonly owner: string,
    private readonly budget = new ConversationBudget()
  ) {}
  get incomplete(): boolean {
    return this.turns.some(
      (t) => t.incomplete || [...t.entries.values()].some((e) => e.interrupted)
    );
  }
  begin(turn: string, generation: string): boolean {
    if (
      !text(this.owner) ||
      !text(turn) ||
      !text(generation) ||
      [this.owner, turn, generation].some((s) => s.length > LIMITS.fieldText) ||
      this.turns.length >= LIMITS.namespaces ||
      this.turns.some((t) => t.turn === turn || t.generation === generation)
    )
      return false;
    if (this.current && !this.current.ended) this.finish('new');
    const next: TurnEntry = {
      turn,
      generation,
      entries: new Map(),
      status: 'Receiving',
      incomplete: false,
      ended: false,
    };
    this.turns.push(next);
    this.current = next;
    return true;
  }
  observe(input: unknown, context: ChildContext): boolean {
    const current = this.current;
    if (
      !current ||
      current.ended ||
      current.incomplete ||
      context.owner !== this.owner ||
      context.turn !== current.turn ||
      context.generation !== current.generation
    )
      return false;
    try {
      const children = copyData(input);
      if (!Array.isArray(children) || children.length > LIMITS.namespaces)
        throw new Error('Child observation limit');
      // Root loading happens only after finish; while active, disappearance is
      // uncertainty. An initial empty native snapshot is still a valid no-op.
      if (!children.length) {
        if (current.entries.size) throw new Error('Missing active children');
        return true;
      }
      const next = new Map(current.entries),
        batch = new Set<string>();
      for (const child of children) {
        if (
          !record(child) ||
          !Array.isArray(child.namespace) ||
          !child.namespace.length ||
          child.namespace.length > 16 ||
          child.namespace.some((s) => !text(s) || s.length > 1024) ||
          !Array.isArray(child.messages) ||
          !Array.isArray(child.interrupts) ||
          (child.values !== undefined && !record(child.values))
        )
          throw new Error('Unavailable child data');
        const namespace = child.namespace as string[],
          key = JSON.stringify(namespace);
        if (batch.has(key)) throw new Error('Duplicate namespace');
        batch.add(key);
        const prior = current.entries.get(key),
          messages = child.messages as Message[],
          ids = new Set<string>();
        for (const [index, m] of messages.entries()) {
          if (
            !record(m) ||
            !text(m.id) ||
            ids.has(m.id) ||
            !['user', 'assistant', 'tool', 'system'].includes(m.role) ||
            typeof m.content !== 'string' ||
            !validMessageMetadata(m) ||
            !record(m.delivery) ||
            m.delivery.generation !== current.generation ||
            !['streaming', 'complete'].includes(m.delivery.phase) ||
            (m.delivery.phase === 'complete' &&
              ![
                'success',
                'error',
                'aborted',
                'interrupted',
                'paused',
              ].includes(m.delivery.outcome)) ||
            (m.delivery.phase === 'streaming' &&
              Object.hasOwn(m.delivery, 'outcome') &&
              (m.delivery as Record<string, unknown>)['outcome'] !== undefined)
          )
            throw new Error('Unavailable child message');
          ids.add(m.id);
          displayUnits([
            m.id,
            m.content,
            m.name ?? '',
            m.reasoning ?? '',
            m.toolCallId ?? '',
            ...(m.toolCallIds ?? []),
          ]);
          const old = prior?.messages[index];
          if (old) {
            const grows = (
              a: readonly unknown[] | undefined,
              b: readonly unknown[] | undefined
            ) =>
              a === undefined ||
              (b !== undefined &&
                b.length >= a.length &&
                a.every((v, i) => sameData(v, b[i])));
            const stable = (a: unknown, b: unknown) =>
              a === undefined || sameData(a, b);
            if (
              old.delivery.phase === 'complete'
                ? !sameData(old, m)
                : old.id !== m.id ||
                  old.role !== m.role ||
                  !stable(old.name, m.name) ||
                  !stable(old.toolCallId, m.toolCallId) ||
                  !grows(old.toolCallIds, m.toolCallIds) ||
                  !grows(old.citations, m.citations) ||
                  (old.reasoning !== undefined &&
                    (m.reasoning === undefined ||
                      !m.reasoning.startsWith(old.reasoning))) ||
                  !m.content.startsWith(old.content)
            )
              throw new Error('Changed child observation');
          }
        }
        if (prior && messages.length < prior.messages.length)
          throw new Error('Shortened child observation');
        const transcript = messages
          .map(
            (m) =>
              `${m.role}${m.name ? ` (${m.name})` : ''}: ${m.content}${
                m.reasoning ? `\nReasoning: ${m.reasoning}` : ''
              }${m.citations ? `\nCitations: ${literal(m.citations)}` : ''}`
          )
          .join('\n\n');
        if (transcript.length > LIMITS.fieldText)
          throw new Error('Child transcript limit');
        next.set(
          key,
          Object.freeze({
            namespace,
            messages,
            text: transcript,
            interrupted:
              !!child.error ||
              child.interrupts.length > 0 ||
              messages.some(
                (m) =>
                  m.delivery.phase === 'complete' &&
                  m.delivery.outcome !== 'success'
              ),
          })
        );
      }
      for (const key of current.entries.keys())
        if (!batch.has(key)) throw new Error('Missing active namespace');
      let namespaces = 0,
        units = 0;
      for (const turn of this.turns)
        for (const entry of (turn === current ? next : turn.entries).values()) {
          namespaces++;
          const rowKey = JSON.stringify([
            this.owner,
            turn.turn,
            turn.generation,
            entry.namespace,
          ]);
          units += displayUnits([
            rowKey,
            ...entry.namespace,
            entry.text,
            ...entry.messages.flatMap((m) => [
              m.id,
              m.toolCallId ?? '',
              ...(m.toolCallIds ?? []),
            ]),
          ]);
          // All native message metadata kept in row is plain and capture-bounded;
          // display text is the transcript plus explicit namespace/key/status.
          units += Math.max('Observed response'.length, 'Incomplete'.length);
        }
      if (!this.budget.replace(`children:${this.owner}`, 0, namespaces, units))
        throw new Error('Conversation observation limit');
      current.entries = next;
      return true;
    } catch {
      current.incomplete = true;
      current.status = 'Incomplete';
      return false;
    }
  }
  finish(outcome: string): void {
    const current = this.current;
    if (!current || current.ended) return;
    current.ended = true;
    const unfinished = [...current.entries.values()].some(
      (e) =>
        !e.messages.length ||
        e.messages.some((m) => m.delivery.phase !== 'complete')
    );
    current.status =
      current.incomplete || (outcome === 'success' && unfinished)
        ? 'Incomplete'
        : outcome === 'success'
        ? 'Observed response'
        : outcome === 'aborted'
        ? 'Stopped'
        : 'Incomplete';
    if (current.status === 'Incomplete') current.incomplete = true;
  }
  rows(): readonly ChildRow[] {
    const rows: ChildRow[] = [];
    for (const turn of this.turns)
      for (const entry of turn.entries.values())
        rows.push(
          Object.freeze({
            key: JSON.stringify([
              this.owner,
              turn.turn,
              turn.generation,
              entry.namespace,
            ]),
            namespace: entry.namespace,
            text: entry.text,
            messages: entry.messages,
            status:
              turn.incomplete || entry.interrupted ? 'Incomplete' : turn.status,
          })
        );
    return Object.freeze(rows);
  }
}
