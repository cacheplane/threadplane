// libs/angular/chat/src/lib/streaming/streaming-markdown.component.spec.ts
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  createPartialMarkdownParser,
  materialize,
  type MarkdownDocumentNode,
  type PartialMarkdownParser,
} from '@cacheplane/partial-markdown';
import { beforeEach, describe, expect, it } from 'vitest';
import { CitationsResolverService } from '@threadplane/angular/chat/shared';
import {
  ChatStreamingMdComponent,
  STREAMING_MARKDOWN_CONTRACT_VIOLATION_POLICY,
  STREAMING_MARKDOWN_PARSER_FACTORY,
  type StreamingMarkdownContractViolationPolicy,
  type StreamingMarkdownDocument,
} from './streaming-markdown.component';

const streaming = (
  content: string,
  generation = 'generation-1'
): StreamingMarkdownDocument => ({ generation, phase: 'streaming', content });

const complete = (
  content: string,
  generation = 'generation-1'
): StreamingMarkdownDocument => ({ generation, phase: 'complete', content });

@Component({
  standalone: true,
  imports: [ChatStreamingMdComponent],
  template: `<chat-streaming-md [document]="document()" />`,
})
class HostComponent {
  readonly document = signal<StreamingMarkdownDocument>(streaming(''));
}

interface ParserCall {
  readonly parser: number;
  readonly method: 'push' | 'finish';
  readonly chunk?: string;
  readonly contentAtCall: string;
}

function parserTrace(): {
  readonly calls: ParserCall[];
  readonly parsers: PartialMarkdownParser[];
  readonly rootReads: number[];
  readonly factory: () => PartialMarkdownParser;
} {
  const calls: ParserCall[] = [];
  const parsers: PartialMarkdownParser[] = [];
  const rootReads: number[] = [];

  return {
    calls,
    parsers,
    rootReads,
    factory: () => {
      const delegate = createPartialMarkdownParser();
      const parser = parsers.length;
      let content = '';
      const traced: PartialMarkdownParser = {
        get root() {
          rootReads.push(parser);
          return delegate.root;
        },
        push(chunk) {
          content += chunk;
          calls.push({ parser, method: 'push', chunk, contentAtCall: content });
          return delegate.push(chunk);
        },
        finish() {
          calls.push({ parser, method: 'finish', contentAtCall: content });
          return delegate.finish();
        },
        getByPath(path) {
          return delegate.getByPath(path);
        },
      };
      parsers.push(traced);
      return traced;
    },
  };
}

function expectedRoot(
  document: StreamingMarkdownDocument
): MarkdownDocumentNode | null {
  const parser = createPartialMarkdownParser();
  parser.push(document.content);
  if (document.phase === 'complete') parser.finish();
  return materialize(parser.root) as MarkdownDocumentNode | null;
}

function setup(policy: StreamingMarkdownContractViolationPolicy) {
  const trace = parserTrace();
  TestBed.configureTestingModule({
    imports: [HostComponent],
    providers: [
      CitationsResolverService,
      {
        provide: STREAMING_MARKDOWN_CONTRACT_VIOLATION_POLICY,
        useValue: policy,
      },
      { provide: STREAMING_MARKDOWN_PARSER_FACTORY, useValue: trace.factory },
    ],
  });
  const fixture = TestBed.createComponent(HostComponent);
  const host = fixture.componentInstance;
  const resolver = TestBed.inject(CitationsResolverService);
  const component = () =>
    fixture.debugElement.query(By.directive(ChatStreamingMdComponent))
      .componentInstance as ChatStreamingMdComponent;
  const transition = (document: StreamingMarkdownDocument): void => {
    host.document.set(document);
    fixture.detectChanges();
  };
  return { fixture, host, component, transition, trace, resolver };
}

function textContent(
  fixture: ReturnType<typeof TestBed.createComponent<HostComponent>>
): string {
  return (fixture.nativeElement.textContent as string)
    .replace(/\s+/g, ' ')
    .trim();
}

const policies: StreamingMarkdownContractViolationPolicy[] = [
  'throw',
  'rebuild',
];

