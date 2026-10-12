import { Component, computed } from '@angular/core';
import { ChatComponent, ChatWelcomeSuggestionComponent } from '@threadplane/chat';
import { ExampleChatLayoutComponent } from '@threadplane/example-layouts';
import { injectAgent } from '@threadplane/langgraph';

/** Name of the custom stream event the graph's visibility middleware emits. */
const SKILLS_EVENT = 'deep_agents.skills';

/** One entry of `skills_metadata`, parsed from a SKILL.md frontmatter block. */
interface SkillEntry {
  name: string;
  description: string;
  path: string;
  /** Directory prefix used to attribute requested file paths. */
  root: string;
  /** Requested paths under this skill; results are not inspected here. */
  opened: string[];
}

const SUGGESTIONS = [
  // value matches cockpit/deep-agents/skills/angular/e2e/da-skills.spec.ts PROMPT.
  {
    label: 'Mid-size jet at KASE',
    value: 'Can a mid-size jet operate out of KASE?',
    description: 'Matches the runway-analysis skill, which sends the agent to its margin table.',
  },
] as const;

/**
 * SkillsComponent shows progressive disclosure happening.
 *
 * SkillsMiddleware puts name, description, and instruction path in the prompt.
 * The panel displays that index and paths requested through read_file.
 *
 * PrivateStateAttr excludes Skills keys from declared input/output schemas;
 * the local compiled graph exposes metadata in root values and checkpoints.
 * Observed deployed API values omit private Skills keys while saved checkpoints
 * retain metadata. The named event supplies live index visibility, not proof of
 * a confirmed read. Optional load errors can appear when produced and normal
 * loads can omit them. The named
 * custom event always includes both keys, using an empty-list error fallback.
 * The panel prefers that event and falls back to agent.value(). Its checkpoint
 * label identifies that fallback, without proving reopened-thread provenance.
 *
 * Path attribution uses arguments only and does not inspect successful results.
 * A failed read can appear; body not read means no matching request was observed.
 * The React preview separately validates inspected reads. No Memory visibility
 * behavior is inferred from this Skills contract.
 */
@Component({
  selector: 'app-skills',
  standalone: true,
  imports: [ChatComponent, ChatWelcomeSuggestionComponent, ExampleChatLayoutComponent],
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
      <!-- #region skills-panel -->
      <div sidebar class="panel">
        <h3 class="cap">Skill Index</h3>
        <p class="source" data-testid="skills-source" [attr.data-source]="skillsSource()">
          {{ skillsSource() === 'live' ? 'streamed live' : skillsSource() === 'checkpoint' ? 'from checkpoint' : 'no source yet' }}
        </p>
        @if (skills().length === 0) {
          <p class="empty">No skills loaded</p>
        }
        @for (skill of skills(); track skill.name) {
          <div
            class="skill"
            data-testid="skill"
            [attr.data-name]="skill.name"
            [attr.data-opened]="skill.opened.length > 0 ? 'true' : 'false'"
          >
            <span class="skill__name">{{ skill.name }}</span>
            <p class="skill__description">{{ skill.description }}</p>
            @if (skill.opened.length === 0) {
              <p class="skill__files skill__files--idle">body not read</p>
            } @else {
              @for (file of skill.opened; track file) {
                <p class="skill__files" data-testid="skill-open">{{ file }}</p>
              }
            }
          </div>
        }
        <p class="hint">
          Only the name and description above were put in the model's prompt. Everything else was
          read on demand.
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

      .skill {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        padding: 0.5rem;
        border-radius: var(--tplane-chat-radius-card);
        background: var(--tplane-chat-surface-alt);
      }

      .skill[data-opened='true'] {
        outline: 1px solid var(--tplane-chat-primary);
      }

      .skill__name {
        color: var(--tplane-chat-text);
        font-family: var(--tplane-chat-font-mono);
        font-size: var(--tplane-chat-font-size-sm);
      }

      .skill__description {
        margin: 0;
        color: var(--tplane-chat-text-muted);
        font-size: var(--tplane-chat-font-size-xs);
        line-height: var(--tplane-chat-line-height);
      }

      .skill__files {
        margin: 0;
        color: var(--tplane-chat-text);
        font-family: var(--tplane-chat-font-mono);
        font-size: var(--tplane-chat-font-size-xs);
      }

      .skill__files--idle {
        color: var(--tplane-chat-text-muted);
        font-style: italic;
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
export class SkillsComponent {
  protected readonly agent = injectAgent();

  protected readonly suggestions = SUGGESTIONS;

  // #region skills-sources
  private readonly liveSkills = computed<Record<string, unknown>[] | null>(() => {
    for (const event of [...this.agent.customEvents()].reverse()) {
      if (event.name !== SKILLS_EVENT) continue;
      const metadata = (event.data as { skills_metadata?: unknown } | undefined)?.[
        'skills_metadata'
      ];
      if (Array.isArray(metadata) && metadata.length > 0) {
        return metadata as Record<string, unknown>[];
      }
    }
    return null;
  });

  private readonly settledSkills = computed<Record<string, unknown>[] | null>(() => {
    const metadata = (this.agent.value() as Record<string, unknown> | undefined)?.[
      'skills_metadata'
    ];
    return Array.isArray(metadata) && metadata.length > 0
      ? (metadata as Record<string, unknown>[])
      : null;
  });

  protected readonly skillsSource = computed<'live' | 'checkpoint' | 'none'>(() => {
    if (this.liveSkills()) return 'live';
    return this.settledSkills() ? 'checkpoint' : 'none';
  });
  // #endregion

  // #region opened-paths
  /** Requested read_file paths, without validating completion or returned content. */
  private readonly openedPaths = computed<string[]>(() => {
    const paths: string[] = [];
    for (const call of this.agent.toolCalls()) {
      if (call.name !== 'read_file') continue;
      const path = (call.args as Record<string, unknown> | undefined)?.['file_path'];
      if (typeof path === 'string' && !paths.includes(path)) paths.push(path);
    }
    return paths;
  });
  // #endregion

  // #region skills-projection
  protected readonly skills = computed<SkillEntry[]>(() => {
    const source = this.liveSkills() ?? this.settledSkills() ?? [];
    const opened = this.openedPaths();
    return source.map((entry) => {
      const path = String(entry['path'] ?? '');
      const root = path.slice(0, path.lastIndexOf('/') + 1);
      return {
        name: String(entry['name'] ?? ''),
        description: String(entry['description'] ?? ''),
        path,
        root,
        opened: root ? opened.filter((candidate) => candidate.startsWith(root)) : [],
      };
    });
  });
  // #endregion

  protected send(text: string): void {
    void this.agent.submit({ message: text });
  }
}
