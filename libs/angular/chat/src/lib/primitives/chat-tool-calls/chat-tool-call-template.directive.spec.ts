import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, viewChildren, TemplateRef } from '@angular/core';
import { ChatToolCallTemplateDirective } from './chat-tool-call-template.directive';

@Component({
  standalone: true,
  imports: [ChatToolCallTemplateDirective],
  template: `
    <ng-template chatToolCallTemplate="search_web" let-call>
      <span data-template="search_web">{{ call.name }}</span>
    </ng-template>
    <ng-template chatToolCallTemplate="generate_image" let-call let-status="status">
      <span data-template="generate_image">{{ call.name }} / {{ status }}</span>
    </ng-template>
    <ng-template chatToolCallTemplate="*" let-call>
      <span data-template="wildcard">{{ call.name }}</span>
    </ng-template>
  `,
})
class HostComponent {
  readonly templates = viewChildren(ChatToolCallTemplateDirective);
}

describe('ChatToolCallTemplateDirective', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
  });

  it('exposes the tool name via the input alias', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const directives = fixture.componentInstance.templates();
    expect(directives.map((d) => d.name())).toEqual(['search_web', 'generate_image', '*']);
  });

  it('captures the TemplateRef', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const directives = fixture.componentInstance.templates();
    expect(directives.length).toBe(3);
    expect(directives[0].templateRef).toBeInstanceOf(TemplateRef);
  });
});