describe.each(['streaming', 'complete'] as const)(
  'citation lifecycle for an empty %s document',
  (phase) => {
    beforeEach(() => TestBed.resetTestingModule());

    it('clears definitions when a new generation has no materialized root', () => {
      const { resolver, transition } = setup('throw');
      transition(
        complete(
          'Answer[^source].\n\n[^source]: Source https://example.com\n',
          'cited'
        )
      );
      expect(resolver.markdownDefs().has('source')).toBe(true);

      transition({ generation: 'empty', phase, content: '' });

      expect(resolver.markdownDefs()).toEqual(new Map());
    });
  }
);

describe.each(policies)(
  'ChatStreamingMdComponent transitions (%s policy)',
  (policy) => {
    beforeEach(() => TestBed.resetTestingModule());

    it('none -> streaming creates a parser and pushes the supplied content', () => {
      const { fixture, component, transition, trace } = setup(policy);
      const document = streaming('Hello');

      transition(document);

      expect(trace.parsers).toHaveLength(1);
      expect(trace.calls).toEqual([
        { parser: 0, method: 'push', chunk: 'Hello', contentAtCall: 'Hello' },
      ]);
      expect(component().root()).toEqual(expectedRoot(document));
      expect(textContent(fixture)).toBe('Hello');
    });

    it('none -> complete pushes content and finishes exactly once synchronously', () => {
      const { component, transition, trace } = setup(policy);
      const document = complete('Hello');

      transition(document);

      expect(trace.calls).toEqual([
        { parser: 0, method: 'push', chunk: 'Hello', contentAtCall: 'Hello' },
        { parser: 0, method: 'finish', contentAtCall: 'Hello' },
      ]);
      expect(component().root()).toEqual(expectedRoot(document));
    });

    it('streaming -> streaming appends only the delta', () => {
      const { component, transition, trace } = setup(policy);
      transition(streaming('Hello'));

      const document = streaming('Hello world');
      transition(document);

      expect(trace.parsers).toHaveLength(1);
      expect(trace.calls).toEqual([
        { parser: 0, method: 'push', chunk: 'Hello', contentAtCall: 'Hello' },
        {
          parser: 0,
          method: 'push',
          chunk: ' world',
          contentAtCall: 'Hello world',
        },
      ]);
      expect(component().root()).toEqual(expectedRoot(document));
    });

    it('streaming -> complete pushes the final delta before one synchronous finish', () => {
      const { component, transition, trace } = setup(policy);
      transition(streaming('Hello'));

      const document = complete('Hello world');
      transition(document);

      expect(trace.calls).toEqual([
        { parser: 0, method: 'push', chunk: 'Hello', contentAtCall: 'Hello' },
        {
          parser: 0,
          method: 'push',
          chunk: ' world',
          contentAtCall: 'Hello world',
        },
        { parser: 0, method: 'finish', contentAtCall: 'Hello world' },
      ]);
      expect(component().root()).toEqual(expectedRoot(document));
    });

    it('complete -> identical complete is an idempotent no-op', () => {
      const { component, transition, trace } = setup(policy);
      const document = complete('Hello');
      transition(document);
      const root = component().root();
      const calls = [...trace.calls];

      transition({ ...document });

      expect(trace.parsers).toHaveLength(1);
      expect(trace.calls).toEqual(calls);
      expect(component().root()).toBe(root);
      expect(
        trace.calls.filter((call) => call.method === 'finish')
      ).toHaveLength(1);
    });

    it('streaming -> identical streaming is an exact snapshot no-op', () => {
      const { component, transition, trace } = setup(policy);
      const document = streaming('Hello');
      transition(document);
      const root = component().root();
      const calls = [...trace.calls];
      const rootReads = [...trace.rootReads];

      transition({ ...document });

      expect(trace.calls).toEqual(calls);
      expect(trace.rootReads).toEqual(rootReads);
      expect(component().root()).toBe(root);
    });

    it('new generation -> streaming replaces the parser and processes the full snapshot', () => {
      const { component, transition, trace } = setup(policy);
      transition(streaming('Old content', 'old'));

      const document = streaming('New', 'new');
      transition(document);

      expect(trace.parsers).toHaveLength(2);
      expect(trace.calls).toEqual([
        {
          parser: 0,
          method: 'push',
          chunk: 'Old content',
          contentAtCall: 'Old content',
        },
        { parser: 1, method: 'push', chunk: 'New', contentAtCall: 'New' },
      ]);
      expect(component().root()).toEqual(expectedRoot(document));
    });

    it('new generation -> complete replaces the parser, pushes full content, and finishes once', () => {
      const { component, transition, trace } = setup(policy);
      transition(complete('Old content', 'old'));

      const document = complete('New', 'new');
      transition(document);

      expect(trace.parsers).toHaveLength(2);
      expect(trace.calls).toEqual([
        {
          parser: 0,
          method: 'push',
          chunk: 'Old content',
          contentAtCall: 'Old content',
        },
        { parser: 0, method: 'finish', contentAtCall: 'Old content' },
        { parser: 1, method: 'push', chunk: 'New', contentAtCall: 'New' },
        { parser: 1, method: 'finish', contentAtCall: 'New' },
      ]);
      expect(component().root()).toEqual(expectedRoot(document));
    });
  }
);

