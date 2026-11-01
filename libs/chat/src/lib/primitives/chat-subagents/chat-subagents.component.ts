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
import type { Agent } from '../../agent';
import type { Subagent } from '../../agent/subagent';
import { ChatSubagentCardComponent } from '../../compositions/chat-subagent-card/chat-subagent-card.component';

export function activeSubagentsFromAgent(agent: Agent): Subagent[] {
  const map = agent.subagents?.();
  if (!map) return [];
  const out: Subagent[] = [];
  map.forEach((sa) => {
    const s = sa.status();
    if (s !== 'complete' && s !== 'error') out.push(sa);
  });
  return out;
}

/** Renders pending and running subagents using projected templates or default subagent cards. */
@Component({
  selector: 'chat-subagents',
  standalone: true,
  imports: [NgTemplateOutlet, ChatSubagentCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (subagent of activeSubagents(); track subagent.toolCallId) {
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
