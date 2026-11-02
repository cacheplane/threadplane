import { computed, signal, WritableSignal } from '@angular/core';
import type {
  LangGraphAgent,
  SubagentStreamRef,
  AgentQueue,
  Interrupt,
  ThreadState,
  CustomStreamEvent,
  AgentBranchTree,
} from '../agent.types';
import type { ToolProgress, ToolCallWithResult } from '@langchain/langgraph-sdk';
import type { BaseMessage, AIMessage as CoreAIMessage } from '@langchain/core/messages';
import type { MessageMetadata } from '@langchain/langgraph-sdk/ui';
import { mockAgent } from '@threadplane/chat';
import type {
  MockAgent,
  MockAgentOptions,
  AgentError,
  AgentErrorKind,
  AgentInterrupt,
  AgentCheckpoint,
  AgentStatus,
  Message,
  Subagent,
  ToolCall,
} from '@threadplane/chat';

/**
 * A LangGraphAgent mock with writable signals for easy test control.
 *
 * Builds on the runtime-neutral {@link @threadplane/chat#MockAgent | MockAgent} from `@threadplane/chat`
 * (which supplies the neutral `Agent`-contract writable signals plus
 * `submit`/`stop`/`regenerate` call tracking) and layers the LangGraph-specific
 * writable signals on top.
 *
 * Cast the result of `mockLangGraphAgent()` to this type to access
 * writable signals without unsafe casts in test files.
 */
export interface MockLangGraphAgent extends LangGraphAgent<any, any> {
  // Neutral writable signals — re-declared writable. (Dual-extends of MockAgent
  // and LangGraphAgent is impossible because they declare incompatible
  // `lifecycle` shapes, so we extend LangGraphAgent and layer the MockAgent
  // call-tracking surface explicitly below.)
  messages: WritableSignal<Message[]>;
  status: WritableSignal<AgentStatus>;
  isLoading: WritableSignal<boolean>;
  error: WritableSignal<AgentError | undefined>;
  toolCalls: WritableSignal<ToolCall[]>;
  interrupt: WritableSignal<AgentInterrupt | undefined>;
  subagents: WritableSignal<Map<string, Subagent>>;
  history: WritableSignal<AgentCheckpoint[]>;

  // MockAgent call-tracking surface (delegated to mockAgent at runtime).
  submitCalls: MockAgent['submitCalls'];
  stopCount: MockAgent['stopCount'];
  _internal: MockAgent['_internal'];

  // LangGraph-specific writable signals.
  langGraphMessages: WritableSignal<BaseMessage[]>;
  hasValue: WritableSignal<boolean>;
  value: WritableSignal<any>;
  langGraphInterrupts: WritableSignal<Interrupt<any>[]>;
  langGraphToolCalls: WritableSignal<ToolCallWithResult[]>;
  toolProgress: WritableSignal<ToolProgress[]>;
  queue: WritableSignal<AgentQueue>;
  branch: WritableSignal<string>;
  langGraphHistory: WritableSignal<ThreadState<any>[]>;
  experimentalBranchTree: WritableSignal<AgentBranchTree<any>>;
  isThreadLoading: WritableSignal<boolean>;
  activeSubagents: WritableSignal<SubagentStreamRef[]>;
  customEvents: WritableSignal<CustomStreamEvent[]>;
}

/**
 * Creates a mock LangGraphAgent with writable signals for testing.
 * Control state by writing to the returned writable signals directly.
 *
 * Neutral `Agent`-contract signals come from {@link @threadplane/chat#mockAgent | mockAgent}; LangGraph-specific
 * signals are declared here and layered on top.
 *
 * @example
 * ```ts
 * const agent = mockLangGraphAgent({ isThreadLoading: true });
 * agent.messages.set([{ id: '1', role: 'assistant', content: 'Hi' }]);
 * ```
 */
