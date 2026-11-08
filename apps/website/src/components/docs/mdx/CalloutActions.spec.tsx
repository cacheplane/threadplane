// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CalloutAction, CalloutActions } from './CalloutActions';

describe('CalloutAction', () => {
  it('sends absolute hrefs off-site safely', () => {
    render(
      <CalloutAction href="https://ag-ui.threadplane.ai">
        Run the AG-UI demo
      </CalloutAction>
    );

    const link = screen.getByRole('link', { name: 'Run the AG-UI demo' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('keeps in-site hrefs in the same tab', () => {
    render(<CalloutAction href="/docs/angular/ag-ui/getting-started/quickstart">Quick Start</CalloutAction>);

    const link = screen.getByRole('link', { name: 'Quick Start' });
    expect(link.getAttribute('target')).toBeNull();
    expect(link.getAttribute('rel')).toBeNull();
  });

  it('treats a protocol-relative href as external', () => {
    render(<CalloutAction href="//example.com">Off-site</CalloutAction>);

    const link = screen.getByRole('link', { name: 'Off-site' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('treats a mailto href as external', () => {
    render(<CalloutAction href="mailto:someone@example.com">Email us</CalloutAction>);

    const link = screen.getByRole('link', { name: 'Email us' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('keeps a same-document hash href in the same tab', () => {
    render(<CalloutAction href="#section">Jump down</CalloutAction>);

    const link = screen.getByRole('link', { name: 'Jump down' });
    expect(link.getAttribute('target')).toBeNull();
    expect(link.getAttribute('rel')).toBeNull();
  });

  it('defaults to the primary variant and opts out of the prose link rule', () => {
    render(<CalloutAction href="/docs">Docs</CalloutAction>);

    const link = screen.getByRole('link', { name: 'Docs' });
    expect(link.getAttribute('data-variant')).toBe('primary');
    // Without this the .docs-prose underline would corrupt the button.
    expect(link.hasAttribute('data-mdx-chrome')).toBe(true);
  });

  it('honours an explicit secondary variant', () => {
    render(
      <CalloutAction href="https://demo.threadplane.ai" variant="secondary">
        LangGraph demo
      </CalloutAction>
    );

    expect(
      screen.getByRole('link', { name: 'LangGraph demo' }).getAttribute('data-variant')
    ).toBe('secondary');
  });
});

describe('CalloutActions', () => {
  it('groups its actions in one row', () => {
    const { container } = render(
      <CalloutActions>
        <CalloutAction href="https://ag-ui.threadplane.ai">Run</CalloutAction>
        <CalloutAction href="https://demo.threadplane.ai" variant="secondary">
          Compare
        </CalloutAction>
      </CalloutActions>
    );

    const row = container.querySelector('[data-mdx="callout-actions"]');
    expect(row).toBeTruthy();
    expect(within(row as HTMLElement).getAllByRole('link')).toHaveLength(2);
  });
});
