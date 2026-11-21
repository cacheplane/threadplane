// libs/angular/chat/src/lib/streaming/streaming-markdown.ng0956.spec.ts
//
// Regression guard for NG0956 ("tracking expression caused re-creation of the
// DOM structure") during STREAMING markdown.
//
// Why a component test, not an e2e: NG0956 fires only when a tracked `@for`
// collection RE-MATERIALIZES across change-detection cycles — specifically a
// (roughly) fixed-length collection whose item identities all churn each cycle,
// which is exactly what a streaming markdown re-parse produces (the same list /
// table re-parsed to fresh token objects on every chunk). The aimock e2e
// replays a message atomically (one `content` snapshot), so the `@for`s render
// once and never re-evaluate — an e2e console-guard there false-passes. This
// test drives that re-materialization directly and asserts no NG0956 from the
// markdown `@for`s (markdown-children + markdown-table use `track $index`).
//
// The first test is a NEGATIVE CONTROL proving the capture mechanism actually
// observes NG0956 in this environment — without it, the assertions below could
// pass simply because nothing ever emits the warning.
import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
  type MockInstance,
} from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import {
  ChatStreamingMdComponent,
  type StreamingMarkdownDocument,
} from './streaming-markdown.component';

/** Spy console.warn + console.error; collect any NG0956 messages. */
function captureNg0956(): { hits: string[]; restore: () => void } {
  const hits: string[] = [];
  const sink = (...args: unknown[]): void => {
    const msg = args.map((a) => String(a)).join(' ');
    if (msg.includes('NG0956')) hits.push(msg);
  };
  const spies: MockInstance[] = [
    vi.spyOn(console, 'warn').mockImplementation(sink as never),
    vi.spyOn(console, 'error').mockImplementation(sink as never),
  ];
  return { hits, restore: () => spies.forEach((s) => s.mockRestore()) };
}

// Negative control: a fixed-length `@for` tracked by OBJECT IDENTITY whose items
// are replaced with fresh refs each cycle — the canonical NG0956 trigger.
@Component({
  standalone: true,
  template: `@for (item of items(); track item) {<span>{{ item.v }}</span
    >}`,
})
class IdentityTrackHost {
  readonly items = signal<{ v: number }[]>([]);
  rematerialize(): void {
    // Same length (3), all-new object refs → identity churn at every position.
    this.items.set([{ v: 0 }, { v: 1 }, { v: 2 }]);
  }
}

// Real subject: the streaming markdown component (markdown-children /
// markdown-table render their `@for`s with `track $index`).
@Component({
  standalone: true,
  imports: [ChatStreamingMdComponent],
  template: `<chat-streaming-md [document]="document()" />`,
})
class MarkdownHost {
  readonly document = signal<StreamingMarkdownDocument>({
    generation: 'initial',
    phase: 'streaming',
    content: '',
  });
}

describe('NG0956 streaming regression guard', () => {
  describe('negative control (proves NG0956 is observable here)', () => {
    beforeEach(() =>
      TestBed.configureTestingModule({ imports: [IdentityTrackHost] })
    );

    it('captures NG0956 when a fixed-length @for tracks by churning identity', () => {
      const cap = captureNg0956();
      try {
        const fixture = TestBed.createComponent(IdentityTrackHost);
        for (let i = 0; i < 4; i++) {
          fixture.componentInstance.rematerialize();
          fixture.detectChanges();
        }
        expect(cap.hits.length).toBeGreaterThan(0);
      } finally {
        cap.restore();
      }
    });
  });

  describe('streaming markdown emits no NG0956 across re-materialization', () => {
    beforeEach(() =>
      TestBed.configureTestingModule({ imports: [MarkdownHost] })
    );

    it('a re-parsing fixed-length list does not warn NG0956', () => {
      const cap = captureNg0956();
      try {
        const fixture = TestBed.createComponent(MarkdownHost);
        // Each step is a 3-item list with DIFFERENT text → same structure,
        // fresh token objects on every re-parse → the markdown-children `@for`
        // genuinely re-materializes. `track $index` must keep NG0956 away.
        const steps = [
          '- alpha one\n- beta two\n- gamma three\n',
          '- alpha ONE\n- beta TWO\n- gamma THREE\n',
          '- alpha 1\n- beta 2\n- gamma 3\n',
          '- alpha one!\n- beta two!\n- gamma three!\n',
        ];
        for (const [index, content] of steps.entries()) {
          fixture.componentInstance.document.set({
            generation: `list-${index}`,
            phase: 'streaming',
            content,
          });
          fixture.detectChanges();
        }
        expect(cap.hits).toEqual([]);
      } finally {
        cap.restore();
      }
    });

    it('a re-parsing fixed-size table does not warn NG0956', () => {
      const cap = captureNg0956();
      try {
        const fixture = TestBed.createComponent(MarkdownHost);
        const table = (a: string, b: string, c: string): string =>
          `| Name | Value |\n| --- | --- |\n| ${a} | 1 |\n| ${b} | 2 |\n| ${c} | 3 |\n`;
        const steps = [
          table('alpha', 'beta', 'gamma'),
          table('ALPHA', 'BETA', 'GAMMA'),
          table('a', 'b', 'c'),
          table('one', 'two', 'three'),
        ];
        for (const [index, content] of steps.entries()) {
          fixture.componentInstance.document.set({
            generation: `table-${index}`,
            phase: 'streaming',
            content,
          });
          fixture.detectChanges();
        }
        expect(cap.hits).toEqual([]);
      } finally {
        cap.restore();
      }
    });
  });
});