export function mockLangGraphAgent(
  initial: MockAgentOptions & {
    langGraphMessages?: BaseMessage[];
    hasValue?: boolean;
    isThreadLoading?: boolean;
  } = {}
): MockLangGraphAgent {
  const base = mockAgent({
    ...initial,
    withInterrupt: true,
    withSubagents: true,
    history: initial.history ?? [],
  });

  // ── LangGraph-specific writable signals (defaults copied verbatim) ────────
  const langGraphMessages$ = signal<BaseMessage[]>(initial.langGraphMessages ?? []);
  const hasValue$ = signal<boolean>(initial.hasValue ?? false);
  const value$ = signal<any>(null);
  const langGraphInterrupts$ = signal<Interrupt<any>[]>([]);
  const langGraphToolCalls$ = signal<ToolCallWithResult[]>([]);
  const toolProgress$ = signal<ToolProgress[]>([]);
  const queue$ = signal<AgentQueue>({
    entries: [],
    size: 0,
    cancel: async () => false,
    clear: async () => undefined,
  });
  const branch$ = signal<string>('');
  const langGraphHistory$ = signal<ThreadState<any>[]>([]);
  const experimentalBranchTree$ = signal<AgentBranchTree<any>>({ type: 'sequence', items: [] });
  const isThreadLoading$ = signal<boolean>(initial.isThreadLoading ?? false);
  const activeSubagents$ = signal<SubagentStreamRef[]>([]);
  const customEvents$ = signal<CustomStreamEvent[]>([]);

  // `state` derives from the raw LangGraph value (preserves current behavior).
  const state$ = computed<Record<string, unknown>>(() => {
    const v = value$();
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  });

  const mock: MockLangGraphAgent = {
    ...base,

    // ── Neutral surface: override `state` to derive from the LangGraph value ─
    state: state$ as never,

    // ── Raw LangGraph signals ─────────────────────────────────────────────
    langGraphMessages: langGraphMessages$,
    langGraphInterrupts: langGraphInterrupts$,
    langGraphToolCalls: langGraphToolCalls$,
    langGraphHistory: langGraphHistory$,
    experimentalBranchTree: experimentalBranchTree$,

    // ── Other AgentRef fields preserved ──────────────────────────────────
    value: value$,
    hasValue: hasValue$,
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    reload: () => {},
    toolProgress: toolProgress$,
    queue: queue$,
    activeSubagents: activeSubagents$,
    getSubagent: (toolCallId: string) =>
      activeSubagents$().find(subagent => subagent.toolCallId === toolCallId),
    getSubagentsByType: (type: string) =>
      activeSubagents$().filter(subagent => subagent.name === type),
    getSubagentsByMessage: (msg: CoreAIMessage) => {
      const toolCalls = (msg as unknown as Record<string, unknown>)['tool_calls'];
      if (!Array.isArray(toolCalls)) return [];
      const ids = toolCalls
        .map(toolCall => {
          if (toolCall == null || typeof toolCall !== 'object' || Array.isArray(toolCall)) return undefined;
          const id = (toolCall as Record<string, unknown>)['id'];
          return typeof id === 'string' ? id : undefined;
        })
        .filter((id): id is string => id != null);
      return activeSubagents$().filter(subagent => ids.includes(subagent.toolCallId));
    },
    customEvents: customEvents$,
    branch: branch$,
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    setBranch: (_branch: string) => {},
    isThreadLoading: isThreadLoading$,
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    switchThread: (_threadId: string | null) => {},
    joinStream: (_runId: string, _lastEventId?: string) => Promise.resolve(),
    getMessagesMetadata: (_msg: BaseMessage, _idx?: number): MessageMetadata<Record<string, unknown>> | undefined => undefined,
    getToolCalls: (_msg: CoreAIMessage): ToolCallWithResult[] => [],
    lifecycle: {
      streamStartedAt:     signal<number | null>(null),
      streamErrorAt:       signal<{ at: number; kind: AgentErrorKind | string } | null>(null),
      interruptReceivedAt: signal<number | null>(null),
      interruptResolvedAt: signal<number | null>(null),
      threadCreatedAt:     signal<number | null>(null),
      threadPersistedAt:   signal<number | null>(null),
      toolCallStartedAt:   signal<number | null>(null),
      toolCallCompletedAt: signal<number | null>(null),
    },
  } as MockLangGraphAgent;

  return mock;
}
