// libs/angular/chat/src/lib/markdown/markdown-children.component.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, signal, Type, input } from '@angular/core';
import { views, type ViewRegistry } from '@threadplane/angular/render';
import type { MarkdownNode, MarkdownParagraphNode, MarkdownTextNode } from '@cacheplane/partial-markdown';
import { MarkdownChildrenComponent } from './markdown-children.component';
import { MARKDOWN_VIEW_REGISTRY } from './markdown-view-registry';

@Component({
  standalone: true,
  selector: 'chat-md-text-stub',
  template: `<span data-test="text">{{ node().text }}</span>`,
})
class TextStub {
  readonly node = input.required<MarkdownTextNode>();
}

@Component({
  standalone: true,
  selector: 'chat-md-paragraph-stub',
  imports: [MarkdownChildrenComponent],
  template: `<p data-test="paragraph"><chat-md-children [parent]="node()" /></p>`,
})
class ParagraphStub {
  readonly node = input.required<MarkdownParagraphNode>();
}

@Component({
  standalone: true,
  imports: [MarkdownChildrenComponent],
  template: `<chat-md-children [parent]="parent()" />`,
})
class HostComponent {
  parent = signal<MarkdownNode>({
    id: 0, type: 'paragraph', status: 'complete',
    parent: null, index: null,
    children: [],
  } as MarkdownParagraphNode);
}

describe('MarkdownChildrenComponent', () => {
  let registry: ViewRegistry;

  beforeEach(() => {
    registry = views({
      'paragraph': ParagraphStub as Type<unknown>,
      'text':      TextStub as Type<unknown>,
    });
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: MARKDOWN_VIEW_REGISTRY, useValue: registry }],
    });
  });

  it('renders nothing when parent has no children', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[data-test]')).toHaveLength(0);
  });

  it('dispatches each child through the registry', () => {
    const fixture = TestBed.createComponent(HostComponent);
    const text1: MarkdownTextNode = {
      id: 1, type: 'text', status: 'complete',
      parent: null, index: 0, text: 'hi',
    };
    const text2: MarkdownTextNode = {
      id: 2, type: 'text', status: 'complete',
      parent: null, index: 1, text: ' there',
    };
    fixture.componentInstance.parent.set({
      id: 0, type: 'paragraph', status: 'complete',
      parent: null, index: null,
      children: [text1, text2],
    } as MarkdownParagraphNode);
    fixture.detectChanges();
    const spans = fixture.nativeElement.querySelectorAll('[data-test="text"]');
    expect(spans).toHaveLength(2);
    expect(spans[0].textContent).toBe('hi');
    expect(spans[1].textContent).toBe(' there');
  });

  it('skips nodes whose type is not in the registry', () => {
    const fixture = TestBed.createComponent(HostComponent);
    const unknownNode = {
      id: 1, type: 'mystery', status: 'complete',
      parent: null, index: 0,
    } as unknown as MarkdownNode;
    fixture.componentInstance.parent.set({
      id: 0, type: 'paragraph', status: 'complete',
      parent: null, index: null,
      children: [unknownNode],
    } as MarkdownParagraphNode);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[data-test]')).toHaveLength(0);
  });

  it('returns empty children array for non-container nodes', () => {
    const fixture = TestBed.createComponent(HostComponent);
    const text: MarkdownTextNode = {
      id: 0, type: 'text', status: 'complete',
      parent: null, index: null, text: 'hello',
    };
    fixture.componentInstance.parent.set(text as unknown as MarkdownNode);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[data-test]')).toHaveLength(0);
  });
});
