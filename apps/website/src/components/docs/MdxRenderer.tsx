import { Suspense } from 'react';
import { MDXRemote } from 'next-mdx-remote/rsc';
import { Callout } from './mdx/Callout';
import { CalloutAction, CalloutActions } from './mdx/CalloutActions';
import { Steps, Step } from './mdx/Steps';
import { Tabs, Tab } from './mdx/Tabs';
import { Card, CardGroup } from './mdx/Card';
import { CodeGroup } from './mdx/CodeGroup';
import { Pre } from './mdx/CodeBlock';
import { FeatureChips } from './mdx/FeatureChips';
import { mdxHeadingComponents } from './mdx/headings';
import { ArchFlowDiagram } from './ArchFlowDiagram';
import {
  StackDiagram,
  AgUiArchitecturePipeline,
  A2uiMessageFlow,
  RenderHowItFits,
  RenderVsA2ui,
  MiddlewareHowItFits,
  TelemetryHowItFits,
} from './diagrams';
import { mdxCompileOptions } from './mdx-options';
import { createExampleCode } from './mdx/ExampleCode';
import { StreamedFragmentScroll } from './StreamedFragmentScroll';
import type { ExampleCodeContext } from '../../lib/example-code';

/**
 * Intrinsic size of each SVG diagram in `public/blog/diagrams`.
 *
 * Markdown image syntax carries no dimensions and MDX gives us no build step
 * that could measure the file, so the sizes live here. They only need to be
 * right enough to reserve the correct box before the file loads; the rendered
 * size comes from the SVG itself.
 */
const DIAGRAM_DIMENSIONS: Record<string, { width: number; height: number }> = {
  '/blog/diagrams/ag-ui-event-flow.svg': { width: 700, height: 690 },
  '/blog/diagrams/langgraph-threads-and-runs.svg': { width: 700, height: 560 },
  '/blog/diagrams/agent-contract-boundary.svg': { width: 700, height: 700 },
};

const mdxComponents = {
  Callout,
  CalloutActions,
  CalloutAction,
  Steps,
  Step,
  Tabs,
  Tab,
  Card,
  CardGroup,
  CodeGroup,
  ArchFlowDiagram,
  StackDiagram,
  AgUiArchitecturePipeline,
  A2uiMessageFlow,
  RenderHowItFits,
  RenderVsA2ui,
  MiddlewareHowItFits,
  TelemetryHowItFits,
  FeatureChips,
  pre: Pre,
  // Explicit width/height let the browser reserve the box before the file
  // loads, which keeps layout shift at zero. Presentation stays in global.css
  // so it cannot silently override the shared bare-image rule, and so an
  // author-supplied `style` on a future image still wins.
  img: ({ width, height, alt, src, className, ...rest }: React.ImgHTMLAttributes<HTMLImageElement>) => {
    const diagram = typeof src === 'string' ? DIAGRAM_DIMENSIONS[src] : undefined;
    return (
      <img
        {...rest}
        src={src}
        alt={alt ?? ''}
        width={width ?? diagram?.width}
        height={height ?? diagram?.height}
        className={[className, diagram ? 'docs-diagram' : undefined].filter(Boolean).join(' ') || undefined}
        loading="lazy"
        decoding="async"
      />
    );
  },
  table: ({ children, ...rest }: React.HTMLAttributes<HTMLTableElement>) => (
    // tabIndex + role: a scrollable region must be keyboard-reachable
    // (WCAG 2.1.1) — without it, keyboard users can never see the clipped
    // columns the scroller hides.
    <div className="docs-table-scroll" tabIndex={0} role="region" aria-label="Table, scrolls horizontally">
      <table {...rest}>{children}</table>
    </div>
  ),
  ...mdxHeadingComponents,
};

interface MdxRendererProps {
  source: string;
  /** Present on docs pages that embed a runnable example; null elsewhere. */
  exampleCode?: ExampleCodeContext | null;
  /** Route of the page being rendered, so a docs-only failure can name it. */
  docsPath?: string;
}

export function MdxRenderer({
  source,
  exampleCode = null,
  docsPath,
}: MdxRendererProps) {
  const content = (
    <MDXRemote
      source={source}
      components={{
        ...mdxComponents,
        ExampleCode: createExampleCode(exampleCode, docsPath),
      }}
      options={mdxCompileOptions}
    />
  );

  // Development only: works around a React hydration bug (react/react#37584).
  // Flight splits a large element, such as a highlighted <code>, into deferred
  // rows, and `next dev` streams them while React is already hydrating. A host
  // element that suspends on one after claiming its DOM node is replayed
  // without rewinding the hydration cursor, so it is claimed against its own
  // first child and hydration fails on an identical tree. Inside a boundary
  // the suspension unwinds and the boundary retries from its own start.
  //
  // The boundary makes the article stream after the shell, so a fragment
  // scroll on a hard load can miss its heading; `StreamedFragmentScroll`
  // re-applies it. Production keeps the article inline: its prerender ships
  // every row before hydration starts, so the bug does not occur there.
  return (
    <div className="docs-prose">
      {process.env.NODE_ENV === 'development' ? (
        <Suspense>
          {content}
          <StreamedFragmentScroll />
        </Suspense>
      ) : (
        content
      )}
    </div>
  );
}
