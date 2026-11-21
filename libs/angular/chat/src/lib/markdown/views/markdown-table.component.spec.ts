// libs/angular/chat/src/lib/markdown/views/markdown-table.component.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { views } from '@threadplane/angular/render';
import type { MarkdownTableCellNode, MarkdownTableNode, MarkdownTableRowNode } from '@cacheplane/partial-markdown';
import { MarkdownTableComponent } from './markdown-table.component';
import { MARKDOWN_VIEW_REGISTRY } from '../markdown-view-registry';

function makeTableNode(overrides: Partial<MarkdownTableNode> = {}): MarkdownTableNode {
  return {
    id: 1, type: 'table', status: 'complete',
    parent: null, index: null,
    alignments: [],
    children: [],
    ...overrides,
  } as MarkdownTableNode;
}

function makeCellNode(id: number, alignment: MarkdownTableCellNode['alignment'] = null): MarkdownTableCellNode {
  return {
    id, type: 'table-cell', status: 'complete',
    parent: null, index: null,
    alignment,
    children: [],
  } as MarkdownTableCellNode;
}

function makeRowNode(
  id: number,
  isHeader: boolean,
  children: MarkdownTableRowNode['children'] = [makeCellNode(id * 10), makeCellNode(id * 10 + 1)],
): MarkdownTableRowNode {
  return {
    id, type: 'table-row', status: 'complete',
    parent: null, index: null,
    isHeader,
    children,
  } as MarkdownTableRowNode;
}

@Component({
  standalone: true,
  imports: [MarkdownTableComponent],
  template: `<chat-md-table [node]="node()" />`,
})
class HostComponent {
  node = signal<MarkdownTableNode>(makeTableNode());
}

describe('MarkdownTableComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: MARKDOWN_VIEW_REGISTRY, useValue: views({}) }],
    });
  });

  it('renders a <table> element', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('table')).toBeTruthy();
  });

  it('applies chat-md-table class', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('table.chat-md-table')).toBeTruthy();
  });

  it('renders <thead> and <tbody> sections', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('thead')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('tbody')).toBeTruthy();
  });

  it('renders native table rows and cells directly under table sections', () => {
    // Keep the browser's table layout tree native. Custom element hosts between
    // <thead>/<tbody> and <tr>, or between <tr> and <td>/<th>, rely on
    // display: contents and can make a just-streamed row appear detached.
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.node.set(makeTableNode({
      alignments: [null, null],
      children: [
        makeRowNode(2, true),
        makeRowNode(3, false),
        makeRowNode(4, false),
      ],
    }));
    fixture.detectChanges();
    const table = fixture.nativeElement.querySelector('table') as HTMLTableElement;

    expect(table.querySelectorAll(':scope > thead > tr').length).toBe(1);
    expect(table.querySelectorAll(':scope > tbody > tr').length).toBe(2);
    expect(table.querySelectorAll('chat-md-table-row').length).toBe(0);
    expect(table.querySelectorAll('chat-md-table-cell').length).toBe(0);
    expect(table.querySelectorAll(':scope > thead > tr > th').length).toBe(2);
    expect(table.querySelectorAll(':scope > tbody > tr > td').length).toBe(4);
  });
});
