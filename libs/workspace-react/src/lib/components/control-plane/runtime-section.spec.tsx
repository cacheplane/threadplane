// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  createRuntimeSnapshot,
  parseRuntimeTarget,
  type RuntimePhase,
  type RuntimeSnapshot,
} from '../../runtime/runtime-state';
import { RuntimeSection } from './runtime-section';
import { getSanitizedRuntimeTargetDisplay } from '../../runtime/runtime-target-session';

const workspaceRoot = process.cwd().endsWith('/libs/workspace-react')
  ? resolve(process.cwd(), '../..')
  : process.cwd().endsWith('/apps/cockpit')
  ? resolve(process.cwd(), '../..')
  : process.cwd();
const cockpitCss = readFileSync(
  resolve(workspaceRoot, 'libs/workspace-react/src/styles/workspace.css'),
  'utf8'
);

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function snapshot(phase: RuntimePhase): RuntimeSnapshot {
  const target =
    phase === 'not_configured'
      ? parseRuntimeTarget(null)
      : phase === 'invalid_configuration'
      ? parseRuntimeTarget('raw-secret-invalid-url')
      : parseRuntimeTarget(
          'https://user:password@runtime.test/path?token=secret#fragment'
        );
  return {
    ...createRuntimeSnapshot(target, 'streaming'),
    phase,
    checkedAt: phase === 'connecting' ? null : Date.UTC(2026, 7, 31, 17, 0, 0),
  };
}

const statusCases = [
  ['not_configured', 'Not configured', 'circle-slash'],
  ['invalid_configuration', 'Invalid runtime URL', 'triangle-alert'],
  ['configuring', 'Configuring', 'loader-circle'],
  ['connecting', 'Connecting', 'loader-circle'],
  ['checking', 'Checking', 'loader-circle'],
  ['ready', 'Ready', 'circle-check'],
  ['unresponsive', 'Unresponsive', 'triangle-alert'],
  ['reloading', 'Reloading', 'loader-circle'],
  ['error', 'Error', 'triangle-alert'],
  ['unauthorized', 'Unauthorized', 'triangle-alert'],
  ['network_blocked', 'Network blocked', 'triangle-alert'],
  ['incompatible_bridge', 'Incompatible runtime', 'triangle-alert'],
] as const satisfies ReadonlyArray<readonly [RuntimePhase, string, string]>;

function renderSection(
  phase: RuntimePhase,
  overrides: Partial<React.ComponentProps<typeof RuntimeSection>> = {}
) {
  const props = {
    snapshot: snapshot(phase),
    product: 'LangGraph',
    language: 'Python',
    open: true,
    onOpenChange: vi.fn(),
    onRecheck: vi.fn(),
    onReload: vi.fn(),
    onOpenRuntime: vi.fn().mockReturnValue('requested' as const),
    onCopyDiagnostics: vi.fn().mockResolvedValue('succeeded' as const),
    formatCheckedAt: vi.fn().mockReturnValue('Aug 31, 2026, 10:00 AM'),
    ...overrides,
  };
  render(<RuntimeSection {...props} />);
  return props;
}

