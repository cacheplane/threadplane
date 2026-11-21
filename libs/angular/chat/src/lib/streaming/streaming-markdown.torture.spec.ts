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

describe('ChatStreamingMdComponent — streaming markdown torture set', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<HostComponent>>;
  let host: HostComponent;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    el = fixture.nativeElement as HTMLElement;
  });

  const grow = (content: string) => {
    host.document.set({ generation: 'test', phase: 'streaming', content });
    fixture.detectChanges();
  };

  it('streams list items in one list without raw marker paragraphs', () => {
    for (const content of [
      '- alpha',
      '- alpha\n- be',
      '- alpha\n- beta\n- gam',
    ]) {
      grow(content);
      expect(el.querySelectorAll('ul')).toHaveLength(1);
      expect(
        [...el.querySelectorAll('p')].some((p) =>
          (p.textContent ?? '').startsWith('- ')
        ),
        `no raw list marker paragraph at ${JSON.stringify(content)}`
      ).toBe(false);
    }
    expect(
      [...el.querySelectorAll('li')].map((li) => li.textContent?.trim())
    ).toEqual(['alpha', 'beta', 'gam']);
  });

  it('streams fenced code as one code block while the closing fence is pending', () => {
    for (const content of [
      '```ts\n',
      '```ts\nconst answer =',
      '```ts\nconst answer = 42;',
    ]) {
      grow(content);
      expect(el.querySelectorAll('pre code')).toHaveLength(1);
      expect(el.querySelector('pre code')?.className).toBe('language-ts');
      expect(el.querySelector('p')?.textContent ?? '').not.toContain('```');
    }
    expect(el.querySelector('pre code')?.textContent).toBe(
      'const answer = 42;'
    );
  });

  it('streams nested inline formatting without leaking delimiter text', () => {
    grow('A *em and **strong and `code');
    expect(el.querySelector('em')?.textContent).toContain('em and');
    expect(el.querySelector('strong')?.textContent).toContain(
      'strong and code'
    );
    expect(el.querySelector('strong code')?.textContent).toBe('code');
    expect(el.textContent).not.toContain('**strong');
  });

  it('streams blockquote content inside the blockquote', () => {
    grow('> hello\n> wor');
    const quote = el.querySelector('blockquote');
    expect(quote).toBeTruthy();
    const paragraph = quote?.querySelector('p');
    expect(paragraph?.textContent).toBe('hellowor');
    expect(paragraph?.querySelector('br')).toBeTruthy();
    expect([...el.querySelectorAll('p')].every((p) => quote?.contains(p))).toBe(
      true
    );
  });
});
