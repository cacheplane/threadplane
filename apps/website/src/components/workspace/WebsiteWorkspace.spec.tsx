/** @vitest-environment jsdom */
import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  WorkspaceProviderProps,
  WorkspaceShellProps,
} from '@threadplane/workspace-react';
import {
  RuntimeTargetProvider,
  useLangGraphRuntimeTarget,
} from '@threadplane/workspace-react';
import type {
  ContentBundle,
  WorkspacePresentation,
} from '@threadplane/cockpit-shell';
import type { WorkspaceResolution } from '@threadplane/cockpit-registry';

const mocks = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_POSTHOG_HOST =
    'https://external-posthog.example.test';
  return {
    latestProviderProps: null as WorkspaceProviderProps | null,
    latestShellProps: null as WorkspaceShellProps | null,
    push: vi.fn(),
    replace: vi.fn(),
    track: vi.fn(),
  };
});

vi.mock('next/navigation', () => ({
  usePathname: () => window.location.pathname,
  useRouter: () => ({
    push: mocks.push,
    replace: mocks.replace,
  }),
}));

vi.mock('../../lib/analytics/client', () => ({ track: mocks.track }));

vi.mock('@threadplane/workspace-react', async (importOriginal) => {
  const ReactModule = await import('react');
  const actual = await importOriginal<
    typeof import('@threadplane/workspace-react')
  >();
  return {
    ...actual,
    WorkspaceProvider(props: WorkspaceProviderProps) {
      mocks.latestProviderProps = props;
      return ReactModule.createElement(actual.WorkspaceProvider, props);
    },
    WorkspaceShell(props: WorkspaceShellProps) {
      mocks.latestShellProps = props;
      return ReactModule.createElement(actual.WorkspaceShell, props);
    },
  };
});

import { WebsiteWorkspace } from './WebsiteWorkspace';
import { WebsiteWorkspaceRoot } from './WebsiteWorkspaceRoot';

const emptyContent: ContentBundle = {
  codeFiles: {},
  codeSources: {},
  promptFiles: {},
  runtimeUrl: null,
  docSections: [],
};

const docsOnlyResolution: WorkspaceResolution = {
  kind: 'docs-only',
  docsPath: '/docs/langgraph/guides/testing',
  title: 'Testing',
  unavailableReason: 'no-workspace-capability',
};

const docsOnlyPresentation: WorkspacePresentation = {
  kind: 'docs-only',
  docsPath: '/docs/langgraph/guides/testing',
  title: 'Testing',
  runnable: false,
};

const mappedResolution = (
  id: string,
  topic: string,
  availableModes: ('Docs' | 'Run' | 'Code' | 'API')[],
  docsPath = `/docs/langgraph/guides/${topic}`
): WorkspaceResolution => ({
  kind: 'mapped',
  identity: {
    id,
    product: 'langgraph',
    section: 'core-capabilities',
    topic,
    page: 'overview',
    language: 'python',
    title: topic,
    docsPath,
    runtimeAdapter: 'langgraph',
    availableModes,
  },
});

const mappedPresentation = (
  resolution: WorkspaceResolution
): WorkspacePresentation => {
  if (resolution.kind !== 'mapped') throw new Error('Expected mapped route');
  return {
    kind: 'capability',
    identity: resolution.identity,
    docsPath: resolution.identity.docsPath ?? '',
    promptAssetPaths: [],
    codeAssetPaths: ['example.ts'],
    backendAssetPaths: [],
    runnable: resolution.identity.availableModes.includes('Run'),
  };
};

const renderWorkspace = (
  overrides: Partial<React.ComponentProps<typeof WebsiteWorkspace>> = {}
) =>
  render(
    <RuntimeTargetProvider>
      <WebsiteWorkspace
        resolution={docsOnlyResolution}
        presentation={docsOnlyPresentation}
        contentBundle={emptyContent}
        navigationTree={[]}
        routePath="/docs/langgraph/guides/testing"
        docsSlot={<article>Server-rendered docs article</article>}
        {...overrides}
      />
    </RuntimeTargetProvider>
  );

const activeWorkspaceMode = (): string | undefined =>
  document.querySelector<HTMLElement>('[data-workspace-shell]')?.dataset
    .workspaceMode;

