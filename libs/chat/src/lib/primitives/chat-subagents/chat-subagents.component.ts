// libs/chat/src/lib/primitives/chat-subagents/chat-subagents.component.ts
import {
  Component,
  computed,
  contentChild,
  input,
  TemplateRef,
  ChangeDetectionStrategy,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { Agent, AgentSubagent } from '../../agent';
import { ChatSubagentCardComponent } from '../../compositions/chat-subagent-card/chat-subagent-card.component';

/** The child agents that have not ended: pending, running, or of unknown outcome. */
export function activeSubagentsFromAgent(agent: Agent): AgentSubagent[] {
  return (agent.subagents() ?? []).filter((child) => child.status !== 'complete' && child.status !== 'error');
}

/** Renders pending and running subagents using projected templates or default subagent cards. */
@Component({
  selector: 'chat-subagents',
  standalone: true,
  imports: [NgTemplateOutlet, ChatSubagentCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (subagent of activeSubagents(); track subagent.id) {
      @if (templateRef()) {
        <ng-container [ngTemplateOutlet]="templateRef()!" [ngTemplateOutletContext]="{ $implicit: subagent }" />
      } @else {
        <chat-subagent-card [subagent]="subagent" />
      }
    }
  `,
})
export class ChatSubagentsComponent {
  readonly agent = input.required<Agent>();
  readonly templateRef = contentChild(TemplateRef);
  readonly activeSubagents = computed(() => activeSubagentsFromAgent(this.agent()));
}