describe('RuntimeSection', () => {
  it('styles runtime state hooks for truncation, forced colors, and reduced motion', () => {
    expect(cockpitCss).toMatch(
      /\[data-runtime-target\][\s\S]*?text-overflow:\s*ellipsis/
    );
    expect(cockpitCss).toMatch(/@media \(forced-colors:\s*active\)/);
    expect(cockpitCss).toMatch(/CanvasText/);
    expect(cockpitCss).toMatch(/HighlightText/);
    expect(cockpitCss).toMatch(
      /@media \(forced-colors:\s*active\)[\s\S]*?\[data-runtime-status\]\[data-runtime-phase\]\s*\{[\s\S]*?color:\s*CanvasText;/
    );
    expect(cockpitCss).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.workspace-runtime-status-loader[\s\S]*?animation:\s*none/
    );
  });

  it.each(statusCases)(
    'renders %s with exact visible status and icon vocabulary',
    (phase, label, icon) => {
      renderSection(phase);
      const status = document.querySelector('[data-runtime-status]');
      expect(status?.textContent).toBe(label);
      expect(status?.getAttribute('data-runtime-phase')).toBe(phase);
      expect(
        status?.querySelector(`[data-runtime-status-icon="${icon}"]`)
      ).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Runtime' })).toBeTruthy();
      expect(
        screen.queryByRole('button', { name: `Runtime ${label}` })
      ).toBeNull();
    }
  );

  it('exposes stable visual-state hooks without leaking the runtime target', () => {
    renderSection('unresponsive');

    expect(document.querySelector('[data-runtime-section]')).toBeTruthy();
    expect(
      document
        .querySelector('[data-runtime-status]')
        ?.getAttribute('data-runtime-phase')
    ).toBe('unresponsive');
    const target = document.querySelector('[data-runtime-target]');
    expect(target?.textContent).toBe('https://runtime.test/path');
    expect(target?.getAttribute('title')).toBeNull();
    expect(target?.getAttribute('aria-label')).toBeNull();
    expect(document.querySelector('[data-runtime-announcement]')).toBe(
      screen.getByRole('status')
    );
    expect(
      document.querySelector('[data-control-plane-overflow-menu-root]')
    ).toBeTruthy();
    expect(
      document.querySelector('[data-control-plane-overflow-trigger]')
    ).toBeTruthy();
  });

  it.each([
    ['invalid_configuration', 'start'],
    ['configuring', 'center'],
    ['connecting', 'center'],
    ['checking', 'center'],
    ['ready', 'center'],
    ['unresponsive', 'center'],
    ['reloading', 'center'],
    ['error', 'center'],
    ['unauthorized', 'center'],
    ['network_blocked', 'center'],
    ['incompatible_bridge', 'center'],
  ] as const)(
    'places the %s layout at its explicit %s anchor',
    (phase, placement) => {
      renderSection(phase);
      expect(
        document
          .querySelector('[data-control-plane-overflow-menu-root]')
          ?.getAttribute('data-overflow-placement')
      ).toBe(placement);
    }
  );

  it('binds configured Runtime menu centering to the placement hook', () => {
    expect(cockpitCss).toMatch(
      /\[data-control-plane-overflow-menu-root\]\[data-overflow-placement=["']center["']\]\s*>\s*\[data-control-plane-overflow-menu\]\s*\{[\s\S]*?left:\s*50%;[\s\S]*?right:\s*auto;[\s\S]*?transform:\s*translateX\(-50%\);/
    );
  });

  it('right-aligns the configured Runtime menu for coarse pointers', () => {
    expect(cockpitCss).toMatch(
      /@media \(pointer:\s*coarse\)\s*\{[\s\S]*?\[data-control-plane-overflow-menu-root\]\[data-overflow-placement=["']center["']\]\s*>\s*\[data-control-plane-overflow-menu\]\s*\{[\s\S]*?left:\s*auto;[\s\S]*?right:\s*0;[\s\S]*?transform:\s*none;/
    );
  });

  it('shows compact metadata, only the sanitized target, and truthful checked time', () => {
    renderSection('ready');
    expect(screen.getByText('Shared development')).toBeTruthy();
    expect(screen.getByText('Python · LangGraph')).toBeTruthy();
    expect(screen.getByText('https://runtime.test/path')).toBeTruthy();
    expect(document.body.textContent).not.toContain('password');
    expect(document.body.textContent).not.toContain('token=secret');
    expect(screen.getByText('Checked Aug 31, 2026, 10:00 AM')).toBeTruthy();
  });

  it('shows the active custom target kind and sanitized location without credentials', () => {
    const customLocation = 'https://api.example.test/langgraph';
    renderSection('ready', {
      runtimeTargetView: {
        kind: 'langsmith',
        label: 'Custom LangSmith',
        origin: 'https://api.example.test',
        pathname: '/langgraph',
        location: customLocation,
      },
    });

    expect(screen.getByText('Custom LangSmith')).toBeTruthy();
    expect(screen.getByText(customLocation)).toBeTruthy();
    for (const element of document.querySelectorAll(
      '[data-runtime-section], [data-runtime-section] *'
    )) {
      for (const attribute of element.attributes) {
        expect(attribute.value).not.toContain(customLocation);
      }
    }
    expect(document.body.textContent).not.toContain('test-key-redact-me');
  });

  it('shows browser execution metadata for static adapters', () => {
    renderSection('ready', {
      runtimeTargetView: getSanitizedRuntimeTargetDisplay({
        adapter: 'none',
        target: null,
      }),
    });

    expect(screen.getByText('Runs in your browser')).toBeTruthy();
    expect(screen.queryByText('Runtime target unavailable')).toBeNull();
    expect(screen.queryByText('Shared development')).toBeNull();
  });

  it('shows Not checked yet until a check completes', () => {
    renderSection('connecting');
    expect(screen.getByText('Not checked yet')).toBeTruthy();
  });

  it('omits all commands when not configured', () => {
    renderSection('not_configured');
    expect(
      screen.queryByRole('toolbar', { name: 'Runtime actions' })
    ).toBeNull();
  });

  it('offers only Copy diagnostics for invalid configuration and never renders the raw value', async () => {
    renderSection('invalid_configuration');
    expect(document.body.textContent).not.toContain('raw-secret-invalid-url');
    fireEvent.click(
      screen.getByRole('button', { name: 'More runtime actions' })
    );
    expect(
      await screen.findByRole('menuitem', { name: 'Copy diagnostics' })
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Recheck' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reload runtime' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open runtime' })).toBeNull();
  });

  it.each(['configuring', 'connecting', 'checking', 'reloading'] as const)(
    'disables Recheck while %s',
    (phase) => {
      renderSection(phase);
      expect(
        (screen.getByRole('button', { name: 'Recheck' }) as HTMLButtonElement)
          .disabled
      ).toBe(true);
    }
  );

  it.each([
    'ready',
    'unresponsive',
    'error',
    'unauthorized',
    'network_blocked',
    'incompatible_bridge',
  ] as const)('enables Recheck while %s', (phase) => {
    renderSection(phase);
    expect(
      (screen.getByRole('button', { name: 'Recheck' }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });

  it('disables Reload only while reloading and keeps Open runtime accessible', () => {
    const { rerender } = render(
      <RuntimeSection
        snapshot={snapshot('ready')}
        product="LangGraph"
        language="Python"
        open
        onOpenChange={vi.fn()}
        onRecheck={vi.fn()}
        onReload={vi.fn()}
        onOpenRuntime={vi.fn().mockReturnValue('requested')}
        onCopyDiagnostics={vi.fn().mockResolvedValue('succeeded')}
      />
    );
    expect(
      (
        screen.getByRole('button', {
          name: 'Reload runtime',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
    expect(screen.getByRole('button', { name: 'Open runtime' })).toBeTruthy();

    rerender(
      <RuntimeSection
        snapshot={snapshot('reloading')}
        product="LangGraph"
        language="Python"
        open
        onOpenChange={vi.fn()}
        onRecheck={vi.fn()}
        onReload={vi.fn()}
        onOpenRuntime={vi.fn().mockReturnValue('requested')}
        onCopyDiagnostics={vi.fn().mockResolvedValue('succeeded')}
      />
    );
    expect(
      (
        screen.getByRole('button', {
          name: 'Reload runtime',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });

  it('forwards Runtime disclosure changes to the preference handler', () => {
    const props = renderSection('ready');
    fireEvent.click(screen.getByRole('button', { name: 'Runtime' }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('describes the current status while Runtime is collapsed', () => {
    renderSection('unresponsive', { open: false });

    expect(
      screen.getByRole('button', {
        name: 'Runtime',
        description: 'Runtime status: Unresponsive',
      })
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Runtime Unresponsive' })
    ).toBeNull();
    expect(
      document.querySelectorAll('[data-control-plane-section-description]')
    ).toHaveLength(1);
  });

  it('announces only user-triggered outcomes and never false copy success', async () => {
    const onCopyDiagnostics = vi.fn().mockResolvedValue('failed');
    renderSection('ready', { onCopyDiagnostics });
    const live = screen.getByRole('status');
    expect(live.textContent).toBe('');

    fireEvent.click(
      screen.getByRole('button', { name: 'More runtime actions' })
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy diagnostics' }));

    await waitFor(() =>
      expect(live.textContent).toBe('Diagnostics copy failed.')
    );
    expect(live.textContent).not.toContain('Diagnostics copied.');
    expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
  });

  it('keeps the runtime menu usable when copy rejects', async () => {
    renderSection('ready', {
      onCopyDiagnostics: vi.fn().mockRejectedValue(new Error('denied')),
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'More runtime actions' })
    );
    const item = screen.getByRole('menuitem', { name: 'Copy diagnostics' });
    fireEvent.click(item);

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'Diagnostics copy failed.'
      )
    );
    expect(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'Copy diagnostics',
      })
    ).toBeTruthy();
  });

  it('mutates the live-region outcome for repeated identical failures', async () => {
    const onCopyDiagnostics = vi.fn().mockResolvedValue('failed');
    renderSection('ready', { onCopyDiagnostics });
    const live = screen.getByRole('status');
    fireEvent.click(
      screen.getByRole('button', { name: 'More runtime actions' })
    );
    const item = screen.getByRole('menuitem', { name: 'Copy diagnostics' });

    fireEvent.click(item);
    await waitFor(() => expect(onCopyDiagnostics).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(live.textContent).toBe('Diagnostics copy failed.')
    );
    const firstOutcome = live.firstElementChild;
    const firstRevision = firstOutcome?.getAttribute(
      'data-runtime-announcement-revision'
    );
    expect(firstOutcome).toBeTruthy();
    expect(firstRevision).toBeTruthy();

    fireEvent.click(item);
    await waitFor(() => expect(onCopyDiagnostics).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        live.firstElementChild?.getAttribute(
          'data-runtime-announcement-revision'
        )
      ).not.toBe(firstRevision)
    );
    expect(live.firstElementChild).not.toBe(firstOutcome);
    expect(live.textContent).toBe('Diagnostics copy failed.');
    expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
  });

  it('keeps one live region mounted for a command outcome after collapse', async () => {
    const pending = deferred<'failed'>();
    const runtimeSnapshot = snapshot('ready');
    const props = {
      snapshot: runtimeSnapshot,
      product: 'LangGraph',
      language: 'Python',
      onOpenChange: vi.fn(),
      onRecheck: vi.fn(),
      onReload: vi.fn(),
      onOpenRuntime: vi.fn().mockReturnValue('requested' as const),
      onCopyDiagnostics: vi.fn().mockReturnValue(pending.promise),
    };
    const { rerender } = render(<RuntimeSection {...props} open />);
    fireEvent.click(
      screen.getByRole('button', { name: 'More runtime actions' })
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy diagnostics' }));
    expect(props.onCopyDiagnostics).toHaveBeenCalledTimes(1);

    rerender(<RuntimeSection {...props} open={false} />);

    expect(screen.queryByText('Shared development')).toBeNull();
    expect(
      screen.queryByRole('toolbar', { name: 'Runtime actions' })
    ).toBeNull();
    expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
    const live = screen.getByRole('status');
    expect(live.textContent).toBe('');

    await act(async () => pending.resolve('failed'));

    await waitFor(() =>
      expect(live.textContent).toBe('Diagnostics copy failed.')
    );
    expect(
      live.firstElementChild?.getAttribute('data-runtime-announcement-revision')
    ).toBeTruthy();
    expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
  });

  it.each([
    ['a capability change', { capability: 'persistence', routeGeneration: 1 }],
    [
      'a fresh route for the same capability',
      { capability: 'streaming', routeGeneration: 1 },
    ],
    [
      'a replacement runtime target',
      { capability: 'streaming', targetGeneration: 1 },
    ],
  ] as const)(
    'does not announce a stale copy outcome after %s',
    async (_label, nextIdentity) => {
      const pending = deferred<'succeeded'>();
      const onCopyDiagnostics = vi.fn().mockReturnValue(pending.promise);
      const initialSnapshot = snapshot('ready');
      const { rerender } = render(
        <RuntimeSection
          snapshot={initialSnapshot}
          product="LangGraph"
          language="Python"
          open
          onOpenChange={vi.fn()}
          onRecheck={vi.fn()}
          onReload={vi.fn()}
          onOpenRuntime={vi.fn().mockReturnValue('requested')}
          onCopyDiagnostics={onCopyDiagnostics}
        />
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'More runtime actions' })
      );
      fireEvent.click(
        screen.getByRole('menuitem', { name: 'Copy diagnostics' })
      );
      expect(onCopyDiagnostics).toHaveBeenCalledTimes(1);

      rerender(
        <RuntimeSection
          snapshot={{ ...snapshot('ready'), ...nextIdentity }}
          product="LangGraph"
          language="Python"
          open
          onOpenChange={vi.fn()}
          onRecheck={vi.fn()}
          onReload={vi.fn()}
          onOpenRuntime={vi.fn().mockReturnValue('requested')}
          onCopyDiagnostics={onCopyDiagnostics}
        />
      );
      await act(async () => pending.resolve('succeeded'));

      expect(screen.getByRole('status').textContent).toBe('');
    }
  );

  it('does not let an older same-route command overwrite a newer outcome', async () => {
    const pending = deferred<'succeeded'>();
    renderSection('ready', {
      onCopyDiagnostics: vi.fn().mockReturnValue(pending.promise),
      onOpenRuntime: vi.fn().mockReturnValue('requested'),
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'More runtime actions' })
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy diagnostics' }));

    fireEvent.click(screen.getByRole('button', { name: 'Open runtime' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'Runtime open requested.'
      )
    );
    await act(async () => pending.resolve('succeeded'));

    expect(screen.getByRole('status').textContent).toBe(
      'Runtime open requested.'
    );
  });

  it('publishes current command outcomes after Strict Mode effect replay', async () => {
    render(
      <React.StrictMode>
        <RuntimeSection
          snapshot={snapshot('ready')}
          product="LangGraph"
          language="Python"
          open
          onOpenChange={vi.fn()}
          onRecheck={vi.fn()}
          onReload={vi.fn()}
          onOpenRuntime={vi.fn().mockReturnValue('requested')}
          onCopyDiagnostics={vi.fn().mockResolvedValue('succeeded')}
        />
      </React.StrictMode>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open runtime' }));

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'Runtime open requested.'
      )
    );
  });
});
