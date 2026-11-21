// libs/angular/chat/src/lib/primitives/chat-tool-views/chat-tool-views.component.ts
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { Spec, StateStore } from '@json-render/core';
import type { RenderEvent, ViewRegistry } from '@threadplane/angular/render';
import { toRenderRegistry } from '@threadplane/angular/render';
import { toolCallError, toolCallResult, type Agent, type Message, type ToolCall } from '../../agent';
import type { ClientToolLifecycle } from '../../client-tools/tool-def';
import { resolveMessageToolCalls } from '../chat-tool-calls/resolve-message-tool-calls';
import { ChatGenerativeUiComponent } from '../chat-generative-ui/chat-generative-ui.component';

/**
 * Renders a frontend component for a tool call by reusing the chat
 * composition's `views` registry. A tool call whose `name` matches a
 * registry key is bridged into a synthetic one-element render spec
 * (`{ root: name, elements: { [name]: { type: name, props } } }`) and
 * rendered through the existing render-spec pipeline.
 *
 * Props merge the live `args` (present while the call streams) with the
 * `result` (on completion; a JSON-object string result is parsed first,
 * since that is how a LangGraph ToolMessage carries a dict return) and
 * always include `status`, so a view
 * component can show its own loading/empty/error states. `RenderElement`
 * filters props down to the component's declared inputs, so extra keys
 * (and a `status` a component chooses not to declare) are harmless.
 */
@Component({
  selector: 'chat-tool-views',
  standalone: true,
  imports: [ChatGenerativeUiComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (view of toolViews(); track view.id) {
      <chat-generative-ui
        [spec]="view.spec"
        [registry]="registry()"
        [store]="store()"
        [handlers]="handlers()"
        [loading]="view.loading"
        (events)="events.emit($event)"
      />
    }
  `,
})
export class ChatToolViewsComponent {
  readonly agent = input.required<Agent>();
  readonly events = output<RenderEvent>();
  readonly message = input<Message | undefined>(undefined);
  readonly views = input<ViewRegistry | undefined>(undefined);
  readonly store = input<StateStore | undefined>(undefined);
  readonly handlers = input<Record<string, (params: Record<string, unknown>) => unknown | Promise<unknown>>>({});

  readonly registry = computed(() => {
    const v = this.views();
    return v ? toRenderRegistry(v) : undefined;
  });

  readonly toolViews = computed(() => {
    const v = this.views();
    if (!v) return [];
    const names = new Set(Object.keys(v));
    return resolveMessageToolCalls(this.agent(), this.message())
      .filter((tc) => names.has(tc.name))
      .map((tc) => ({ id: tc.id, loading: tc.status === 'running', spec: toToolViewSpec(tc) }));
  });
}

/** Wraps a tool call into a synthetic single-element render spec. */
function toToolViewSpec(tc: ToolCall): Spec {
  const args = isRecord(tc.args) ? tc.args : {};
  const result = resultRecord(toolCallResult(tc));
  return {
    root: tc.name,
    elements: {
      [tc.name]: {
        type: tc.name,
        props: { ...args, ...result, status: tc.status, clientTool: toClientToolLifecycle(tc) },
      },
    },
  };
}

function toClientToolLifecycle(tc: ToolCall): ClientToolLifecycle {
  const result = toolCallResult(tc);
  const error = toolCallError(tc);
  // A failed call is answered too: the core contract carries its outcome as
  // the error text instead of a result.
  const hasResult = result !== undefined || error !== undefined;
  return {
    id: tc.id,
    name: tc.name,
    status: tc.status,
    phase: tc.status === 'error' ? 'error' : tc.status === 'complete' ? 'complete' : 'running',
    hasResult,
    ...(result !== undefined ? { result } : {}),
    ...(error !== undefined ? { error } : {}),
  };
}

/**
 * The result as a props record. A LangGraph ToolMessage carries a tool's
 * dict return as a JSON STRING (ToolNode serialises it), so a string that
 * parses to a plain object is spread the same way an object result is.
 * Anything else — prose, arrays, malformed JSON — contributes no props.
 */
function resultRecord(result: unknown): Record<string, unknown> {
  if (isRecord(result)) return result;
  if (typeof result !== 'string') return {};
  const text = result.trim();
  if (!text.startsWith('{')) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
