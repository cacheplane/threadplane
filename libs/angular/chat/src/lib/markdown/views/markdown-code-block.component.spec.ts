// libs/angular/chat/src/lib/markdown/views/markdown-code-block.component.spec.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import type { MarkdownCodeBlockNode } from '@cacheplane/partial-markdown';
import { MarkdownCodeBlockComponent } from './markdown-code-block.component';

@Component({
  standalone: true,
  imports: [MarkdownCodeBlockComponent],
  template: `<chat-md-code-block [node]="node()" />`,
})
class HostComponent {
  node = signal<MarkdownCodeBlockNode>({
    id: 0, type: 'code-block', status: 'complete',
    parent: null, index: null,
    variant: 'fenced', language: 'ts', meta: '', text: 'const x = 1;',
  });
}

describe('MarkdownCodeBlockComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [HostComponent] }));
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const clipboard = (writeText: (text: string) => Promise<void>) =>
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { clipboard: { writeText } }));
  const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
  const copyButton = (root: HTMLElement) =>
    root.querySelector('button.chat-md-code__copy') as HTMLButtonElement | null;

  it('copies a closed block and reads Copied for two seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const writeText = vi.fn(async () => undefined);
    clipboard(writeText);
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const button = copyButton(fixture.nativeElement)!;
    expect(button.getAttribute('aria-label')).toBe('Copy code');
    button.click();
    await settle();
    fixture.detectChanges();
    expect(writeText).toHaveBeenCalledWith('const x = 1;');
    expect(button.getAttribute('aria-label')).toBe('Copied');
    expect(button.hasAttribute('data-copied')).toBe(true);
    vi.advanceTimersByTime(2000);
    fixture.detectChanges();
    expect(button.getAttribute('aria-label')).toBe('Copy code');
  });

  it('offers no copy while the block is still streaming', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.node.set({
      id: 0, type: 'code-block', status: 'streaming',
      parent: null, index: null,
      variant: 'fenced', language: 'ts', meta: '', text: 'const',
    });
    fixture.detectChanges();
    expect(copyButton(fixture.nativeElement)).toBeNull();
    fixture.componentInstance.node.set({
      id: 0, type: 'code-block', status: 'complete',
      parent: null, index: null,
      variant: 'fenced', language: 'ts', meta: '', text: 'const x = 1;',
    });
    fixture.detectChanges();
    expect(copyButton(fixture.nativeElement)).not.toBeNull();
  });

  it('stays quiet when the clipboard and the selection copy both refuse', async () => {
    clipboard(async () => { throw new Error('denied'); });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    copyButton(fixture.nativeElement)!.click();
    await settle();
    fixture.detectChanges();
    expect(copyButton(fixture.nativeElement)!.getAttribute('aria-label')).toBe('Copy code');
  });

  it('renders <pre><code> with the text', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const code = fixture.nativeElement.querySelector('pre code') as HTMLElement;
    expect(code.textContent).toBe('const x = 1;');
  });

  it('sets language-XX class when language is provided', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('pre code')?.className).toBe('language-ts');
  });

  it('omits language class when language is empty', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.node.set({
      id: 0, type: 'code-block', status: 'complete',
      parent: null, index: null,
      variant: 'fenced', language: '', meta: '', text: 'plain',
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('pre code')?.className).toBe('');
  });
});
