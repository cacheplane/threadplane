// libs/angular/chat/src/lib/streaming/streaming-markdown.table-stream.spec.ts
//
// Regression: a streaming table must render as a <table> as it arrives, not as
// raw "| a | b |" paragraph text. Explicit document phases keep the parser open
// until the producer atomically marks the generation complete.
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

describe('ChatStreamingMdComponent — streaming table rendering', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<HostComponent>>;
  let host: HostComponent;
  let el: HTMLElement;
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    el = fixture.nativeElement as HTMLElement;
  });
  const grow = (
    content: string,
    phase: StreamingMarkdownDocument['phase'] = 'streaming'
  ) => {
    host.document.set({ generation: 'test', phase, content });
    fixture.detectChanges();
  };

  it('renders a <table> from an explicitly streaming document', () => {
    grow('Here is a table:\n\n| Name ');
    grow('Here is a table:\n\n| Name | Age |'); // header on the open line, no delimiter
    expect(
      el.querySelector('table'),
      'header should render as a table, not raw pipes'
    ).toBeTruthy();
    const paras = [...el.querySelectorAll('p')].map((p) => p.textContent || '');
    expect(
      paras.some((t) => t.includes('| Name | Age |')),
      'no raw-pipe paragraph'
    ).toBe(false);
  });

  it('renders a <table> while streaming (flag true), through the delimiter wait', () => {
    grow('| Name | Age |');
    expect(el.querySelector('table')).toBeTruthy();
    grow('| Name | Age |\n'); // header committed, awaiting delimiter
    expect(el.querySelector('table')).toBeTruthy();
  });

  it('finalizes the table once the stream settles (streaming -> false)', () => {
    const content = '| Name | Age |\n| --- | --- |\n| Ada | 36 |\n';
    grow(content);
    expect(el.querySelector('table')).toBeTruthy();
    grow(content, 'complete');
    const table = el.querySelector('table');
    expect(table).toBeTruthy();
    expect(el.querySelectorAll('thead th').length).toBe(2);
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
  });

  it('renders a complete one-shot (non-streaming) table message', () => {
    grow('| Name | Age |\n| --- | --- |\n| Ada | 36 |\n', 'complete');
    expect(el.querySelector('table')).toBeTruthy();
    expect(el.querySelectorAll('thead th').length).toBe(2);
  });

  it('does not finalize or flash raw pipes while the document remains streaming', () => {
    grow('| Name | Age |');
    expect(el.querySelector('table')).toBeTruthy();
    fixture.detectChanges();
    fixture.detectChanges();
    expect(
      el.querySelector('table'),
      'table must survive unchanged change detection'
    ).toBeTruthy();
    expect(
      [...el.querySelectorAll('p')].some((p) =>
        (p.textContent || '').includes('|')
      ),
      'no raw-pipe paragraph while streaming'
    ).toBe(false);
    grow('| Name | Age |\n| --- | --- |\n');
    expect(el.querySelector('table')).toBeTruthy();
  });

  it('streams body rows inside the table — no paragraph, no second table (0.5.3)', () => {
    grow('| A | B |\n| - | - |\n');
    for (const c of ['|', '| x1', '| x1 | y', '| x1 | y1 |', '| x1 | y1 |\n']) {
      grow('| A | B |\n| - | - |\n' + c);
      expect(
        el.querySelectorAll('table').length,
        `one table at ${JSON.stringify(c)}`
      ).toBe(1);
      expect(
        [...el.querySelectorAll('p')].some((p) =>
          (p.textContent || '').includes('|')
        ),
        `no raw-pipe paragraph at ${JSON.stringify(c)}`
      ).toBe(false);
    }
  });

  it('streams a realistic comparison table as one table across small chunks', () => {
    const content =
      'Here is the comparison:\n\n' +
      '| Name | Mental model | When to use |\n' +
      '| --- | --- | --- |\n' +
      '| Angular Signals | Synchronous value graph | Local component state |\n' +
      '| RxJS | Event stream | Async flows and cancellation |\n' +
      '| zone.js | Async task patching | Zone-based change detection |\n\n' +
      'Done.';

    for (let i = 6; i <= content.length; i += 6) {
      grow(content.slice(0, i));
      const tableCount = el.querySelectorAll('table').length;
      if (tableCount > 0) {
        expect(
          tableCount,
          `one table at ${JSON.stringify(content.slice(0, i).slice(-40))}`
        ).toBe(1);
      }
      expect(
        [...el.querySelectorAll('p')].some((p) =>
          (p.textContent || '').includes('| zone.js')
        ),
        `no detached row paragraph at ${JSON.stringify(
          content.slice(0, i).slice(-40)
        )}`
      ).toBe(false);
    }
  });

  it('keeps a partial body row in the table when the document completes', () => {
    grow(
      '| Name | Mental model | When to use |\n' +
        '| --- | --- | --- |\n' +
        '| Angular signals | Fine-grained values | Local state |\n' +
        '| RxJS (Observables) [',
      'complete'
    );
    expect(el.querySelectorAll('table').length).toBe(1);
    expect(el.querySelectorAll('tbody tr').length).toBe(2);
    expect(
      [...el.querySelectorAll('p')].some((p) =>
        (p.textContent || '').includes('| RxJS')
      ),
      'no raw-pipe paragraph after finalizing a partial body row'
    ).toBe(false);
  });
});
