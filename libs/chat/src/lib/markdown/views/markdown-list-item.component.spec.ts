// libs/chat/src/lib/markdown/views/markdown-list-item.component.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { views } from '@threadplane/render';
import type { MarkdownListItemNode } from '@cacheplane/partial-markdown';
import { MarkdownListItemComponent } from './markdown-list-item.component';
import { MarkdownTextComponent } from './markdown-text.component';
import { MARKDOWN_VIEW_REGISTRY } from '../markdown-view-registry';

function makeItemNode(task?: { checked: boolean }): MarkdownListItemNode {
  return {
    id: 10, type: 'list-item', status: 'complete',
    parent: null, index: null,
    task,
    children: [],
  } as MarkdownListItemNode;
}

@Component({
  standalone: true,
  imports: [MarkdownListItemComponent],
  template: `<chat-md-list-item [node]="node()" />`,
})
class HostComponent {
  node = signal<MarkdownListItemNode>(makeItemNode());
}

describe('MarkdownListItemComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{
        provide: MARKDOWN_VIEW_REGISTRY,
        useValue: views({ 'text': MarkdownTextComponent }),
      }],
    });
  });

  it('renders a <li> element', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('li')).toBeTruthy();
  });

  it('does not render a checkbox for plain items', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[type="checkbox"]')).toBeFalsy();
  });

  it('does not apply task class for plain items', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const li = fixture.nativeElement.querySelector('li');
    expect(li.classList.contains('chat-md-list-item--task')).toBe(false);
  });

  it('renders a disabled unchecked checkbox for task items (unchecked)', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.node.set(makeItemNode({ checked: false }));
    fixture.detectChanges();
    const checkbox = fixture.nativeElement.querySelector('input[type="checkbox"]');
    expect(checkbox).toBeTruthy();
    expect(checkbox.disabled).toBe(true);
    expect(checkbox.checked).toBe(false);
  });

  it('renders a disabled checked checkbox for task items (checked)', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.node.set(makeItemNode({ checked: true }));
    fixture.detectChanges();
    const checkbox = fixture.nativeElement.querySelector('input[type="checkbox"]');
    expect(checkbox).toBeTruthy();
    expect(checkbox.disabled).toBe(true);
    expect(checkbox.checked).toBe(true);
  });

  it('draws a hidden-from-AT check box that follows the checked state, keeping the input as the accessible checkbox', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.node.set(makeItemNode({ checked: false }));
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const box = () => host.querySelector('.chat-md-task-box') as HTMLElement | null;
    expect(box()?.getAttribute('aria-hidden')).toBe('true');
    expect(box()?.classList.contains('chat-md-task-box--checked')).toBe(false);
    expect(box()?.querySelector('svg')).toBeNull();
    expect(host.querySelector('input[type="checkbox"]')?.classList.contains('chat-md-task-input')).toBe(true);

    fixture.componentInstance.node.set(makeItemNode({ checked: true }));
    fixture.detectChanges();
    expect(box()?.classList.contains('chat-md-task-box--checked')).toBe(true);
    expect(box()?.querySelector('svg')).not.toBeNull();
  });

  it('applies task class when task is defined', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.node.set(makeItemNode({ checked: false }));
    fixture.detectChanges();
    const li = fixture.nativeElement.querySelector('li');
    expect(li.classList.contains('chat-md-list-item--task')).toBe(true);
  });
});
