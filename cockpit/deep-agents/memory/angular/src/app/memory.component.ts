import { Component, computed, inject } from '@angular/core';
import {
  ChatComponent,
  ChatWelcomeSuggestionComponent,
} from '@threadplane/chat';
import { ExampleChatLayoutComponent } from '@threadplane/example-layouts';
import { injectAgent } from '@threadplane/langgraph';
import { MemoryScope } from './memory-scope';
import { guardMemoryAgent } from './memory-agent-gate';

/** Name of the custom stream event the graph's visibility middleware emits. */
const MEMORY_EVENT = 'deep_agents.memory';

interface MemoryFile {
  path: string;
  contents: string;
  lines: string[];
}

const SUGGESTIONS = [
  // values match cockpit/deep-agents/memory/angular/e2e/da-memory.spec.ts prompts.
  {
    label: 'Tell it about your operation',
    value:
      'I fly a Citation CJ3 out of KASE, and I always want briefings in bullet points. Please remember that.',
    description: 'The agent edits its own memory file.',
  },
  {
    label: 'Start over and ask what it knows',
    value: 'What do you already know about my operation?',
    description: 'Reload first: new threads use the saved browser identity.',
  },
] as const;

/** The graph reads a browser-scoped StoreBackend and publishes scoped custom
 * observations before model work and at terminal read time. PrivateStateAttr
 * hides schema fields; compiled values can still include them, while the installed
 * API may omit them via output_channels. State/checkpoint observations are historical
 * read-time evidence, not a guarantee that the store remains current or durable. */
@Component({
  selector: 'app-da-memory',
  standalone: true,
  imports: [
    ChatComponent,
    ChatWelcomeSuggestionComponent,
    ExampleChatLayoutComponent,
  ],
  template: `
    <example-chat-layout sidebarWidth="22rem">
      <chat main [agent]="agent" class="flex-1 min-w-0">
        <div chatWelcomeSuggestions>
          @for (s of suggestions; track s.value) {
            <chat-welcome-suggestion
              [label]="s.label"
              [value]="s.value"
              [description]="s.description"
              (selected)="send($event)"
            />
          }
        </div>
      </chat>
      <!-- #region memory-panel -->
      <div sidebar class="panel">
        <h3 class="cap">Agent Memory</h3>
        <p class="source" data-testid="memory-source" [attr.data-source]="memorySource()">
          {{
            memorySource() === 'live'
              ? 'store observed during this run'
              : memorySource() === 'checkpoint'
                ? 'historical state/checkpoint read'
                : memorySource() === 'unavailable'
                  ? 'memory observation unavailable'
                  : 'no source yet'
          }}
        </p>
        @if (scopeWarning()) {
          <p role="alert" data-testid="memory-scope-warning">{{ scopeWarning() }}</p>
        }
        @if (memoryFiles().length === 0 && (memorySource() === 'live' || memorySource() === 'checkpoint')) {
          <p class="empty">No memory file at this observation's read time</p>
        }
        @for (file of memoryFiles(); track file.path) {
          <div class="mem" data-testid="memory-file" [attr.data-path]="file.path">
            <span class="mem__path">{{ file.path }}</span>
            @for (line of file.lines; track $index) {
              <p class="mem__line" data-testid="memory-line">{{ line }}</p>
            }
          </div>
        }
        <p class="hint">
          This panel shows the scoped store at an observed read time. A new conversation uses
          the same browser identity while its storage is available. Observations do not promise durability.
        </p>
      </div>
      <!-- #endregion -->
    </example-chat-layout>
  `,
  styles: [
    `
      .panel {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        padding: 1rem;
        background: var(--tplane-chat-bg);
        color: var(--tplane-chat-text);
      }

      .cap {
        margin: 0;
        color: var(--tplane-chat-text-muted);
        font-size: var(--tplane-chat-font-size-xs);
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      .source {
        margin: 0;
        color: var(--tplane-chat-text-muted);
        font-family: var(--tplane-chat-font-mono);
        font-size: var(--tplane-chat-font-size-xs);
      }

      .empty {
        margin: 0;
        color: var(--tplane-chat-text-muted);
        font-size: var(--tplane-chat-font-size-sm);
        font-style: italic;
      }

      .mem {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        padding: 0.5rem;
        border-radius: var(--tplane-chat-radius-card);
        background: var(--tplane-chat-surface-alt);
      }

      .mem__path {
        color: var(--tplane-chat-text-muted);
        font-family: var(--tplane-chat-font-mono);
        font-size: var(--tplane-chat-font-size-xs);
      }

      .mem__line {
        margin: 0;
        color: var(--tplane-chat-text);
        font-size: var(--tplane-chat-font-size-sm);
      }

      .hint {
        margin: 0;
        color: var(--tplane-chat-text-muted);
        font-size: var(--tplane-chat-font-size-xs);
        line-height: var(--tplane-chat-line-height);
      }
    `,
  ],
})
export class MemoryComponent {
  private readonly scope = inject(MemoryScope);
  protected readonly agent = guardMemoryAgent(injectAgent(), this.scope);
  protected readonly scopeWarning = computed(() => {
    const snapshot = this.scope.snapshot();
    return snapshot.status === 'blocked' ? snapshot.warning : null;
  });
  protected readonly suggestions = SUGGESTIONS;

