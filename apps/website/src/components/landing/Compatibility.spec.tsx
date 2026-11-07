import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Compatibility } from './Compatibility';
import { PROVIDERS } from '../../lib/airport-diagram';

describe('Compatibility', () => {
  it('offers both adapters and framework quickstarts', () => {
    render(<Compatibility />);
    expect(screen.getByRole('region', { name: 'Bring your stack.' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Explore LangGraph' }).getAttribute('href')).toBe('/langgraph');
    expect(screen.getByRole('link', { name: 'Explore AG-UI' }).getAttribute('href')).toBe('/ag-ui');
    expect(screen.getByRole('link', { name: 'React quickstart' }).getAttribute('href')).toBe('/docs/react/getting-started/quickstart');
    expect(screen.getByRole('link', { name: 'Angular quickstart' }).getAttribute('href')).toBe('/docs/langgraph/getting-started/quickstart');
  });
  it('names runtimes accessibly and locates model selection in the backend', () => {
    render(<Compatibility />);
    const runtimes = screen.getByRole('list', { name: 'AG-UI-compatible runtimes' });
    expect(within(runtimes).getAllByRole('listitem')).toHaveLength(5);
    expect(within(runtimes).getByText('Microsoft Agent Framework')).toBeTruthy();
    const providers = screen.getByRole('list', { name: 'Model providers available through your backend' });
    for (const provider of PROVIDERS) expect(within(providers).getByText(provider.name)).toBeTruthy();
    expect(screen.getByText('Choose the model provider in your agent backend.')).toBeTruthy();
  });
  it('keeps the tracked adapter guide and avoids endorsement claims', () => {
    const { container } = render(<Compatibility />);
    expect(container.querySelectorAll('[data-cta="home_adapter_guide"]')).toHaveLength(1);
    expect(container.textContent).not.toMatch(/trusted by|customers|our clients|never sees/i);
    expect(container.querySelector('[data-diagram="airport"]')).toBeNull();
  });
});
