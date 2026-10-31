// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DiagramFrame } from './DiagramFrame';
import { DiagramNode } from './DiagramNode';
import { DiagramEdge } from './DiagramEdge';
import { DiagramPill } from './DiagramPill';

describe('diagram kit primitives', () => {
  it('lets keyboard readers reach the diagram and open its explanation', () => {
    render(
      <DiagramFrame slug="accessible" viewWidth={640} viewHeight={200}
        label="How a turn reaches the runtime" caption="A request starts a run.">
        <g />
      </DiagramFrame>
    );
    const region = screen.getByRole('region', { name: /How a turn reaches the runtime/ });
    expect(region.tabIndex).toBe(0);
    expect(screen.getByRole('button', { name: 'Expand diagram: How a turn reaches the runtime' })).toBeTruthy();
    const disclosure = screen.getByText('Read diagram description');
    fireEvent.click(disclosure);
    expect(disclosure.closest('details')?.open).toBe(true);
    expect(disclosure.closest('details')?.textContent).toContain('How a turn reaches the runtime');
  });

  it('DiagramFrame renders a labeled svg with dot ground, arrow marker, and caption', () => {
    const { container, getByText } = render(
      <DiagramFrame slug="t" viewWidth={640} viewHeight={200} label="test diagram" caption="a caption">
        <DiagramEdge d="M10 10 H100" slug="t" arrow />
      </DiagramFrame>
    );
    const svg = container.querySelector('svg.tp-diagram-svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 640 200');
    expect(svg?.getAttribute('aria-label')).toBe('test diagram');
    expect(container.querySelector('pattern#t-dots')).not.toBeNull();
    expect(container.querySelector('marker#t-arrow')).not.toBeNull();
    expect(container.querySelector('path.tp-diagram-edge')?.getAttribute('marker-end')).toBe('url(#t-arrow)');
    expect(getByText('a caption').tagName).toBe('FIGCAPTION');
  });

  it('DiagramFrame passes the marketing scale through as a data attribute', () => {
    const { container } = render(
      <DiagramFrame slug="m" viewWidth={640} viewHeight={200} label="x" scale="marketing">
        <g />
      </DiagramFrame>
    );
    expect(container.querySelector('figure')?.getAttribute('data-scale')).toBe('marketing');
  });

  it('DiagramFrame defaults data-scale to docs', () => {
    const { container } = render(
      <DiagramFrame slug="d" viewWidth={640} viewHeight={200} label="x">
        <g />
      </DiagramFrame>
    );
    expect(container.querySelector('figure')?.getAttribute('data-scale')).toBe('docs');
  });

  it('DiagramEdge omits marker-end when arrow is not set', () => {
    const { container } = render(
      <svg>
        <DiagramEdge d="M0 0 H10" />
      </svg>
    );
    expect(container.querySelector('path.tp-diagram-edge')?.getAttribute('marker-end')).toBeNull();
  });

  it('DiagramNode renders eyebrow, title, meta and tone', () => {
    const { container } = render(
      <svg>
        <DiagramNode x={0} y={0} w={200} h={64} eyebrow="Adapter" title="@threadplane/ag-ui" meta="toAgent()" tone="accent" />
      </svg>
    );
    const g = container.querySelector('g.tp-diagram-node');
    expect(g?.getAttribute('data-tone')).toBe('accent');
    expect(g?.querySelector('.tp-diagram-eyebrow')?.textContent).toBe('ADAPTER');
    expect(g?.querySelector('.tp-diagram-title')?.textContent).toBe('@threadplane/ag-ui');
    expect(g?.querySelector('.tp-diagram-meta')?.textContent).toBe('toAgent()');
  });

  it('DiagramNode centers a title-only node when align is middle', () => {
    const { container } = render(
      <svg>
        <DiagramNode x={0} y={0} w={200} h={40} title="LangGraph Platform" align="middle" titleStyle="sans" tone="dim" />
      </svg>
    );
    const title = container.querySelector('.tp-diagram-title');
    expect(title?.getAttribute('text-anchor')).toBe('middle');
    expect(title?.getAttribute('x')).toBe('100');
    expect(container.querySelector('g.tp-diagram-node')?.getAttribute('data-title')).toBe('sans');
  });

  // This runtime assertion is trivially green — 'compact' is a literal in the
  // scale union, so any string reaching here has already type-checked. The
  // real guard is tsc during `nx build` (spec .tsx files are type-checked
  // because tsconfig excludes only `*.spec.ts`, not `*.spec.tsx`) — don't
  // "fix" that tsconfig exclude without replacing this guard.
  it('DiagramFrame accepts the compact scale', () => {
    const { container } = render(
      <DiagramFrame slug="c" viewWidth={320} viewHeight={150} label="x" scale="compact">
        <g />
      </DiagramFrame>
    );
    expect(container.querySelector('figure')?.getAttribute('data-scale')).toBe('compact');
  });

  it('DiagramNode renders a mono meta when metaStyle is mono', () => {
    const { container } = render(
      <svg>
        <DiagramNode x={0} y={0} w={200} h={64} title="spec" meta='{ "component": "Form" }' metaStyle="mono" />
      </svg>
    );
    expect(container.querySelector('g.tp-diagram-node')?.getAttribute('data-meta')).toBe('mono');
  });

  it('DiagramPill renders a centered label', () => {
    const { container } = render(
      <svg>
        <DiagramPill cx={100} cy={50} w={120} label="SSE" />
      </svg>
    );
    const text = container.querySelector('.tp-diagram-pill text');
    expect(text?.textContent).toBe('SSE');
    expect(text?.getAttribute('text-anchor')).toBe('middle');
  });

  it('DiagramPill defaults to accent tone and accepts neutral', () => {
    const { container: defaultContainer } = render(
      <svg>
        <DiagramPill cx={0} cy={0} w={50} label="x" />
      </svg>
    );
    expect(defaultContainer.querySelector('.tp-diagram-pill')?.getAttribute('data-tone')).toBe('accent');

    const { container: neutralContainer } = render(
      <svg>
        <DiagramPill cx={0} cy={0} w={50} label="x" tone="neutral" />
      </svg>
    );
    expect(neutralContainer.querySelector('.tp-diagram-pill')?.getAttribute('data-tone')).toBe('neutral');
  });
});
