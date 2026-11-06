import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { MDXRemote } from 'next-mdx-remote/rsc';
import {
  ExampleCodeError,
  type ExampleCodeContext,
} from '../../../lib/example-code';
import { createExampleCode } from './ExampleCode';
import { mdxCompileOptions } from '../mdx-options';

const context: ExampleCodeContext = {
  docsPath: '/docs/angular/langgraph/guides/streaming',
  assetPaths: [
    'cockpit/langgraph/streaming/angular/src/app/streaming.component.ts',
  ],
  sources: {
    'cockpit/langgraph/streaming/angular/src/app/streaming.component.ts': [
      'class StreamingComponent {',
      '  // #region send',
      '  send(text: string) {}',
      '  // #endregion',
      '}',
    ].join('\n'),
  },
};

function findMdx(
  node: ReactNode
): ReactElement<{
  source: string;
  components: object;
  options?: unknown;
}> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findMdx(child);
      if (found) return found;
    }
    return null;
  }
  if (
    !isValidElement<{
      source: string;
      components: object;
      children?: ReactNode;
    }>(node)
  )
    return null;
  if (node.type === MDXRemote) return node;
  return findMdx(node.props.children);
}

function findTitle(
  node: ReactNode
): ReactElement<{ className: string; children?: ReactNode }> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findTitle(child);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement<{ className?: string; children?: ReactNode }>(node))
    return null;
  if (node.props.className === 'mdx-example-code-title')
    return node as ReactElement<{ className: string; children?: ReactNode }>;
  return findTitle(node.props.children);
}

describe('ExampleCode', () => {
  it('renders the whole file as a fence through MDXRemote with the file title', () => {
    const ExampleCode = createExampleCode(context);
    const element = ExampleCode({ file: 'streaming.component.ts' });
    const mdx = findMdx(element);

    expect(element.props['data-example-file']).toBe(
      'cockpit/langgraph/streaming/angular/src/app/streaming.component.ts'
    );
    expect(mdx?.props.source).toBe(
      '```ts\n' +
        context.sources[
          'cockpit/langgraph/streaming/angular/src/app/streaming.component.ts'
        ] +
        '\n```'
    );
    expect(Object.keys(mdx?.props.components ?? {})).toEqual(['pre']);
    expect(mdx?.props.options).toBe(mdxCompileOptions);
    expect(findTitle(element)?.props.children).toBe('streaming.component.ts');
    expect(element.props['aria-label']).toBe('streaming.component.ts');
  });

  it('renders a region and records it on the wrapper', () => {
    const ExampleCode = createExampleCode(context);
    const element = ExampleCode({
      file: 'streaming.component.ts',
      region: 'send',
      title: 'send()',
    });

    expect(element.props['data-example-region']).toBe('send');
    expect(findMdx(element)?.props.source).toBe(
      '```ts\nsend(text: string) {}\n```'
    );
    expect(findTitle(element)?.props.children).toBe('send()');
  });

  it('throws on a docs-only page', () => {
    const ExampleCode = createExampleCode(null, '/docs/x');
    expect(() => ExampleCode({ file: 'streaming.component.ts' })).toThrow(
      ExampleCodeError
    );
    expect(() => ExampleCode({ file: 'streaming.component.ts' })).toThrow(
      /mapped example/
    );
    expect(() => ExampleCode({ file: 'streaming.component.ts' })).toThrow(
      /\/docs\/x/
    );
  });

  it('throws on an unknown file', () => {
    const ExampleCode = createExampleCode(context);
    expect(() => ExampleCode({ file: 'nope.ts' })).toThrow(ExampleCodeError);
  });
});
