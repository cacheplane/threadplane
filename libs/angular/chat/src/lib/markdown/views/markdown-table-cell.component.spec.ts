// libs/angular/chat/src/lib/markdown/views/markdown-table-cell.component.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, signal, Signal } from '@angular/core';
import { views } from '@threadplane/angular/render';
import type { MarkdownTableCellNode } from '@cacheplane/partial-markdown';
import { MarkdownTableCellComponent } from './markdown-table-cell.component';
import { MarkdownTextComponent } from './markdown-text.component';
import { IS_HEADER_ROW } from '../markdown-table-row.token';
import { MARKDOWN_VIEW_REGISTRY } from '../markdown-view-registry';

function makeCellNode(alignment: MarkdownTableCellNode['alignment'] = null): MarkdownTableCellNode {
  return {
    id: 3, type: 'table-cell', status: 'complete',
    parent: null, index: null,
    alignment,
    children: [],
  } as MarkdownTableCellNode;
}

@Component({
  standalone: true,
  imports: [MarkdownTableCellComponent],
  template: `<chat-md-table-cell [node]="node()" />`,
})
class HostComponent {
  node = signal<MarkdownTableCellNode>(makeCellNode());
}

describe('MarkdownTableCellComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{
        provide: MARKDOWN_VIEW_REGISTRY,
        useValue: views({ 'text': MarkdownTextComponent }),
      }],
    });
  });

  it('renders <td> by default (no IS_HEADER_ROW token)', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('td')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('th')).toBeFalsy();
  });

  it('renders <th> when IS_HEADER_ROW token is true', () => {
    TestBed.overrideProvider(IS_HEADER_ROW, { useValue: signal(true) as Signal<boolean> });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('th')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('td')).toBeFalsy();
  });

  it('does not set text-align style when alignment is null', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const td = fixture.nativeElement.querySelector('td');
    expect(td.style.textAlign).toBe('');
  });

  it('sets text-align style from alignment value', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.node.set(makeCellNode('center'));
    fixture.detectChanges();
    const td = fixture.nativeElement.querySelector('td');
    expect(td.style.textAlign).toBe('center');
  });

  it('applies chat-md-table-cell class', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement.querySelector('td') ?? fixture.nativeElement.querySelector('th');
    expect(el.classList.contains('chat-md-table-cell')).toBe(true);
  });
});
