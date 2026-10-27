import { InterruptSchema, ResumeEntrySchema } from '@ag-ui/core/schemas';
import type { Interrupt, ResumeEntry } from '@ag-ui/core';
import type { AgentSubmitInput } from '@threadplane/chat';
import type { InterruptSessionSnapshot, InterruptTransport, ResumeAttempt } from './interrupt-session.types';

/** Owns a correlated interrupt batch independently of transport/UI lifecycles. */
export class InterruptSession {
  private state: InterruptSessionSnapshot = { phase: 'none', generation: 0, interrupts: [] };

  constructor(private readonly profile: InterruptTransport = 'auto') {}

  get snapshot(): InterruptSessionSnapshot { return structuredClone(this.state); }

  observeNative(entries: unknown[], runId?: string): void {
    if (entries.length === 0) throw new Error('Native interrupt outcome must contain interrupts');
    if (this.isLateObservation(runId)) return;
    const parsed = entries.map(entry => {
      const normalized = isRecord(entry) && entry['reason'] === undefined ? { ...entry, reason: '' } : entry;
      // Keep the SDK's declared output type across consumer strictness settings.
      // Preserve extensions separately instead of re-inferring a passthrough schema.
      const validated = InterruptSchema.parse(normalized);
      return { ...(isRecord(normalized) ? normalized : {}), ...validated };
    });
    if (new Set(parsed.map(entry => entry.id)).size !== parsed.length) throw new Error('Duplicate interrupt id');
    this.beginObservation(runId);
    const merged = new Map(this.state.interrupts.map(entry => [entry.id, entry]));
    for (const entry of parsed) merged.set(entry.id, structuredClone(entry));
    this.state.interrupts = [...merged.values()];
  }

  observeLegacy(value: unknown, runId?: string): void {
    if (this.isLateObservation(runId)) return;
    this.beginObservation(runId);
    this.state.legacy = {
      id: this.state.legacy?.id ?? `interrupt-${this.state.generation}`,
      value: structuredClone(value),
      resumable: true,
    };
  }

  ready(): void { if (this.state.phase === 'collecting') this.state.phase = 'pending'; }

  claim(input: AgentSubmitInput, attemptId: string, runId: string): ResumeAttempt {
    if (this.state.phase !== 'pending') throw new Error('No pending interrupt available to resume');
    if (this.state.attempt) throw new Error('Use retry to resend the retained interrupt decision');
    if (input.resume === undefined) throw new Error('A resume response is required');
    this.validateExpiry();
    const copy = structuredClone(input);
    const parameters = this.parameters(copy.resume);
    const attempt = freezeDeep({ id: attemptId, runId, input: copy, parameters, generation: this.state.generation });
    this.state.attempt = attempt;
    this.state.phase = 'claimed';
    return attempt;
  }

  dispatched(id: string): void {
    if (this.matches(id) && this.state.phase === 'claimed') this.state.phase = 'resuming';
  }

  acknowledge(id: string): void {
    if (this.matches(id) && (this.state.phase === 'claimed' || this.state.phase === 'resuming')) this.state.phase = 'acknowledged';
  }

  fail(id: string, knownNotDispatched: boolean): void {
    if (!this.matches(id)) return;
    if (this.state.phase === 'acknowledged' || this.state.phase === 'recovery-required') {
      this.state.phase = 'recovery-required';
    } else if (knownNotDispatched && (this.state.phase === 'claimed' || this.state.phase === 'resuming')) {
      this.state.phase = 'pending';
    } else if (this.state.phase !== 'pending') {
      this.state.phase = 'uncertain';
    }
  }

  complete(id: string): void {
    if (this.matches(id)) this.state = { phase: 'none', generation: this.state.generation, interrupts: [] };
  }

  restore(snapshot: InterruptSessionSnapshot): void {
    this.state = structuredClone(snapshot);
    if (this.state.attempt) freezeDeep(this.state.attempt);
  }

  retry(): ResumeAttempt {
    if (this.state.phase === 'uncertain' || this.state.phase === 'recovery-required') throw new Error('Interrupt recovery requires reconciliation before retry');
    if (this.state.phase !== 'pending' || !this.state.attempt) throw new Error('Resume cannot be retried safely');
    this.validateExpiry();
    this.state.phase = 'claimed';
    return this.state.attempt;
  }

