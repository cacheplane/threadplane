import type { Interrupt, ResumeEntry } from '@ag-ui/core';
import type { AgentInterrupt, AgentSubmitInput } from '@threadplane/chat';

/** Resume encoding profile; auto prefers native protocol interrupts, then selects Mastra or legacy command encoding. */
export type InterruptTransport = 'auto' | 'protocol' | 'legacy-command' | 'mastra-command';
/** Interrupt batch lifecycle, including resume ownership, dispatch, acknowledgment, and recovery states. */
export type InterruptSessionPhase = 'none' | 'collecting' | 'pending' | 'claimed' | 'resuming' | 'acknowledged' | 'uncertain' | 'recovery-required';

/** Retained resume decision and encoded request parameters correlated to an attempt ID, run ID, and interrupt generation. */
export interface ResumeAttempt {
  id: string;
  runId: string;
  input: AgentSubmitInput;
  parameters: { resume?: ResumeEntry[]; forwardedProps?: Record<string, unknown> };
  generation: number;
}

/** Interrupt batch state containing its phase, generation, native or legacy interrupts, and any retained resume attempt. */
export interface InterruptSessionSnapshot {
  phase: InterruptSessionPhase;
  generation: number;
  interrupts: Interrupt[];
  legacy?: AgentInterrupt;
  runId?: string;
  attempt?: ResumeAttempt;
}
