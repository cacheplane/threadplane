// libs/angular/chat/src/lib/streaming/streaming-markdown.identity.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import {
  ChatStreamingMdComponent,
  type StreamingMarkdownDocument,
} from './streaming-markdown.component';

@Component({
  standalone: true,
  imports: [ChatStreamingMdComponent],
  template: `<chat-streaming-md [document]="document()" />`,
})
class HostComponent {
  document = signal<StreamingMarkdownDocument>({
    generation: 'test',
    phase: 'streaming',
    content: '',
  });
}

describe('chat-streaming-md — identity preservation', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({ imports: [HostComponent] })
  );

  it('keeps the first paragraph DOM stable when a second paragraph is appended', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.document.set({
      generation: 'test',
      phase: 'streaming',
      content: 'First.\n\n',
    });
    fixture.detectChanges();
    const firstP = fixture.nativeElement.querySelector('p');
    expect(firstP?.textContent?.trim()).toBe('First.');

    fixture.componentInstance.document.set({
      generation: 'test',
      phase: 'streaming',
      content: 'First.\n\nSecond.\n\n',
    });
    fixture.detectChanges();

    const allPs = fixture.nativeElement.querySelectorAll('p');
    expect(allPs).toHaveLength(2);
    // The first <p> is the same DOM node — Angular preserved it because
    // materialize() returned the same JS reference for the unchanged subtree.
    expect(allPs[0]).toBe(firstP);
  });

  it('keeps the heading DOM stable when subsequent paragraphs stream in', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.document.set({
      generation: 'test',
      phase: 'streaming',
      content: '# Title\n\n',
    });
    fixture.detectChanges();
    const h1 = fixture.nativeElement.querySelector('h1');

    fixture.componentInstance.document.set({
      generation: 'test',
      phase: 'streaming',
      content: '# Title\n\nA paragraph.\n\n',
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('h1')).toBe(h1);
  });
});
