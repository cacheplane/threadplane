import type { Session } from '@threadplane/ag-ui';

export type NativeSnapshot = ReturnType<Session['getSnapshot']>;
export type SpecialistRole = 'research' | 'booking' | 'itinerary';
export interface ChildCard {
  readonly id: string;
  readonly runId: string;
  readonly ownerId: string;
  readonly callId: string;
  readonly role: SpecialistRole;
  readonly phase: 'running' | 'complete' | 'error';
  readonly messages: readonly Readonly<{ id: string; text: string }>[];
  readonly answer: string | null;
}
const roles: readonly string[] = ['research', 'booking', 'itinerary'];
const text = (value: unknown, maximum = 4096): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= maximum;
export function taskArguments(
  value: string
): Readonly<{ role: SpecialistRole; task_description: string }> | undefined {
  try {
    if (!text(value, 8192)) return;
    const args: unknown = JSON.parse(value);
    if (!args || typeof args !== 'object' || Array.isArray(args)) return;
    const record = args as Record<string, unknown>;
    if (
      Object.keys(record).length !== 2 ||
      !Object.hasOwn(record, 'role') ||
      !Object.hasOwn(record, 'task_description') ||
      typeof record.role !== 'string' ||
      !roles.includes(record.role) ||
      !text(record.task_description)
    )
      return;
    return Object.freeze({
      role: record.role as SpecialistRole,
      task_description: record.task_description,
    });
  } catch {
    return undefined;
  }
}

/** Display observations only. Captured child text never enters request history. */
export function observeChildren(
  snapshot: NativeSnapshot,
  previous: readonly ChildCard[],
  previousCalls: ReadonlySet<string>
): Readonly<{ cards: readonly ChildCard[]; unsupported: boolean }> {
  const cards = new Map(previous.map((card) => [card.id, card]));
  let unsupported = false;
  try {
    if (
      cards.size !== previous.length ||
      previous.length > 100 ||
      snapshot.subagents.length > 30
    )
      throw new Error();
    const attributed = new Set(
      snapshot.subagents.map((child) => child.started.subagentRunId)
    );
    if (
      snapshot.transcript.some(
        (message) =>
          typeof message.subagentRunId === 'string' &&
          !attributed.has(message.subagentRunId)
      )
    )
      throw new Error();
    const seen = new Set<string>();
    for (const child of snapshot.subagents) {
      const started = child.started;
      const id = started.subagentRunId,
        callId = started.parentToolCallId;
      const old = cards.get(id);
      const runId = snapshot.run?.id;
      if (
        !text(id) ||
        !text(callId) ||
        id !== callId + '-sub' ||
        seen.has(id) ||
        !text(runId) ||
        started.parentSubagentRunId !== undefined ||
        (previousCalls.has(callId) && !old)
      )
        throw new Error();
      seen.add(id);
      const owners = snapshot.transcript.filter(
        (message) =>
          message.role === 'assistant' &&
          !message.subagentRunId &&
          message.toolCalls?.some((call) => call.id === callId)
      );
      if (owners.length !== 1) throw new Error();
      const owner = owners[0];
      if (owner.role !== 'assistant') throw new Error();
      const calls = owner.toolCalls?.filter((call) => call.id === callId) ?? [];
      if (calls.length !== 1 || calls[0].function.name !== 'task')
        throw new Error();
      const args = taskArguments(calls[0].function.arguments);
      if (
        !roles.includes(started.name) ||
        (args && args.role !== started.name) ||
        (!args && snapshot.status !== 'running') ||
        (started.parentMessageId !== undefined &&
          started.parentMessageId !== owner.id)
      )
        throw new Error();
      // The bridge can defer full task arguments until a canonical snapshot.
      // A named child is display evidence only; root policy later needs args.
      const role = started.name as SpecialistRole;
      if (
        old &&
        (old.ownerId !== owner.id ||
          old.callId !== callId ||
          old.runId !== runId ||
          old.role !== role)
      )
        throw new Error();
      let phase: ChildCard['phase'] = 'running';
      const terminal = child.terminal;
      if (terminal) {
        if (terminal.subagentRunId !== id) throw new Error();
        // Error payloads are retained by the protocol owner, never copied here.
        phase =
          terminal.type === 'SUBAGENT_FINISHED' &&
          terminal.outcome?.type === 'success'
            ? 'complete'
            : 'error';
      }
      if (phase === 'error') unsupported = true;
      if (old && old.phase !== 'running' && old.phase !== phase)
        throw new Error();
      const observed = snapshot.transcript.filter(
        (message) => message.subagentRunId === id
      );
      if (observed.length > 8) throw new Error();
      const messages = observed.length
        ? observed.map((message) => {
            if (
              message.role !== 'assistant' ||
              message.toolCalls?.length ||
              (message.content !== undefined &&
                typeof message.content !== 'string') ||
              (message.content?.length ?? 0) > 65_536 ||
              !text(message.id) ||
              !message.id.startsWith(id + '-m')
            )
              throw new Error();
            return Object.freeze({
              id: message.id,
              text: message.content ?? '',
            });
          })
        : old?.messages ?? Object.freeze([]);
      if (
        new Set(messages.map((message) => message.id)).size !== messages.length
      )
        throw new Error();
      let answer: string | null = null;
      if (phase === 'complete') {
        const results = snapshot.transcript.filter(
          (message) => message.role === 'tool' && message.toolCallId === callId
        );
        if (results.length > 1) throw new Error();
        const result = results[0];
        if (result) {
          if (result.id !== callId || !text(result.content, 65_536))
            throw new Error();
          answer = result.content;
          const observedText = messages
            .map((message) => message.text)
            .join('\n');
          if (observedText && observedText !== answer) throw new Error();
        }
      }
      if (!old && cards.size >= 100) throw new Error();
      cards.set(
        id,
        Object.freeze({
          id,
          runId,
          ownerId: owner.id,
          callId,
          role,
          phase,
          messages: Object.freeze([...messages]),
          answer,
        })
      );
    }
  } catch {
    unsupported = true;
  }
  return Object.freeze({
    cards: Object.freeze([...cards.values()]),
    unsupported,
  });
}
