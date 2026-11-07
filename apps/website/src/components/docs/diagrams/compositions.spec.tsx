// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { AgUiArchitecturePipeline } from './AgUiArchitecturePipeline';
import { A2uiMessageFlow } from './A2uiMessageFlow';
import { RenderHowItFits } from './RenderHowItFits';
import { RenderVsA2ui } from './RenderVsA2ui';
import { RenderTransform } from './RenderTransform';
import { MiddlewareHowItFits } from './MiddlewareHowItFits';
import { TelemetryHowItFits } from './TelemetryHowItFits';
import { PilotJourney } from './PilotJourney';

/**
 * Compositions are hand-placed layouts; the spec guards that each mounts,
 * is labeled for screen readers, and names its load-bearing packages.
 * Later tasks append one describe block per composition.
 */
describe('AgUiArchitecturePipeline', () => {
  it('mounts with an accessible label and the pipeline stages', () => {
    const { container } = render(<AgUiArchitecturePipeline />);
    expect(container.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toBeTruthy();
    const titles = Array.from(container.querySelectorAll('.tp-network-title')).map((t) => t.textContent);
    expect(titles).toContain('@threadplane/ag-ui');
    expect(container.textContent).toContain('AbstractAgent');
  });
});

describe('A2uiMessageFlow', () => {
  it('mounts and names the parser and surface store stages', () => {
    const { container } = render(<A2uiMessageFlow />);
    expect(container.querySelector('svg[role="img"]')).not.toBeNull();
    const titles = Array.from(container.querySelectorAll('.tp-diagram-title')).map((t) => t.textContent);
    expect(titles).toContain('createA2uiMessageParser()');
    expect(titles).toContain('createA2uiSurfaceStore()');
  });

  it('accents only the a2ui-owned parser stage', () => {
    const { container } = render(<A2uiMessageFlow />);
    const accented = Array.from(container.querySelectorAll('g.tp-diagram-node[data-tone="accent"]'));
    expect(accented).toHaveLength(1);
    expect(accented[0]?.querySelector('.tp-diagram-eyebrow')?.textContent).toBe('@THREADPLANE/A2UI');
    expect(accented[0]?.querySelector('.tp-diagram-title')?.textContent).toBe('createA2uiMessageParser()');
  });
});

describe('RenderHowItFits', () => {
  it('mounts and shows the spec-to-components pipeline', () => {
    const { container } = render(<RenderHowItFits />);
    const titles = Array.from(container.querySelectorAll('.tp-diagram-title')).map((t) => t.textContent);
    expect(titles).toContain('@threadplane/render');
  });

  it('breaks each edge around its pill so the line does not show through the label', () => {
    const { container } = render(<RenderHowItFits />);
    expect(container.querySelectorAll('.tp-diagram-pill')).toHaveLength(2);
    expect(container.querySelectorAll('path.tp-diagram-edge')).toHaveLength(4);
  });
});

describe('RenderVsA2ui', () => {
  it('mounts and shows both packages under chat', () => {
    const { container } = render(<RenderVsA2ui />);
    const titles = Array.from(container.querySelectorAll('.tp-diagram-title')).map((t) => t.textContent);
    expect(titles).toContain('@threadplane/render');
    expect(titles).toContain('@threadplane/a2ui');
    expect(titles).toContain('@threadplane/chat');
  });

  it('accents exactly the two surface nodes and wires exactly four edges', () => {
    const { container } = render(<RenderVsA2ui />);
    const accented = container.querySelectorAll('g.tp-diagram-node[data-tone="accent"]');
    expect(accented).toHaveLength(2);
    const edges = container.querySelectorAll('path.tp-diagram-edge');
    expect(edges).toHaveLength(4);
    const titles = Array.from(container.querySelectorAll('.tp-diagram-title')).map((t) => t.textContent);
    expect(titles).toContain('Your Angular app');
  });
});

describe('MiddlewareHowItFits', () => {
  it('mounts and places the middleware between frontend and graph', () => {
    const { container } = render(<MiddlewareHowItFits />);
    const titles = Array.from(container.querySelectorAll('.tp-diagram-title')).map((t) => t.textContent);
    expect(titles).toContain('@threadplane/chat');
    expect(titles).toContain('threadplane-middleware');
    expect(titles).toContain('Your LangGraph graph');
  });

  it('breaks the single edge around its pill and wires exactly three edges', () => {
    const { container } = render(<MiddlewareHowItFits />);
    expect(container.querySelectorAll('.tp-diagram-pill')).toHaveLength(1);
    expect(container.querySelectorAll('path.tp-diagram-edge')).toHaveLength(3);
  });
});

describe('TelemetryHowItFits', () => {
  it('mounts and names the package and both honest destinations', () => {
    const { container } = render(<TelemetryHowItFits />);
    const titles = Array.from(container.querySelectorAll('.tp-diagram-title')).map((t) => t.textContent);
    expect(titles).toContain('@threadplane/telemetry');
    expect(titles).toContain('Your sink or endpoint — app-owned');
    expect(titles).toContain('threadplane.ai/api/ingest — default');
  });

  it('breaks each branch around its pill and wires exactly five edges', () => {
    const { container } = render(<TelemetryHowItFits />);
    expect(container.querySelectorAll('.tp-diagram-pill')).toHaveLength(2);
    expect(container.querySelectorAll('path.tp-diagram-edge')).toHaveLength(5);
  });
});

describe('RenderTransform', () => {
  it('mounts at standard scale with spec, render, and result stages', () => {
    const { container } = render(<RenderTransform />);
    const titles = Array.from(container.querySelectorAll('.tp-diagram-title')).map((t) => t.textContent);
    expect(titles).toContain('@threadplane/render');
    expect(container.querySelectorAll('.tp-diagram-pill')).toHaveLength(2);
  });

  it('names the spec fragment, the transport pills, and the payoff node', () => {
    const { container } = render(<RenderTransform />);
    const titles = Array.from(container.querySelectorAll('.tp-diagram-title')).map((t) => t.textContent);
    expect(titles).toContain("type: 'Text'");
    expect(titles).toContain('your components');
    const pills = Array.from(container.querySelectorAll('.tp-diagram-pill text')).map((t) => t.textContent);
    expect(pills).toEqual(['UI spec', 'bindings + events']);
  });

  it('accents only the payoff node', () => {
    const { container } = render(<RenderTransform />);
    const accented = container.querySelectorAll('g.tp-diagram-node[data-tone="accent"]');
    expect(accented).toHaveLength(1);
    expect(accented[0]?.querySelector('.tp-diagram-title')?.textContent).toBe('your components');
  });
});

describe('PilotJourney', () => {
  it('mounts with three phase nodes on the journey line', () => {
    const { container } = render(<PilotJourney />);
    expect(container.querySelectorAll('g.tp-diagram-node')).toHaveLength(3);
    expect(container.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toBeTruthy();
  });

  it('names the three phases and their gate pills', () => {
    const { container } = render(<PilotJourney />);
    const titles = Array.from(container.querySelectorAll('.tp-diagram-title')).map((t) => t.textContent);
    expect(titles).toEqual(['Discover', 'Build', 'Harden']);
    const pills = Array.from(container.querySelectorAll('.tp-diagram-pill text')).map((t) => t.textContent);
    expect(pills).toEqual(['roadmap', 'working agent', 'handoff']);
    const neutralPills = container.querySelectorAll('.tp-diagram-pill[data-tone="neutral"]');
    expect(neutralPills).toHaveLength(3);
  });

  it('accents only the Harden node — the production-ready system the customer keeps', () => {
    const { container } = render(<PilotJourney />);
    const accented = container.querySelectorAll('g.tp-diagram-node[data-tone="accent"]');
    expect(accented).toHaveLength(1);
    expect(accented[0]?.querySelector('.tp-diagram-title')?.textContent).toBe('Harden');
  });
});