interface InvalidTransition {
  readonly name: string;
  readonly prior: StreamingMarkdownDocument;
  readonly supplied: StreamingMarkdownDocument;
  readonly expectedReason:
    | 'complete-to-streaming'
    | 'post-completion-content-mutation'
    | 'content-shrink'
    | 'content-divergence';
}

const invalidTransitions: InvalidTransition[] = [
  {
    name: 'complete -> streaming in the same generation',
    prior: complete('Complete'),
    supplied: streaming('Complete'),
    expectedReason: 'complete-to-streaming',
  },
  {
    name: 'complete -> changed complete in the same generation',
    prior: complete('Complete'),
    supplied: complete('Changed'),
    expectedReason: 'post-completion-content-mutation',
  },
  {
    name: 'streaming -> streaming with shrinking content',
    prior: streaming('Long content'),
    supplied: streaming('Long'),
    expectedReason: 'content-shrink',
  },
  {
    name: 'streaming -> complete with shrinking content',
    prior: streaming('Long content'),
    supplied: complete('Long'),
    expectedReason: 'content-shrink',
  },
  {
    name: 'streaming -> streaming with divergent content',
    prior: streaming('Prefix one'),
    supplied: streaming('Different text'),
    expectedReason: 'content-divergence',
  },
  {
    name: 'streaming -> complete with divergent content',
    prior: streaming('Prefix one'),
    supplied: complete('Different text'),
    expectedReason: 'content-divergence',
  },
];

describe.each(invalidTransitions)(
  'contract violation: $name',
  ({ prior, supplied, expectedReason }) => {
    beforeEach(() => TestBed.resetTestingModule());

    it('throw policy reports the violation and preserves the prior parser and snapshot', () => {
      const { fixture, transition, trace } = setup('throw');
      transition(prior);
      const calls = [...trace.calls];
      const priorText = textContent(fixture);

      expect(() => transition(supplied)).toThrowError(
        new RegExp(
          `Streaming markdown document contract violation: ${expectedReason};.*to ${supplied.phase}`
        )
      );
      expect(trace.parsers).toHaveLength(1);
      expect(trace.calls).toEqual(calls);

      transition(prior);
      expect(trace.parsers).toHaveLength(1);
      expect(trace.calls).toEqual(calls);
      expect(textContent(fixture)).toBe(priorText);
    });

    it('rebuild policy replaces the parser and exactly materializes the supplied snapshot', () => {
      const { component, transition, trace } = setup('rebuild');
      transition(prior);
      const callCount = trace.calls.length;

      transition(supplied);

      expect(trace.parsers).toHaveLength(2);
      expect(trace.calls.slice(callCount)).toEqual([
        {
          parser: 1,
          method: 'push',
          chunk: supplied.content,
          contentAtCall: supplied.content,
        },
        ...(supplied.phase === 'complete'
          ? [
              {
                parser: 1,
                method: 'finish' as const,
                contentAtCall: supplied.content,
              },
            ]
          : []),
      ]);
      expect(component().root()).toEqual(expectedRoot(supplied));
    });
  }
);
