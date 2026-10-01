/**
 * Token accounting for one run, as the runtime reported it. Every count is
 * optional: absent means the provider did not report it, which is distinct
 * from zero. Reasoning, cached, and cache-write counts are parts of the
 * input/output totals, never additions to them.
 */
export interface AgentUsageEntry {
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
}

/** Usage for the most recent finished or errored run, one entry per provider and model. */
export interface AgentUsage {
  entries: AgentUsageEntry[];
}