describe('WebsiteWorkspace', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/docs/langgraph/guides/testing');
    mocks.latestProviderProps = null;
    mocks.latestShellProps = null;
    mocks.push.mockClear();
    mocks.replace.mockClear();
    mocks.track.mockClear();
  });

  it('composes the server Docs slot and Website labels through the shared provider and shell', () => {
    renderWorkspace();

    expect(screen.getByText('Server-rendered docs article')).toBeTruthy();
    expect(mocks.latestProviderProps).toMatchObject({
      resolution: docsOnlyResolution,
      presentation: docsOnlyPresentation,
      contentBundle: emptyContent,
      routePath: '/docs/langgraph/guides/testing',
      requestedMode: null,
    });
    expect(mocks.latestShellProps).toMatchObject({
      navigationTree: [],
      ariaLabel: 'Documentation workspace',
      modeNavigationLabel: 'Documentation modes',
      contextPaneLabel: 'Documentation context',
      mobileDialogLabel: 'Documentation control plane',
      mobileTitle: 'Documentation',
      rootElement: 'section',
    });
    expect(
      document.querySelector('[data-website-workspace-host]')
    ).toBeTruthy();
    expect(document.querySelector('[data-workspace-shell]')?.tagName).toBe(
      'SECTION'
    );
  });

  it('isolates persistent site chrome for the full mobile modal presence', () => {
    const navigation = document.createElement('nav');
    navigation.setAttribute('data-site-navigation', '');
    const announcementRegion = document.createElement('div');
    announcementRegion.setAttribute('data-announcement-region', '');
    document.body.append(navigation, announcementRegion);
    renderWorkspace();

    act(() => mocks.latestShellProps?.onMobileModalPresenceChange?.(true));

    for (const element of [navigation, announcementRegion]) {
      expect(element.inert).toBe(true);
      expect(element.getAttribute('aria-hidden')).toBe('true');
    }
    expect(announcementRegion.hasAttribute('data-workspace-modal-hidden')).toBe(
      true
    );
    const lateAnnouncement = document.createElement('button');
    lateAnnouncement.setAttribute('data-announcement-toast', '');
    announcementRegion.appendChild(lateAnnouncement);
    expect(lateAnnouncement.parentElement).toBe(announcementRegion);
    expect(announcementRegion.inert).toBe(true);

    act(() => mocks.latestShellProps?.onMobileModalPresenceChange?.(false));

    for (const element of [navigation, announcementRegion]) {
      expect(element.inert).toBe(false);
      expect(element.hasAttribute('aria-hidden')).toBe(false);
    }
    expect(announcementRegion.hasAttribute('data-workspace-modal-hidden')).toBe(
      false
    );
    navigation.remove();
    announcementRegion.remove();
  });

  it.each([
    [
      'mapped',
      mappedResolution(
        'langgraph:core-capabilities:streaming:overview:python',
        'streaming',
        ['Docs', 'Run']
      ),
    ],
    ['unmapped', docsOnlyResolution],
  ] as const)(
    'renders Website Learn and Search context for %s Docs routes',
    (_kind, resolution) => {
      renderWorkspace({
        resolution,
        presentation:
          resolution.kind === 'mapped'
            ? mappedPresentation(resolution)
            : docsOnlyPresentation,
        docsContext: {
          activeLibrary: 'langgraph',
          activeSection: 'guides',
          activeSlug: resolution.kind === 'mapped' ? 'streaming' : 'testing',
        },
      });

      expect(screen.getByText('Learn')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Search docs' })).toBeTruthy();
    }
  );

  it('keeps one shell instance mounted while route registrars change', async () => {
    const source = mappedResolution(
      'langgraph:core-capabilities:streaming:overview:python',
      'streaming',
      ['Docs', 'Run', 'Code', 'API']
    );
    const destination = mappedResolution(
      'langgraph:core-capabilities:persistence:overview:python',
      'persistence',
      ['Docs', 'Run', 'Code', 'API']
    );
    const route = (
      resolution: WorkspaceResolution,
      routePath: string,
      article: string
    ) => (
      <WebsiteWorkspaceRoot>
        <WebsiteWorkspace
          key={routePath}
          resolution={resolution}
          presentation={mappedPresentation(resolution)}
          contentBundle={emptyContent}
          navigationTree={[]}
          routePath={routePath}
          docsSlot={<article>{article}</article>}
        />
      </WebsiteWorkspaceRoot>
    );

    const view = render(
      route(source, '/docs/langgraph/guides/streaming', 'Streaming article')
    );
    const shell = await waitFor(() => {
      const candidate = document.querySelector<HTMLElement>(
        '[data-workspace-shell]'
      );
      expect(candidate).toBeTruthy();
      return candidate as HTMLElement;
    });
    shell.dataset.shellLifetime = 'original';

    window.history.replaceState({}, '', '/docs/langgraph/guides/persistence');
    view.rerender(
      route(
        destination,
        '/docs/langgraph/guides/persistence',
        'Persistence article'
      )
    );

    await screen.findByText('Persistence article');
    expect(document.querySelector('[data-workspace-shell]')).toBe(shell);
    expect(shell.dataset.shellLifetime).toBe('original');
    expect(mocks.latestProviderProps?.routePath).toBe(
      '/docs/langgraph/guides/persistence'
    );
  });

  it('keeps the volatile runtime target above in-shell route registrars', async () => {
    function RuntimeTargetProbe() {
      const langgraph = useLangGraphRuntimeTarget();
      return (
        <>
          <output data-testid="website-target-kind">
            {langgraph.view.kind}
          </output>
          <button
            onClick={() =>
              langgraph.applyCustomTarget(
                'https://api.example.test/langgraph',
                'test-key-redact-me'
              )
            }
          >
            Apply Website target
          </button>
        </>
      );
    }
    const source = mappedResolution(
      'langgraph:core-capabilities:streaming:overview:python',
      'streaming',
      ['Docs', 'Run', 'Code', 'API']
    );
    const destination = mappedResolution(
      'langgraph:core-capabilities:persistence:overview:python',
      'persistence',
      ['Docs', 'Run', 'Code', 'API']
    );
    const route = (resolution: WorkspaceResolution, routePath: string) => (
      <WebsiteWorkspaceRoot>
        <RuntimeTargetProbe />
        <WebsiteWorkspace
          key={routePath}
          resolution={resolution}
          presentation={mappedPresentation(resolution)}
          contentBundle={emptyContent}
          navigationTree={[]}
          routePath={routePath}
          docsSlot={
            <article>
              {resolution.kind === 'mapped' ? resolution.identity.title : ''}
            </article>
          }
        />
      </WebsiteWorkspaceRoot>
    );

    const view = render(route(source, '/docs/langgraph/guides/streaming'));
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply Website target' })
    );
    expect(screen.getByTestId('website-target-kind').textContent).toBe(
      'langsmith'
    );

    window.history.replaceState({}, '', '/docs/langgraph/guides/persistence');
    view.rerender(route(destination, '/docs/langgraph/guides/persistence'));

    await screen.findByText('persistence');
    expect(screen.getByTestId('website-target-kind').textContent).toBe(
      'langsmith'
    );
  });

  it('normalizes a valid but unavailable mode to the canonical Docs URL', async () => {
    window.history.replaceState(
      {},
      '',
      '/docs/langgraph/guides/testing?mode=run&keep=1'
    );
    renderWorkspace();

    await waitFor(() => {
      expect(activeWorkspaceMode()).toBe('Docs');
      expect(mocks.replace).toHaveBeenCalledWith(
        '/docs/langgraph/guides/testing'
      );
    });
    expect(mocks.replace.mock.calls[0]?.[0]).not.toContain('runtime');
  });

  it('treats repeated mode values as invalid on initial discovery', async () => {
    const source = mappedResolution(
      'langgraph:core-capabilities:streaming:overview:python',
      'streaming',
      ['Docs', 'Run', 'Code', 'API']
    );
    window.history.replaceState(
      {},
      '',
      '/docs/langgraph/guides/streaming?mode=code&mode=run&keep=1'
    );
    renderWorkspace({
      resolution: source,
      presentation: mappedPresentation(source),
      routePath: '/docs/langgraph/guides/streaming',
    });

    await waitFor(() => {
      expect(activeWorkspaceMode()).toBe('Docs');
      expect(mocks.replace).toHaveBeenCalledWith(
        '/docs/langgraph/guides/streaming'
      );
    });
  });

  it('keeps mode navigation on the canonical docs path without adding runtime state', () => {
    window.history.replaceState(
      {},
      '',
      '/docs/langgraph/guides/testing?keep=1'
    );
    renderWorkspace();

    act(() => mocks.latestProviderProps?.pushMode('Run'));
    expect(mocks.push).toHaveBeenCalledWith(
      '/docs/langgraph/guides/testing?mode=run'
    );

    act(() => mocks.latestProviderProps?.pushMode('Docs'));
    expect(mocks.push).toHaveBeenLastCalledWith(
      '/docs/langgraph/guides/testing'
    );
    expect(mocks.push.mock.calls.flat().join(' ')).not.toMatch(
      /runtimeUrl|runtime_url|endpoint|credential/i
    );
  });

  it('keeps the selected mode synchronized on a docs route', async () => {
    const resolution = mappedResolution(
      'langgraph:core-capabilities:durable-execution:overview:python',
      'durable-execution',
      ['Docs', 'Run', 'Code', 'API'],
      '/docs/langgraph/guides/durable-execution'
    );
    window.history.replaceState(
      {},
      '',
      '/docs/langgraph/guides/durable-execution?mode=run&keep=1'
    );
    mocks.push.mockImplementation((href: string) => {
      window.history.pushState({}, '', href);
    });
    renderWorkspace({
      resolution,
      presentation: mappedPresentation(resolution),
      routePath: '/docs/langgraph/guides/durable-execution',
    });
    await waitFor(() => expect(activeWorkspaceMode()).toBe('Run'));

    act(() => mocks.latestProviderProps?.pushMode('Docs'));

    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith(
        '/docs/langgraph/guides/durable-execution'
      );
      expect(mocks.latestProviderProps?.requestedMode).toBe(null);
      expect(activeWorkspaceMode()).toBe('Docs');
    });
  });

  it('always links a capability to its docs path', () => {
    renderWorkspace();
    const resolveHref = mocks.latestProviderProps?.resolveIdentityHref;
    if (!resolveHref) throw new Error('Expected Website identity resolver');

    expect(
      resolveHref({
        id: 'langgraph:core-capabilities:durable-execution:overview:python',
        docsPath: '/docs/langgraph/guides/durable-execution',
      } as never)
    ).toBe('/docs/langgraph/guides/durable-execution');
  });

  it('records cross-route focus intent before navigating', () => {
    renderWorkspace();

    act(() =>
      mocks.latestProviderProps?.pushIdentity(
        '/docs/langgraph/guides/streaming',
        { restoreFocus: 'workspace-panel' }
      )
    );

    expect(mocks.push).toHaveBeenCalledWith('/docs/langgraph/guides/streaming');
    expect(
      [...Array(window.sessionStorage.length)]
        .map((_, index) =>
          window.sessionStorage.getItem(window.sessionStorage.key(index) ?? '')
        )
        .join(' ')
    ).toContain('/docs/langgraph/guides/streaming');
  });

  it('adapts shared workspace analytics to the Website event surface', () => {
    renderWorkspace();
    const props = mocks.latestProviderProps;
    if (!props) throw new Error('Expected shared provider props');

    act(() =>
      props.trackModeChange?.({
        capability: 'streaming',
        fromMode: 'Docs',
        toMode: 'Run',
      })
    );
    act(() =>
      props.trackNavigation?.({
        capability: 'persistence',
        category: 'core-capabilities',
        fromCapability: 'streaming',
      })
    );

    expect(mocks.track).toHaveBeenCalledWith(
      'docs:workspace_mode_switched',
      expect.objectContaining({
        capability: 'streaming',
        from_mode: 'docs',
        to_mode: 'run',
      })
    );
    expect(mocks.track).toHaveBeenCalledWith(
      'docs:workspace_navigation',
      expect.objectContaining({
        capability: 'persistence',
        from_capability: 'streaming',
      })
    );
    expect(props.trackRuntimeAction).toBeTypeOf('function');
    expect(props.trackRuntimeTransition).toBeTypeOf('function');
  });

  it('does not let the source route mode normalize a valid destination query', async () => {
    const source = mappedResolution(
      'langgraph:core-capabilities:streaming:overview:python',
      'streaming',
      ['Docs', 'Run', 'Code', 'API']
    );
    const destination = mappedResolution(
      'langgraph:core-capabilities:code-only:overview:python',
      'code-only',
      ['Docs', 'Code']
    );
    window.history.replaceState(
      {},
      '',
      '/docs/langgraph/guides/streaming?mode=run'
    );
    const view = renderWorkspace({
      resolution: source,
      presentation: mappedPresentation(source),
      routePath: '/docs/langgraph/guides/streaming',
    });
    await waitFor(() => expect(activeWorkspaceMode()).toBe('Run'));
    mocks.replace.mockClear();

    window.history.replaceState(
      {},
      '',
      '/docs/langgraph/guides/code-only?mode=code'
    );
    view.rerender(
      <RuntimeTargetProvider>
        <WebsiteWorkspace
          resolution={destination}
          presentation={mappedPresentation(destination)}
          contentBundle={emptyContent}
          navigationTree={[]}
          routePath="/docs/langgraph/guides/code-only"
          docsSlot={<article>Destination docs article</article>}
        />
      </RuntimeTargetProvider>
    );

    await waitFor(() => expect(activeWorkspaceMode()).toBe('Code'));
    expect(window.location.search).toBe('?mode=code');
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('does not carry a source mode into a docs-only destination without a query', async () => {
    const source = mappedResolution(
      'langgraph:core-capabilities:streaming:overview:python',
      'streaming',
      ['Docs', 'Run', 'Code', 'API']
    );
    window.history.replaceState(
      {},
      '',
      '/docs/langgraph/guides/streaming?mode=run'
    );
    const view = renderWorkspace({
      resolution: source,
      presentation: mappedPresentation(source),
      routePath: '/docs/langgraph/guides/streaming',
    });
    await waitFor(() => expect(activeWorkspaceMode()).toBe('Run'));
    mocks.replace.mockClear();

    window.history.replaceState({}, '', '/docs/langgraph/guides/testing');
    view.rerender(
      <RuntimeTargetProvider>
        <WebsiteWorkspace
          resolution={docsOnlyResolution}
          presentation={docsOnlyPresentation}
          contentBundle={emptyContent}
          navigationTree={[]}
          routePath="/docs/langgraph/guides/testing"
          docsSlot={<article>Testing docs article</article>}
        />
      </RuntimeTargetProvider>
    );

    await waitFor(() => expect(activeWorkspaceMode()).toBe('Docs'));
    expect(window.location.search).toBe('');
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('keeps discovered mode state synchronized when the real shell selects a mode', async () => {
    const source = mappedResolution(
      'langgraph:core-capabilities:streaming:overview:python',
      'streaming',
      ['Docs', 'Run', 'Code', 'API']
    );
    window.history.replaceState(
      {},
      '',
      '/docs/langgraph/guides/streaming?mode=run'
    );
    mocks.push.mockImplementation((href: string) => {
      window.history.pushState({}, '', href);
    });
    const view = renderWorkspace({
      resolution: source,
      presentation: mappedPresentation(source),
      routePath: '/docs/langgraph/guides/streaming',
    });
    await waitFor(() => expect(activeWorkspaceMode()).toBe('Run'));

    act(() => {
      screen.getByRole('button', { name: 'Code' }).click();
    });

    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith(
        '/docs/langgraph/guides/streaming?mode=code'
      );
      expect(activeWorkspaceMode()).toBe('Code');
      expect(mocks.latestProviderProps?.requestedMode).toBe('code');
    });

    view.rerender(
      <RuntimeTargetProvider>
        <WebsiteWorkspace
          resolution={source}
          presentation={mappedPresentation(source)}
          contentBundle={emptyContent}
          navigationTree={[]}
          routePath="/docs/langgraph/guides/streaming"
          docsSlot={<article>Updated docs article</article>}
        />
      </RuntimeTargetProvider>
    );
    expect(activeWorkspaceMode()).toBe('Code');
  });

  it('synchronizes discovered mode state on browser history traversal', async () => {
    const source = mappedResolution(
      'langgraph:core-capabilities:streaming:overview:python',
      'streaming',
      ['Docs', 'Run', 'Code', 'API']
    );
    window.history.replaceState(
      {},
      '',
      '/docs/langgraph/guides/streaming?mode=run'
    );
    renderWorkspace({
      resolution: source,
      presentation: mappedPresentation(source),
      routePath: '/docs/langgraph/guides/streaming',
    });
    await waitFor(() => expect(activeWorkspaceMode()).toBe('Run'));

    window.history.pushState(
      {},
      '',
      '/docs/langgraph/guides/streaming?mode=code'
    );
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));

    await waitFor(() => {
      expect(activeWorkspaceMode()).toBe('Code');
      expect(mocks.latestProviderProps?.requestedMode).toBe('code');
    });
  });

  it('keeps workspace mode state aligned across Back and Forward history entries', async () => {
    const source = mappedResolution(
      'langgraph:core-capabilities:durable-execution:overview:python',
      'durable-execution',
      ['Docs', 'Run', 'Code', 'API'],
      '/docs/langgraph/guides/durable-execution'
    );
    window.history.replaceState(
      {},
      '',
      '/docs/langgraph/guides/durable-execution'
    );
    renderWorkspace({
      resolution: source,
      presentation: mappedPresentation(source),
      routePath: '/docs/langgraph/guides/durable-execution',
    });
    await waitFor(() => expect(activeWorkspaceMode()).toBe('Docs'));

    window.history.pushState(
      {},
      '',
      '/docs/langgraph/guides/durable-execution?mode=code'
    );
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    await waitFor(() => expect(activeWorkspaceMode()).toBe('Code'));

    window.history.replaceState(
      {},
      '',
      '/docs/langgraph/guides/durable-execution'
    );
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    await waitFor(() => expect(activeWorkspaceMode()).toBe('Docs'));

    window.history.replaceState(
      {},
      '',
      '/docs/langgraph/guides/durable-execution?mode=code'
    );
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    await waitFor(() => expect(activeWorkspaceMode()).toBe('Code'));
  });

  it('treats repeated mode values as invalid during history traversal', async () => {
    const source = mappedResolution(
      'langgraph:core-capabilities:durable-execution:overview:python',
      'durable-execution',
      ['Docs', 'Run', 'Code', 'API'],
      '/docs/langgraph/guides/durable-execution'
    );
    window.history.replaceState(
      {},
      '',
      '/docs/langgraph/guides/durable-execution?mode=code'
    );
    renderWorkspace({
      resolution: source,
      presentation: mappedPresentation(source),
      routePath: '/docs/langgraph/guides/durable-execution',
    });
    await waitFor(() => expect(activeWorkspaceMode()).toBe('Code'));
    mocks.replace.mockClear();

    window.history.pushState(
      {},
      '',
      '/docs/langgraph/guides/durable-execution?mode=api&mode=docs&keep=1'
    );
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));

    await waitFor(() => {
      expect(activeWorkspaceMode()).toBe('Docs');
      expect(mocks.replace).toHaveBeenCalledOnce();
    });
    const replacement = new URL(
      String(mocks.replace.mock.calls[0]?.[0]),
      window.location.origin
    );
    expect(replacement.pathname).toBe(
      '/docs/langgraph/guides/durable-execution'
    );
    expect(replacement.searchParams.getAll('mode')).toEqual([]);
    expect(replacement.searchParams.has('keep')).toBe(false);
  });

  it('uses the Website same-origin ingest proxy for the real runtime iframe', async () => {
    const source = mappedResolution(
      'langgraph:core-capabilities:streaming:overview:python',
      'streaming',
      ['Docs', 'Run', 'Code', 'API']
    );
    window.history.replaceState(
      {},
      '',
      '/docs/langgraph/guides/streaming?mode=run'
    );
    renderWorkspace({
      resolution: source,
      presentation: mappedPresentation(source),
      contentBundle: {
        ...emptyContent,
        runtimeUrl: 'https://runtime.example.test/demo',
      },
      routePath: '/docs/langgraph/guides/streaming',
    });

    const frame = await waitFor(() => {
      const element = document.querySelector<HTMLIFrameElement>('iframe');
      expect(element).toBeTruthy();
      return element as HTMLIFrameElement;
    });
    const src = new URL(frame.src);
    expect(src.searchParams.get('cockpit_host')).toBe(
      `${window.location.origin}/ingest`
    );
    expect(src.searchParams.get('cockpit_host')).not.toContain(
      'external-posthog.example.test'
    );

    const postMessage = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'tplane:theme-request' },
        source: frame.contentWindow,
      })
    );
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'tplane:theme', theme: 'light' },
      '*'
    );
  });
});
