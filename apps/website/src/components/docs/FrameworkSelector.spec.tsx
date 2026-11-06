import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FrameworkSelector } from './FrameworkSelector';
import { FrameworkDocsLink } from './FrameworkDocsLink';
import { FRAMEWORK_PREFERENCE_KEY, frameworkPreference } from '../../lib/framework-preference';

const state = vi.hoisted(() => ({ pathname: '/docs/angular/langgraph/guides/streaming', push: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => state.pathname, useRouter: () => ({ push: state.push }) }));
const targets = {
  angular: { href: '/docs/angular/langgraph/guides/streaming', modes: ['Docs', 'Run'] as const, anchors: ['ownership'] },
  react: { href: '/docs/react/langgraph/guides/streaming', modes: ['Docs', 'Code'] as const, anchors: ['ownership'] },
};

beforeEach(() => {
  state.pathname = targets.angular.href;
  state.push.mockReset();
  window.history.replaceState(null, '', targets.angular.href);
  frameworkPreference.setPreference('angular');
});

describe('FrameworkSelector', () => {
  it('uses the URL over stored preference and persists framework-route visits', () => {
    frameworkPreference.setPreference('react');
    render(<FrameworkSelector documentId="langgraph/guides/streaming" targets={targets} />);
    expect((screen.getByRole('combobox', { name: 'Framework' }) as HTMLSelectElement).value).toBe('angular');
    expect(localStorage.getItem(FRAMEWORK_PREFERENCE_KEY)).toBe('angular');
  });

  it('renders a direct React route as React even when Angular is preferred', () => {
    state.pathname = targets.react.href;
    render(<FrameworkSelector documentId="langgraph/guides/streaming" targets={targets} />);
    expect((screen.getByRole('combobox', { name: 'Framework' }) as HTMLSelectElement).value).toBe('react');
    expect(localStorage.getItem(FRAMEWORK_PREFERENCE_KEY)).toBe('react');
  });

  it('disables selection while the router transition is suspended', async () => {
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    function Destination({ pending }: { pending: boolean }) {
      if (pending) React.use(blocked);
      return <span>Destination ready</span>;
    }
    function Harness() {
      const [pending, setPending] = React.useState(false);
      state.push.mockImplementation(() => setPending(true));
      return <React.Suspense fallback={<span>Loading</span>}>
        <FrameworkSelector scope="angular" documentId="langgraph/guides/streaming" targets={targets} />
        <Destination pending={pending} />
      </React.Suspense>;
    }
    render(<Harness />);
    const control = screen.getByRole('combobox', { name: 'Framework' }) as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(control, { target: { value: 'react' } });
    });
    expect(control.disabled).toBe(true);
    await act(async () => { release(); await blocked; });
    await waitFor(() => expect(control.disabled).toBe(false));
  });

  it('honors pending navigation owned outside a remounted selector', () => {
    const navigateTo = vi.fn();
    const view = render(<FrameworkSelector scope="angular" navigationPending navigateTo={navigateTo} documentId="langgraph/guides/streaming" targets={targets} />);
    const control = screen.getByRole('combobox', { name: 'Framework' }) as HTMLSelectElement;
    expect(control.disabled).toBe(true);
    fireEvent.change(control, { target: { value: 'react' } });
    expect(navigateTo).not.toHaveBeenCalled();
    view.rerender(<FrameworkSelector scope="angular" navigationPending={false} navigateTo={navigateTo} documentId="langgraph/guides/streaming" targets={targets} />);
    fireEvent.change(control, { target: { value: 'react' } });
    expect(navigateTo).toHaveBeenCalledWith(targets.react.href);
    expect(state.push).not.toHaveBeenCalled();
  });

  it('blocks a second selection until the registered document catches up with the URL', () => {
    const view = render(<FrameworkSelector scope="react" documentId="langgraph/guides/streaming" targets={targets} />);
    const control = screen.getByRole('combobox', { name: 'Framework' }) as HTMLSelectElement;
    expect(control.disabled).toBe(true);
    fireEvent.change(control, { target: { value: 'react' } });
    expect(state.push).not.toHaveBeenCalled();
    view.rerender(<FrameworkSelector scope="angular" documentId="langgraph/guides/streaming" targets={targets} />);
    expect(control.disabled).toBe(false);
    fireEvent.change(control, { target: { value: 'react' } });
    expect(state.push).toHaveBeenCalledWith(targets.react.href);
  });

  it('enhances neutral documentation links after local and cross-tab preference changes', () => {
    state.pathname = '/';
    render(<><FrameworkSelector /><FrameworkDocsLink>Get started</FrameworkDocsLink></>);
    const link = screen.getByRole('link', { name: 'Get started' });
    expect(link.getAttribute('href')).toBe('/docs/angular/getting-started/introduction');
    fireEvent.change(screen.getByRole('combobox', { name: 'Framework' }), { target: { value: 'react' } });
    expect(link.getAttribute('href')).toBe('/docs/react/getting-started/introduction');
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: FRAMEWORK_PREFERENCE_KEY, newValue: 'angular' })));
    expect(link.getAttribute('href')).toBe('/docs/angular/getting-started/introduction');
    expect(state.push).not.toHaveBeenCalled();
  });

  it('switches the same topic preserving only supported modes and target anchors', () => {
    window.history.replaceState(null, '', `${targets.angular.href}?mode=code&frontend=angular&thread=secret#ownership`);
    render(<FrameworkSelector documentId="langgraph/guides/streaming" targets={targets} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Framework' }), { target: { value: 'react' } });
    expect(state.push).toHaveBeenCalledWith(`${targets.react.href}?mode=code#ownership`);
    expect(frameworkPreference.getSnapshot()).toBe('react');
  });

  it('drops unavailable modes and missing fragments rather than carrying state to another runtime', () => {
    window.history.replaceState(null, '', `${targets.angular.href}?mode=run#missing`);
    render(<FrameworkSelector documentId="langgraph/guides/streaming" targets={targets} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Framework' }), { target: { value: 'react' } });
    expect(state.push).toHaveBeenCalledWith(targets.react.href);
  });

  it('shows a missing counterpart as unavailable with a separate introduction link', () => {
    render(<FrameworkSelector documentId="langgraph/guides/streaming" targets={{ angular: targets.angular }} />);
    expect((screen.getByRole('option', { name: 'React (unavailable)' }) as HTMLOptionElement).disabled).toBe(true);
    expect(screen.getByText('This topic is not available for React.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'React introduction' }).getAttribute('href')).toBe('/docs/react/getting-started/introduction');
    fireEvent.change(screen.getByRole('combobox', { name: 'Framework' }), { target: { value: 'react' } });
    expect(state.push).not.toHaveBeenCalled();
  });

  it('does not navigate the current article when another tab changes preference', () => {
    render(<FrameworkSelector documentId="langgraph/guides/streaming" targets={targets} />);
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: FRAMEWORK_PREFERENCE_KEY, newValue: 'react' })));
    expect((screen.getByRole('combobox', { name: 'Framework' }) as HTMLSelectElement).value).toBe('angular');
    expect(state.push).not.toHaveBeenCalled();
  });

  it.each(['/docs/shared/middleware/getting-started/introduction', '/docs/api/react/useAgent'])('keeps shared/API route identity while changing guide preference on %s', pathname => {
    state.pathname = pathname;
    render(<FrameworkSelector scope="shared" />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Framework' }), { target: { value: 'react' } });
    expect(frameworkPreference.getSnapshot()).toBe('react');
    expect(state.push).not.toHaveBeenCalled();
    expect(screen.queryByText(/This topic is not available/)).toBeNull();
  });
});
