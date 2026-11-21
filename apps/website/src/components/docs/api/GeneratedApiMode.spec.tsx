// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GeneratedApiMode } from './GeneratedApiMode';

afterEach(cleanup);

describe('generated API mode', () => {
  it('uses the Angular document’s extracted package declarations', () => {
    render(
      GeneratedApiMode({ docsPath: '/docs/angular/ag-ui/guides/interrupts' })
    );
    // The backend package is framework-neutral, so the Angular page lists it
    // together with the Angular binding that observes its session.
    expect(
      screen.getByRole('link', { name: 'createSession' }).getAttribute('href')
    ).toBe('/docs/api/ag-ui/createSession');
    expect(
      screen.getByRole('link', { name: 'injectAgent' }).getAttribute('href')
    ).toBe('/docs/api/angular/injectAgent');
    expect(
      screen.getByRole('link', { name: 'provideFakeAgent' }).getAttribute('href')
    ).toBe('/docs/api/angular/testing/provideFakeAgent');
    expect(screen.queryByRole('link', { name: 'useAgent' })).toBeNull();
    expect(screen.queryByText('InterruptsComponent')).toBeNull();
  });

  it('keeps React package identities separate', () => {
    render(
      GeneratedApiMode({ docsPath: '/docs/react/ag-ui/guides/interrupts' })
    );
    expect(
      screen.getByRole('link', { name: 'useAgent' }).getAttribute('href')
    ).toBe('/docs/api/react/useAgent');
    expect(
      screen.getByRole('link', { name: 'createSession' }).getAttribute('href')
    ).toBe('/docs/api/ag-ui/createSession');
    expect(screen.queryByRole('link', { name: 'injectAgent' })).toBeNull();
  });

  it('falls back to the package index when a page has no library', () => {
    render(GeneratedApiMode({ docsPath: '/docs/examples' }));
    expect(
      screen.getByRole('link', { name: '@threadplane/ag-ui' })
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: '@threadplane/react' })
    ).toBeTruthy();
  });
});