  private isLateObservation(runId?: string): boolean {
    return this.state.attempt !== undefined && (runId === undefined || runId === this.state.runId);
  }

  private beginObservation(runId?: string): void {
    const isResumeRun = runId !== undefined && this.state.attempt?.runId === runId;
    if (this.state.phase === 'none' || isResumeRun || (runId !== undefined && this.state.runId !== undefined && runId !== this.state.runId)) {
      this.state = { phase: 'collecting', generation: this.state.generation + 1, interrupts: [], runId };
    } else if (this.state.runId === undefined) {
      this.state.runId = runId;
    }
  }

  private matches(id: string): boolean {
    return this.state.attempt?.id === id && this.state.attempt.generation === this.state.generation;
  }

  private validateExpiry(): void {
    for (const entry of this.state.interrupts) {
      if (entry.expiresAt !== undefined && (!Number.isFinite(Date.parse(entry.expiresAt)) || Date.parse(entry.expiresAt) <= Date.now())) {
        throw new Error(`Interrupt ${entry.id} has expired or has an invalid expiry`);
      }
    }
  }

  private parameters(resume: unknown): ResumeAttempt['parameters'] {
    const value = this.state.legacy?.value;
    const native = this.profile === 'protocol' || (this.profile === 'auto' && this.state.interrupts.length > 0);
    if (native) return { resume: nativeResponses(resume, this.state.interrupts) };
    const mastra = this.profile === 'mastra-command' || (this.profile === 'auto' && isRecord(value) && typeof value['toolCallId'] === 'string');
    if (mastra) {
      if (!isRecord(value) || typeof value['toolCallId'] !== 'string') throw new Error('Mastra interrupt requires a toolCallId');
      const runId = typeof value['runId'] === 'string' ? value['runId'] : this.state.runId;
      return { forwardedProps: { command: { resume, interruptEvent: { toolCallId: value['toolCallId'], ...(runId ? { runId } : {}) } } } };
    }
    return { forwardedProps: { command: { resume } } };
  }
}

function nativeResponses(resume: unknown, interrupts: Interrupt[]): ResumeEntry[] {
  if (interrupts.length === 0) throw new Error('No native interrupt available');
  const structured = Array.isArray(resume) && (resume.length === 0 || resume.some(entry => isRecord(entry) && ('id' in entry || 'interruptId' in entry)));
  let entries: ResumeEntry[];
  if (structured) {
    entries = (resume as unknown[]).map(entry => {
      if (!isRecord(entry)) throw new Error('Invalid resume entry');
      if (entry['id'] !== undefined && entry['interruptId'] !== undefined && entry['id'] !== entry['interruptId']) throw new Error('Conflicting interrupt ids');
      // Pick the known ResumeEntry keys explicitly: the 1.0 validators are loose and would pass the legacy `id` through.
      const parsed = ResumeEntrySchema.parse({
        interruptId: entry['interruptId'] ?? entry['id'],
        status: entry['status'] === undefined ? 'resolved' : entry['status'],
        // 1.0 treats a whole-optional null as absent and the client's outgoing sanitizer drops it, so omit it here too.
        ...(entry['payload'] != null ? { payload: entry['payload'] } : {}),
        ...(entry['metadata'] !== undefined ? { metadata: entry['metadata'] } : {}),
      });
      if (parsed.status === 'cancelled' && parsed.payload != null) throw new Error('Cancelled responses cannot carry payload');
      return parsed;
    });
  } else {
    if (interrupts.length !== 1) throw new Error('A response is required for every interrupt');
    entries = [{ interruptId: interrupts[0].id, status: 'resolved', ...(resume != null ? { payload: resume } : {}) }];
  }
  const ids = new Set(entries.map(entry => entry.interruptId));
  if (entries.length !== interrupts.length || ids.size !== entries.length || interrupts.some(entry => !ids.has(entry.id))) throw new Error('Resume must cover each interrupt exactly once');
  return entries;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) freezeDeep(item);
  }
  return value;
}
