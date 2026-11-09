import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, viewChildren } from '@angular/core';
import { ChatToolResultTemplateDirective } from './chat-tool-result-template.directive';

@Component({
  standalone: true,
  imports: [ChatToolResultTemplateDirective],
  template: `
    <ng-template chatToolResultTemplate="lookup" let-activity><b>{{ activity.id }}</b></ng-template>
    <ng-template chatToolResultTemplate="*" let-activity><i>{{ activity.id }}</i></ng-template>
  `,
})
class HostComponent {
  readonly templates = viewChildren(ChatToolResultTemplateDirective);
}

describe('ChatToolResultTemplateDirective', () => {
  it('exposes the tool name via the input alias and a template ref', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const templates = fixture.componentInstance.templates();
    expect(templates.map((t) => t.name())).toEqual(['lookup', '*']);
    expect(templates[0].templateRef).toBeTruthy();
  });
});