  // #region memory-sources
  // The adapter clears custom events at run/thread boundaries. While loading,
  // absence of a new custom event must not promote old checkpoint/state data.
  private readonly observation = computed<{
    source: 'live' | 'checkpoint' | 'none' | 'unavailable';
    contents?: Record<string, string>;
  }>(() => {
    if (this.agent.error()) return { source: 'unavailable' };
    const owner = this.scope.scope;
    if (!owner) return { source: 'unavailable' };
    for (const event of [...this.agent.customEvents()].reverse()) {
      if (event.name !== MEMORY_EVENT) continue;
      const data = plainRecord(event.data);
      if (
        !data ||
        Object.keys(data).length !== 3 ||
        !['memory_contents', 'memory_scope_owner', 'phase'].every((k) =>
          Object.hasOwn(data, k)
        ) ||
        data.memory_scope_owner !== owner ||
        !['initial', 'model', 'terminal'].includes(data.phase as string)
      )
        return { source: 'unavailable' };
      const contents = captureMemoryMap(data.memory_contents);
      return contents
        ? { source: 'live', contents }
        : { source: 'unavailable' };
    }
    if (this.agent.isLoading()) return { source: 'none' };
    const value = plainRecord(this.agent.value());
    if (!value || !Object.hasOwn(value, 'memory_contents'))
      return { source: 'none' };
    if (value.memory_scope_owner !== owner) return { source: 'unavailable' };
    const contents = captureMemoryMap(value.memory_contents);
    return contents
      ? { source: 'checkpoint', contents }
      : { source: 'unavailable' };
  });
  // #endregion

  // #region memory-source-label
  protected readonly memorySource = computed(() => this.observation().source);
  // #endregion
  protected readonly memoryFiles = computed<MemoryFile[]>(() =>
    Object.entries(this.observation().contents ?? {}).map(
      ([path, contents]) => ({
        path,
        contents,
        // Retain the older Angular line presentation; backing text stays literal.
        lines: contents
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
      })
    )
  );
  protected send(text: string): void {
    void this.agent.submit({ message: text });
  }
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(value).some(
        (key) =>
          typeof key !== 'string' ||
          !descriptors[key].enumerable ||
          !Object.hasOwn(descriptors[key], 'value')
      )
    )
      return undefined;
    return value as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
/** Exact one-path, bounded Unicode scalar data, copied without trimming. */
function captureMemoryMap(input: unknown): Record<string, string> | undefined {
  try {
    const record = plainRecord(input);
    if (!record) return undefined;
    const keys = Object.keys(record);
    if (keys.length > 1 || keys.some((key) => key !== '/memories/AGENTS.md'))
      return undefined;
    if (!keys.length) return Object.freeze({});
    const contents = record['/memories/AGENTS.md'];
    if (typeof contents !== 'string' || contents.length > 65536)
      return undefined;
    for (let i = 0; i < contents.length; i++) {
      const unit = contents.charCodeAt(i);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = contents.charCodeAt(++i);
        if (!(next >= 0xdc00 && next <= 0xdfff)) return undefined;
      } else if (unit >= 0xdc00 && unit <= 0xdfff) return undefined;
    }
    if (new TextEncoder().encode(contents).length > 65536) return undefined;
    return Object.freeze({ '/memories/AGENTS.md': contents });
  } catch {
    return undefined;
  }
}
