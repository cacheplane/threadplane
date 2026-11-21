// libs/angular/chat/src/lib/markdown/views/markdown-heading.component.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { views } from '@threadplane/angular/render';
import type { MarkdownHeadingNode, MarkdownTextNode } from '@cacheplane/partial-markdown';
import { MarkdownHeadingComponent } from './markdown-heading.component';
import { MarkdownTextComponent } from './markdown-text.component';
import { MARKDOWN_VIEW_REGISTRY } from '../markdown-view-registry';

@Component({
  standalone: true,
  imports: [MarkdownHeadingComponent],
  template: `<chat-md-heading [node]="node()" />`,
})
class HostComponent {
  node = signal<MarkdownHeadingNode>({
    id: 0, type: 'heading', status: 'complete',
    parent: null, index: null,
    level: 1,
    children: [{
      id: 1, type: 'text', status: 'complete',
      parent: null, index: 0, text: 'Title',
    } as MarkdownTextNode],
  });
}

describe('MarkdownHeadingComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{
        provide: MARKDOWN_VIEW_REGISTRY,
        useValue: views({ 'text': MarkdownTextComponent }),
      }],
    });
  });

  for (const level of [1, 2, 3, 4, 5, 6] as const) {
    it(`renders an h${level} for level ${level}`, () => {
      const fixture = TestBed.createComponent(HostComponent);
      fixture.componentInstance.node.set({
        id: 0, type: 'heading', status: 'complete',
        parent: null, index: null,
        level,
        children: [{
          id: 1, type: 'text', status: 'complete',
          parent: null, index: 0, text: 'X',
        } as MarkdownTextNode],
      });
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector(`h${level}`)).toBeTruthy();
    });
  }
});
