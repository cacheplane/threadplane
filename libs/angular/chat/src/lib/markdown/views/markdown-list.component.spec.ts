// libs/angular/chat/src/lib/markdown/views/markdown-list.component.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { views } from '@threadplane/angular/render';
import type { MarkdownListNode } from '@cacheplane/partial-markdown';
import { MarkdownListComponent } from './markdown-list.component';
import { MarkdownListItemComponent } from './markdown-list-item.component';
import { MARKDOWN_VIEW_REGISTRY } from '../markdown-view-registry';

@Component({
  standalone: true,
  imports: [MarkdownListComponent],
  template: `<chat-md-list [node]="node()" />`,
})
class HostComponent {
  node = signal<MarkdownListNode>({
    id: 0, type: 'list', status: 'complete',
    parent: null, index: null,
    ordered: false, start: null, tight: true,
    children: [],
  });
}

describe('MarkdownListComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{
        provide: MARKDOWN_VIEW_REGISTRY,
        useValue: views({ 'list-item': MarkdownListItemComponent }),
      }],
    });
  });

  it('renders <ul> for unordered lists', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('ul')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('ol')).toBeFalsy();
  });

  it('renders <ol> for ordered lists', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.node.set({
      id: 0, type: 'list', status: 'complete',
      parent: null, index: null,
      ordered: true, start: 1, tight: true,
      children: [],
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('ol')).toBeTruthy();
  });

  it('honors ordered list start attribute when not 1', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.node.set({
      id: 0, type: 'list', status: 'complete',
      parent: null, index: null,
      ordered: true, start: 5, tight: true,
      children: [],
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('ol')?.getAttribute('start')).toBe('5');
  });
});
