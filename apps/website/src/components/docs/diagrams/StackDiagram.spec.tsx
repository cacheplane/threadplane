// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { StackDiagram } from './StackDiagram';

function toneOf(container: HTMLElement, title: string): string | null {
  const titles = Array.from(container.querySelectorAll('.tp-diagram-title'));
  const t = titles.find((el) => el.textContent === title);
  return t?.closest('g.tp-diagram-node')?.getAttribute('data-tone') ?? null;
}

describe('StackDiagram', () => {
  it('renders the canonical five-node stack', () => {
    const { container } = render(<StackDiagram />);
    const titles = Array.from(container.querySelectorAll('.tp-diagram-title')).map((t) => t.textContent);
    expect(titles).toContain('@threadplane/angular/chat');
    expect(titles).toContain('@threadplane/langgraph');
    expect(titles).toContain('@threadplane/ag-ui');
    const eyebrows = Array.from(container.querySelectorAll('.tp-diagram-eyebrow')).map((t) => t.textContent);
    expect(eyebrows).toEqual(['CHAT UI', 'SESSION', 'SESSION']);
    expect(container.querySelector('.tp-diagram-pill text')?.textContent).toBe('Agent · signals over an AgentSession');
  });

  it.each([
    ['ag-ui', '@threadplane/ag-ui'],
    ['langgraph', '@threadplane/langgraph'],
    ['chat', '@threadplane/angular/chat'],
  ] as const)('highlight=%s accents that node', (highlight, title) => {
    const { container } = render(<StackDiagram highlight={highlight} />);
    expect(toneOf(container, title)).toBe('accent');
  });

  it('highlight=runtimes accents the backend row', () => {
    const { container } = render(<StackDiagram highlight="runtimes" />);
    expect(toneOf(container, 'LangGraph Platform')).toBe('accent');
    expect(toneOf(container, 'CrewAI · Mastra · Agent Fwk · Strands · …')).toBe('accent');
  });

  it('highlight=contract accents both session packages', () => {
    const { container } = render(<StackDiagram highlight="contract" />);
    expect(toneOf(container, '@threadplane/langgraph')).toBe('accent');
    expect(toneOf(container, '@threadplane/ag-ui')).toBe('accent');
  });

  it('highlight=chat leaves both session packages neutral', () => {
    const { container } = render(<StackDiagram highlight="chat" />);
    expect(toneOf(container, '@threadplane/langgraph')).toBe('neutral');
    expect(toneOf(container, '@threadplane/ag-ui')).toBe('neutral');
  });

  it('highlight default (none) accents nothing', () => {
    const { container } = render(<StackDiagram />);
    expect(container.querySelectorAll('g.tp-diagram-node[data-tone="accent"]').length).toBe(0);
  });

  it('renders a caption when given', () => {
    const { getByText } = render(<StackDiagram caption="the caption" />);
    expect(getByText('the caption')).not.toBeNull();
  });
});
