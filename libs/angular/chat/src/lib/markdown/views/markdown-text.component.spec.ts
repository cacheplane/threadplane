// libs/angular/chat/src/lib/markdown/views/markdown-text.component.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import type { MarkdownTextNode } from '@cacheplane/partial-markdown';
import { MarkdownTextComponent } from './markdown-text.component';

@Component({
  standalone: true,
  imports: [MarkdownTextComponent],
  template: `<chat-md-text [node]="node()" />`,
})
class HostComponent {
  node = signal<MarkdownTextNode>({
    id: 0, type: 'text', status: 'complete',
    parent: null, index: null, text: 'hello',
  });
}

describe('MarkdownTextComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [HostComponent] }));

  it('renders the node text', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('chat-md-text')?.textContent).toBe('hello');
  });

  it('updates when the text changes', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    fixture.componentInstance.node.set({
      id: 0, type: 'text', status: 'streaming',
      parent: null, index: null, text: 'hello world',
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('chat-md-text')?.textContent).toBe('hello world');
  });
});
