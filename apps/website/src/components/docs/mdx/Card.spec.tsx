// @vitest-environment jsdom
import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Card } from './Card';

describe('Card', () => {
  it('keeps description links outside the primary card link', () => {
    const { container, getByRole } = render(
      <Card title="Going to production" href="/installation">
        Read <a href="/installation">Installation</a> and <a href="/deployment">Agent deployment</a>.
      </Card>
    );
    expect(container.querySelector('a a')).toBeNull();
    expect(getByRole('link', { name: /Going to production/ }).getAttribute('href')).toBe('/installation');
    expect(getByRole('link', { name: 'Agent deployment' }).getAttribute('href')).toBe('/deployment');
  });

  it('preserves external navigation on the primary link', () => {
    const { getByRole } = render(<Card title="Demo" href="https://example.com" external>Try it</Card>);
    const link = getByRole('link', { name: /Demo/ });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
