// libs/angular/chat/src/lib/markdown/views/markdown-link.component.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { views } from '@threadplane/angular/render';
import type { MarkdownLinkNode, MarkdownTextNode } from '@cacheplane/partial-markdown';
import { MarkdownLinkComponent } from './markdown-link.component';
import { MarkdownTextComponent } from './markdown-text.component';
import { MARKDOWN_VIEW_REGISTRY } from '../markdown-view-registry';

@Component({
  standalone: true,
  imports: [MarkdownLinkComponent],
  template: `<chat-md-link [node]="node()" />`,
})
class HostComponent {
  node = signal<MarkdownLinkNode>({
    id: 0, type: 'link', status: 'complete',
    parent: null, index: null,
    url: 'https://example.com',
    title: '',
    children: [{
      id: 1, type: 'text', status: 'complete',
      parent: null, index: 0, text: 'docs',
    } as MarkdownTextNode],
  });
}

describe('MarkdownLinkComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{
        provide: MARKDOWN_VIEW_REGISTRY,
        useValue: views({ 'text': MarkdownTextComponent }),
      }],
    });
  });

  it('renders <a> with href', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const a = fixture.nativeElement.querySelector('a') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('https://example.com');
  });

  it('renders link text via the registry', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a')?.textContent?.trim()).toBe('docs');
  });

  it('omits title attribute when blank', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a')?.hasAttribute('title')).toBe(false);
  });

  it('Angular sanitizes javascript: URLs', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.node.set({
      id: 0, type: 'link', status: 'complete',
      parent: null, index: null,
      url: 'javascript:alert(1)',
      title: '',
      children: [{
        id: 1, type: 'text', status: 'complete',
        parent: null, index: 0, text: 'click',
      } as MarkdownTextNode],
    });
    fixture.detectChanges();
    const href = fixture.nativeElement.querySelector('a')?.getAttribute('href') ?? '';
    expect(href).toMatch(/^unsafe:|^$/);
  });
});
