/**
 * Component-scoped CSS variables for the chat-debug devtools chrome.
 *
 * Imported into every chat-debug component / primitive's `styles` array
 * so the defaults are set on each `:host` element. Hosts override by
 * setting any token on `chat-debug` or any ancestor.
 *
 * Independent from `--tplane-chat-*` (the chat library's theme tokens).
 * Devtools chrome stays dark regardless of host theme by default —
 * matches Chrome DevTools / React DevTools / Redux DevTools convention.
 *
 * Palette anchor: shadcn zinc-900 + accent blue.
 */
export const CHAT_DEBUG_TOKENS = `
  :host {
    --tplane-chat-debug-bg: #18181b;
    --tplane-chat-debug-bg-deep: #09090b;
    --tplane-chat-debug-surface: #1f1f23;
    --tplane-chat-debug-border: #27272a;
    --tplane-chat-debug-border-strong: #3f3f46;
    --tplane-chat-debug-text: #fafafa;
    --tplane-chat-debug-text-muted: #a1a1aa;
    --tplane-chat-debug-text-subtle: #71717a;
    --tplane-chat-debug-accent: #4f8df5;
    --tplane-chat-debug-success: #4ade80;
    --tplane-chat-debug-shadow-panel: var(--tplane-chat-elevation-float, 0 8px 32px rgba(0, 0, 0, 0.5));
    --tplane-chat-debug-shadow-pill: var(--tplane-chat-elevation-float, 0 6px 18px rgba(0, 0, 0, 0.4));
    --tplane-chat-debug-radius-panel: 12px;
    --tplane-chat-debug-radius-input: 8px;
    --tplane-chat-debug-radius-pill: 999px;
    --tplane-chat-debug-font-mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    --tplane-chat-debug-font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-family: var(--tplane-chat-debug-font-sans);
    color: var(--tplane-chat-debug-text);

    /*
     * Cascade shim: rewire the chat library's color tokens to debug
     * equivalents so embedded components that consume \`--tplane-chat-*\`
     * (debug-checkpoint-card, debug-state-diff, debug-state-inspector,
     * any host-projected slot content) pick up the dark devtools surface
     * without each one needing its own re-skin. Geometry / font tokens
     * are left alone — they're neutral.
     */
    --tplane-chat-bg: var(--tplane-chat-debug-bg);
    --tplane-chat-text: var(--tplane-chat-debug-text);
    --tplane-chat-text-muted: var(--tplane-chat-debug-text-muted);
    --tplane-chat-separator: var(--tplane-chat-debug-border);
    --tplane-chat-surface-alt: var(--tplane-chat-debug-bg-deep);
    --tplane-chat-font-size-xs: 12px;
    --tplane-chat-font-mono: var(--tplane-chat-debug-font-mono);
    --tplane-chat-radius-card: 8px;
    --tplane-chat-success: var(--tplane-chat-debug-success);
    --tplane-chat-error-bg: color-mix(in srgb, #ef4444 18%, transparent);
    --tplane-chat-error-text: #fca5a5;
    --tplane-chat-warning-bg: color-mix(in srgb, #f59e0b 18%, transparent);
    --tplane-chat-warning-text: #fcd34d;
  }
`;
