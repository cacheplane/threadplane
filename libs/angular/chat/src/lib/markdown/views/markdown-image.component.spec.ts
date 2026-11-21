// libs/angular/chat/src/lib/markdown/views/markdown-image.component.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import type { MarkdownImageNode } from '@cacheplane/partial-markdown';
import { MarkdownImageComponent } from './markdown-image.component';

@Component({
  standalone: true,
  imports: [MarkdownImageComponent],
  template: `<chat-md-image [node]="node()" />`,
})
class HostComponent {
  node = signal<MarkdownImageNode>({
    id: 0, type: 'image', status: 'complete',
    parent: null, index: null,
    url: 'https://example.com/x.png',
    alt: 'logo',
    title: '',
  });
}

describe('MarkdownImageComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [HostComponent] }));

  it('renders <img> with src/alt', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const img = fixture.nativeElement.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('https://example.com/x.png');
    expect(img.getAttribute('alt')).toBe('logo');
    expect(img.getAttribute('title')).toBeNull();
  });

  it('sets title attribute when present', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.node.set({
      id: 0, type: 'image', status: 'complete',
      parent: null, index: null,
      url: 'https://example.com/x.png',
      alt: 'logo',
      title: 'Company logo',
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img')?.getAttribute('title')).toBe('Company logo');
  });
});
