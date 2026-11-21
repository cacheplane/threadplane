// libs/angular/chat/src/lib/markdown/views/markdown-table-row.component.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { views } from '@threadplane/angular/render';
import type { MarkdownTableCellNode, MarkdownTableRowNode } from '@cacheplane/partial-markdown';
import { MarkdownTableRowComponent } from './markdown-table-row.component';
import { MarkdownTableCellComponent } from './markdown-table-cell.component';
import { MARKDOWN_VIEW_REGISTRY } from '../markdown-view-registry';

function makeRowNode(isHeader: boolean, children: MarkdownTableRowNode['children'] = []): MarkdownTableRowNode {
  return {
    id: 2, type: 'table-row', status: 'complete',
    parent: null, index: null,
    isHeader,
    children,
  } as MarkdownTableRowNode;
}

function makeCellNode(id: number): MarkdownTableCellNode {
  return {
    id, type: 'table-cell', status: 'complete',
    parent: null, index: null,
    alignment: null,
    children: [],
  } as MarkdownTableCellNode;
}

@Component({
  standalone: true,
  imports: [MarkdownTableRowComponent],
  template: `<chat-md-table-row [node]="node()" />`,
})
class HostComponent {
  node = signal<MarkdownTableRowNode>(makeRowNode(false));
}

describe('MarkdownTableRowComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{
        provide: MARKDOWN_VIEW_REGISTRY,
        useValue: views({ 'table-cell': MarkdownTableCellComponent }),
      }],
    });
  });

  it('renders a <tr> element', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('tr')).toBeTruthy();
  });

  it('applies chat-md-table-row class', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('tr.chat-md-table-row')).toBeTruthy();
  });

  it('does NOT apply header class for body rows', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const tr = fixture.nativeElement.querySelector('tr');
    expect(tr.classList.contains('chat-md-table-row--header')).toBe(false);
  });

  it('applies header class for header rows', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.node.set(makeRowNode(true));
    fixture.detectChanges();
    const tr = fixture.nativeElement.querySelector('tr');
    expect(tr.classList.contains('chat-md-table-row--header')).toBe(true);
  });

  it('renders table-cell components directly under the table row', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.node.set(makeRowNode(false, [
      makeCellNode(3),
      makeCellNode(4),
    ] as MarkdownTableRowNode['children']));
    fixture.detectChanges();

    const tr = fixture.nativeElement.querySelector('tr');
    expect(tr.querySelector(':scope > chat-md-children')).toBeNull();
    expect(tr.querySelectorAll(':scope > chat-md-table-cell').length).toBe(2);
  });
});
