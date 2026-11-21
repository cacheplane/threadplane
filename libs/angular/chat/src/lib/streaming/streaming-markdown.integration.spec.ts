// libs/angular/chat/src/lib/streaming/streaming-markdown.integration.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import {
  ChatStreamingMdComponent,
  type StreamingMarkdownDocument,
} from './streaming-markdown.component';
import {
  ChatMathRenderer,
  provideChatMath,
} from '../markdown/katex-loader';

@Component({
  standalone: true,
  imports: [ChatStreamingMdComponent],
  template: `<chat-streaming-md [document]="document()" />`,
})
class HostComponent {
  document = signal<StreamingMarkdownDocument>({
    generation: 'test',
    phase: 'complete',
    content: '',
  });
}

const samples: {
  name: string;
  markdown: string;
  assertDom: (el: HTMLElement) => void;
}[] = [
  {
    name: 'paragraph',
    markdown: 'Hello world.\n',
    assertDom: (el) =>
      expect(el.querySelector('p')?.textContent?.trim()).toBe('Hello world.'),
  },
  {
    name: 'h1 heading',
    markdown: '# Title\n',
    assertDom: (el) =>
      expect(el.querySelector('h1')?.textContent?.trim()).toBe('Title'),
  },
  {
    name: 'unordered list',
    markdown: '- a\n- b\n\n',
    assertDom: (el) => {
      expect(el.querySelector('ul')).toBeTruthy();
      expect(el.querySelectorAll('li')).toHaveLength(2);
    },
  },
  {
    name: 'fenced code block',
    markdown: '```ts\nconst x = 1;\n```\n',
    assertDom: (el) => {
      const code = el.querySelector('pre code') as HTMLElement;
      expect(code?.className).toBe('language-ts');
      expect(code?.textContent).toBe('const x = 1;');
    },
  },
  {
    name: 'inline emphasis + strong + code',
    markdown: 'A *em* and **strong** and `code`.\n',
    assertDom: (el) => {
      expect(el.querySelector('em')?.textContent?.trim()).toBe('em');
      expect(el.querySelector('strong')?.textContent?.trim()).toBe('strong');
      expect(el.querySelector('code')?.textContent).toBe('code');
    },
  },
  {
    name: 'link',
    markdown: 'See [docs](https://example.com).\n',
    assertDom: (el) => {
      const a = el.querySelector('a') as HTMLAnchorElement;
      expect(a.getAttribute('href')).toBe('https://example.com');
      expect(a.textContent?.trim()).toBe('docs');
    },
  },
  {
    name: 'blockquote',
    markdown: '> hello\n> world\n\n',
    assertDom: (el) => expect(el.querySelector('blockquote')).toBeTruthy(),
  },
  {
    name: 'thematic break',
    markdown: 'before\n\n---\n\nafter\n',
    assertDom: (el) => expect(el.querySelector('hr')).toBeTruthy(),
  },
];

describe('chat-streaming-md integration', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({ imports: [HostComponent] })
  );

  for (const sample of samples) {
    it(`renders ${sample.name} (whole-string)`, () => {
      const fixture = TestBed.createComponent(HostComponent);
      fixture.componentInstance.document.set({
        generation: 'test',
        phase: 'complete',
        content: sample.markdown,
      });
      fixture.detectChanges();
      sample.assertDom(fixture.nativeElement);
    });

    it(`renders ${sample.name} (chunked with per-chunk CD)`, () => {
      const fixture = TestBed.createComponent(HostComponent);
      let acc = '';
      for (const ch of sample.markdown) {
        acc += ch;
        fixture.componentInstance.document.set({
          generation: 'test',
          phase: 'streaming',
          content: acc,
        });
        fixture.detectChanges(); // per-chunk CD must work — materialize() gives new root ref when tree changes
      }
      fixture.componentInstance.document.set({
        generation: 'test',
        phase: 'complete',
        content: acc,
      });
      fixture.detectChanges();
      sample.assertDom(fixture.nativeElement);
    });
  }

  it('renders inline math as KaTeX instead of leaking raw $ delimiters', async () => {
    TestBed.configureTestingModule({
      providers: [provideChatMath(() => import('katex'))],
    });
    await TestBed.inject(ChatMathRenderer).loaded();
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.document.set({
      generation: 'test',
      phase: 'complete',
      content: 'Euler: $e^{i\\pi}+1=0$ done.\n',
    });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.katex')).toBeTruthy();
    expect(el.textContent).toContain('Euler:');
    expect(el.textContent).not.toContain('$e^{i');
  });
});
