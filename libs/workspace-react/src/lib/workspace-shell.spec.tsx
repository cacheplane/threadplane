/** @vitest-environment jsdom */
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cockpitManifest,
  toWorkspaceIdentity,
  type WorkspaceMode,
  type WorkspaceResolution,
} from '@threadplane/cockpit-registry';
import { RUNTIME_CONFIGURATION_VERSION } from '@threadplane/cockpit-runtime-bridge';
import type {
  ContentBundle,
  WorkspacePresentation,
} from '@threadplane/cockpit-shell';
import { WorkspaceProvider } from './workspace-provider';
import { WorkspaceShell } from './workspace-shell';
import type { WorkspaceCrumb } from './workspace-contracts';
import { RuntimeTargetProvider } from './runtime/runtime-target-provider';

const runModeFault = vi.hoisted(() => ({ shouldThrow: false }));
const RUN_RAIL_ITEM = /^Run(?:,|$)/;

vi.mock('./components/run-mode/run-mode', async (importOriginal) => {
  const ReactModule = await import('react');
  const actual = await importOriginal<
    typeof import('./components/run-mode/run-mode')
  >();
  return {
    ...actual,
    RunMode(props: React.ComponentProps<typeof actual.RunMode>) {
      if (runModeFault.shouldThrow) throw new Error('runtime panel failure');
      return ReactModule.createElement(actual.RunMode, props);
    },
  };
});

const entry = cockpitManifest.find(
  (candidate) =>
    candidate.product === 'langgraph' &&
    candidate.topic === 'streaming' &&
    candidate.language === 'python'
);
if (!entry) throw new Error('Expected the streaming registry fixture');

const identity = toWorkspaceIdentity(entry);
const resolution: WorkspaceResolution = { kind: 'mapped', identity };
const presentation: WorkspacePresentation = {
  kind: 'capability',
  identity,
  docsPath: identity.docsPath ?? '',
  promptAssetPaths: [],
  codeAssetPaths: ['example.ts'],
  backendAssetPaths: [],
  runtimeUrl: 'langgraph/streaming',
  devPort: 4300,
  runnable: true,
};
const contentBundle: ContentBundle = {
  codeFiles: { 'example.ts': '<pre><code>source</code></pre>' },
  codeSources: { 'example.ts': 'source' },
  promptFiles: {},
  runtimeUrl: 'https://runtime.example.test/demo',
  docSections: [],
};

function renderWorkspace(options: {
  resolution?: WorkspaceResolution;
  presentation?: WorkspacePresentation;
  contentBundle?: ContentBundle;
  requestedMode?: string | null;
  docsSlot?: React.ReactNode;
  runFallbackSlot?: React.ReactNode;
  apiSlot?: React.ReactNode;
  rootElement?: 'main' | 'section';
  contextTrail?: readonly WorkspaceCrumb[];
  navigationLayout?: 'rail' | 'toolbar';
  resizableNavigation?: boolean;
  container?: HTMLElement;
  strict?: boolean;
}) {
  const selectedResolution = options.resolution ?? resolution;
  const selectedPresentation = options.presentation ?? presentation;
  const selectedContent = options.contentBundle ?? contentBundle;
  return render(
    <RuntimeTargetProvider>
      <WorkspaceProvider
        resolution={selectedResolution}
        presentation={selectedPresentation}
        contentBundle={selectedContent}
        routePath={
          selectedResolution.kind === 'mapped'
            ? selectedResolution.identity.docsPath
            : selectedResolution.docsPath
        }
        requestedMode={options.requestedMode ?? 'docs'}
        docsSlot={options.docsSlot}
        runFallbackSlot={options.runFallbackSlot}
        apiSlot={options.apiSlot}
        pushIdentity={vi.fn()}
        pushMode={vi.fn()}
        replaceMode={vi.fn()}
        getSessionId={() => 'session-1'}
      >
        <WorkspaceShell
          navigationTree={[]}
          manifest={cockpitManifest}
          rootElement={options.rootElement}
          contextTrail={options.contextTrail}
          navigationLayout={options.navigationLayout}
          resizableNavigation={options.resizableNavigation}
        />
      </WorkspaceProvider>
    </RuntimeTargetProvider>,
    {
      container: options.container,
      wrapper: options.strict ? React.StrictMode : undefined,
    }
  );
}

describe('WorkspaceShell persistent panel composition', () => {
  it('offers an example directory and generated API on a docs-only route', () => {
    renderWorkspace({
      resolution: {
        kind: 'docs-only',
        docsPath: '/docs/angular/a2ui/start',
        title: 'Start',
        unavailableReason: 'no-workspace-capability',
      },
      presentation: {
        kind: 'docs-only',
        docsPath: '/docs/angular/a2ui/start',
        title: 'Start',
        runnable: false,
      },
      contentBundle: { ...contentBundle, runtimeUrl: null },
      navigationLayout: 'toolbar',
      resizableNavigation: true,
      requestedMode: 'run',
      runFallbackSlot: <h2>Explore examples</h2>,
      apiSlot: <h2>Generated SDK reference</h2>,
    });
    expect(
      screen.getByRole('heading', { name: 'Explore examples' })
    ).toBeTruthy();
    expect(document.querySelector('iframe')).toBeNull();
    const separator = screen.getByRole('separator', { name: 'Resize navigation' });
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator.getAttribute('aria-valuenow')).toBe('274');
    expect(screen.getByRole('heading', { name: 'Explore examples' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'API' }));
    expect(
      screen.getByRole('heading', { name: 'Generated SDK reference' })
    ).toBeTruthy();
    expect(screen.getByRole('separator', { name: 'Resize navigation' })).toBe(separator);
    expect(separator.getAttribute('aria-valuenow')).toBe('274');
    expect(screen.queryByText(/No API documentation extracted/)).toBeNull();
  });

  afterEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');
    runModeFault.shouldThrow = false;
    vi.restoreAllMocks();
  });

  it('offers modes and utility panels without a rail in the toolbar layout', async () => {
    const { container } = renderWorkspace({
      navigationLayout: 'toolbar',
      docsSlot: <p>Guide content</p>,
    });
    expect(container.querySelector('[data-control-plane-rail]')).toBeNull();
    const iframe = container.querySelector('iframe');
    fireEvent.click(screen.getByRole('button', { name: 'Code' }));
    expect(
      screen.getByRole('region', { name: 'Code workspace panel' })
    ).toBeTruthy();
    expect(container.querySelector('iframe')).toBe(iframe);
    fireEvent.click(screen.getByRole('button', { name: 'Workspace tools' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: 'Recheck' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload runtime' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open runtime' })).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'More runtime actions' })
    );
    expect(
      screen.getByRole('menuitem', { name: 'Copy diagnostics' })
    ).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Close Settings' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Workspace tools' })
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Docs' }));
    expect(screen.getByText('Guide content')).toBeTruthy();
    expect(container.querySelector('iframe')).toBe(iframe);
  });

  it('keeps the parent viewport geometry current without replacing its cross-origin frame', async () => {
    const viewport = Object.assign(new EventTarget(), {
      height: 714,
      pageTop: 0,
      offsetTop: 0,
      scale: 1,
    });
    vi.stubGlobal('visualViewport', viewport);
    const rendered = renderWorkspace({ requestedMode: 'run' });
    const style = document.documentElement.style;
    try {
      await waitFor(() =>
        expect(rendered.container.querySelector('iframe')).toBeTruthy()
      );
      const frame = rendered.container.querySelector('iframe');
      const src = frame?.getAttribute('src');
      expect(style.getPropertyValue('--workspace-viewport-height')).toBe(
        '714px'
      );
      Object.assign(viewport, { height: 377, pageTop: 299, offsetTop: 187 });
      viewport.dispatchEvent(new Event('resize'));
      expect(style.getPropertyValue('--workspace-viewport-height')).toBe(
        '377px'
      );
      expect(style.getPropertyValue('--workspace-viewport-page-top')).toBe(
        '299px'
      );
      expect(style.getPropertyValue('--workspace-viewport-offset-top')).toBe(
        '187px'
      );
      expect(rendered.container.querySelector('iframe')).toBe(frame);
      expect(frame?.getAttribute('src')).toBe(src);
      Object.assign(viewport, { scale: 2, height: 180, pageTop: 400 });
      viewport.dispatchEvent(new Event('scroll'));
      expect(style.getPropertyValue('--workspace-viewport-height')).toBe(
        '377px'
      );
      Object.assign(viewport, {
        scale: 1,
        height: 714,
        pageTop: 0,
        offsetTop: 0,
      });
      viewport.dispatchEvent(new Event('resize'));
      expect(style.getPropertyValue('--workspace-viewport-height')).toBe(
        '714px'
      );
    } finally {
      rendered.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('shares the viewport subscription across StrictMode roots and restores prior styles after the final release', () => {
    const viewport = Object.assign(new EventTarget(), {
      height: 714,
      pageTop: 0,
      offsetTop: 0,
      scale: 1,
    });
    vi.stubGlobal('visualViewport', viewport);
    const add = vi.spyOn(viewport, 'addEventListener');
    const style = document.documentElement.style;
    const height = '--workspace-viewport-height';
    const page = '--workspace-viewport-page-top';
    const offset = '--workspace-viewport-offset-top';
    style.setProperty(height, '900px', 'important');
    style.setProperty(page, '3px');
    const first = renderWorkspace({ strict: true });
    const second = renderWorkspace({});
    try {
      // StrictMode installs/releases once; simultaneous roots share the next binding.
      expect(add.mock.calls.filter(([kind]) => kind === 'resize')).toHaveLength(
        2
      );
      first.unmount();
      Object.assign(viewport, { height: 377, pageTop: 299, offsetTop: 187 });
      viewport.dispatchEvent(new Event('resize'));
      expect(style.getPropertyValue(height)).toBe('377px');
      style.setProperty(offset, '123px', 'important');
      second.unmount();
      expect(style.getPropertyValue(height)).toBe('900px');
      expect(style.getPropertyPriority(height)).toBe('important');
      expect(style.getPropertyValue(page)).toBe('3px');
      expect(style.getPropertyValue(offset)).toBe('123px');
      expect(style.getPropertyPriority(offset)).toBe('important');
      viewport.height = 200;
      viewport.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('scroll'));
      expect(style.getPropertyValue(height)).toBe('900px');
    } finally {
      first.unmount();
      second.unmount();
      [height, page, offset].forEach((name) => style.removeProperty(name));
      vi.unstubAllGlobals();
    }
  });

  it('uses the shell owning document viewport rather than the global document', () => {
    vi.stubGlobal(
      'visualViewport',
      Object.assign(new EventTarget(), {
        height: 999,
        pageTop: 0,
        offsetTop: 0,
        scale: 1,
      })
    );
    const owner = document.createElement('iframe');
    document.body.append(owner);
    const doc = owner.contentDocument!;
    const view = owner.contentWindow!;
    const viewport = Object.assign(new EventTarget(), {
      height: 500,
      pageTop: undefined,
      offsetTop: 20,
      scale: 1,
    });
    Object.defineProperty(view, 'visualViewport', {
      configurable: true,
      value: viewport,
    });
    Object.defineProperty(view, 'scrollY', { configurable: true, value: 30 });
    const rendered = renderWorkspace({ container: doc.body });
    try {
      expect(
        doc.documentElement.style.getPropertyValue(
          '--workspace-viewport-height'
        )
      ).toBe('500px');
      expect(
        doc.documentElement.style.getPropertyValue(
          '--workspace-viewport-page-top'
        )
      ).toBe('50px');
      expect(
        document.documentElement.style.getPropertyValue(
          '--workspace-viewport-height'
        )
      ).toBe('');
      Object.defineProperty(view, 'scrollY', { configurable: true, value: 60 });
      view.dispatchEvent(new Event('scroll'));
      expect(
        doc.documentElement.style.getPropertyValue(
          '--workspace-viewport-page-top'
        )
      ).toBe('80px');
    } finally {
      rendered.unmount();
      owner.remove();
      vi.unstubAllGlobals();
    }
  });

  it('leaves the CSS fallback and host styles intact when visualViewport is absent', () => {
    vi.stubGlobal('visualViewport', undefined);
    const style = document.documentElement.style;
    style.setProperty('--workspace-viewport-height', '80vh', 'important');
    const rendered = renderWorkspace({ strict: true });
    try {
      window.dispatchEvent(new Event('scroll'));
      expect(style.getPropertyValue('--workspace-viewport-height')).toBe(
        '80vh'
      );
      expect(style.getPropertyPriority('--workspace-viewport-height')).toBe(
        'important'
      );
    } finally {
      rendered.unmount();
      style.removeProperty('--workspace-viewport-height');
      vi.unstubAllGlobals();
    }
  });

  it.each(['rail', 'toolbar'] as const)('keeps %s navigation resizing opt-in and preserves the mounted runtime while resizing', async (navigationLayout) => {
    const plain = renderWorkspace({ navigationLayout });
    expect(
      screen.queryByRole('separator', { name: 'Resize navigation' })
    ).toBeNull();
    plain.unmount();
    const view = renderWorkspace({ navigationLayout, resizableNavigation: true });
    const frame = await waitFor(() => {
      const frame = view.container.querySelector('iframe');
      expect(frame).toBeTruthy();
      return frame;
    });
    const separator = screen.getByRole('separator', {
      name: 'Resize navigation',
    });
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(
      view.container
        .querySelector<HTMLElement>('[data-workspace-shell]')
        ?.style.getPropertyValue('--workspace-navigation-width')
    ).toBe(navigationLayout === 'toolbar' ? '274px' : '338px');
    fireEvent.keyDown(separator, { key: 'Home' });
    expect(
      view.container
        .querySelector<HTMLElement>('[data-workspace-shell]')
        ?.style.getPropertyValue('--workspace-navigation-width')
    ).toBe(navigationLayout === 'toolbar' ? '264px' : '328px');
    expect(view.container.querySelector('iframe')).toBe(frame);
    for (const mode of ['Docs', 'Code', 'API']) {
      expect(screen.getByRole('button', { name: mode })).toBeTruthy();
    }
  });

  it('keeps one Run iframe node mounted through modes and utility switches', async () => {
    const rendered = renderWorkspace({
      requestedMode: 'docs',
      docsSlot: <article>Server docs</article>,
    });

    await waitFor(() =>
      expect(rendered.container.querySelector('iframe')).toBeTruthy()
    );
    const frame = rendered.container.querySelector('iframe');
    expect(frame).toBeTruthy();
    expect(screen.getByText('Server docs')).toBeTruthy();

    for (const mode of ['Run', 'Code', 'API', 'Docs'] as WorkspaceMode[]) {
      fireEvent.click(
        screen.getByRole('button', {
          name: mode === 'Run' ? RUN_RAIL_ITEM : mode,
        })
      );
      expect(rendered.container.querySelector('iframe')).toBe(frame);
    }

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(rendered.container.querySelector('iframe')).toBe(frame);
  });

  it('disposes the old frame for a target change without placing the target or key in the replacement frame', async () => {
    const customUrl = 'https://api.example.test/langgraph';
    const secretKey = 'test-key-redact-me';
    const rendered = renderWorkspace({
      requestedMode: 'docs',
      docsSlot: <article>Server docs</article>,
    });
    await waitFor(() =>
      expect(rendered.container.querySelector('iframe')).toBeTruthy()
    );
    const oldFrame = rendered.container.querySelector('iframe');

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Custom LangSmith' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'API URL' }), {
      target: { value: customUrl },
    });
    fireEvent.input(screen.getByLabelText('API key'), {
      target: { value: secretKey },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use custom target' }));

    await waitFor(() =>
      expect(rendered.container.querySelector('iframe')).not.toBe(oldFrame)
    );
    const replacement = rendered.container.querySelector('iframe');
    expect(oldFrame?.isConnected).toBe(false);
    expect(replacement?.outerHTML).not.toContain(customUrl);
    expect(replacement?.outerHTML).not.toContain(secretKey);
    expect(replacement?.getAttribute('referrerpolicy')).toBe('origin');

    const childNonce = 'workspace-child-nonce';
    const frameWindow = replacement?.contentWindow ?? null;
    fireEvent(
      window,
      new MessageEvent('message', {
        source: frameWindow,
        origin: 'https://runtime.example.test',
        data: {
          type: 'tplane:runtime-child-ready',
          version: RUNTIME_CONFIGURATION_VERSION,
          nonce: childNonce,
        },
      })
    );
    fireEvent(
      window,
      new MessageEvent('message', {
        source: frameWindow,
        origin: 'https://runtime.example.test',
        data: {
          type: 'tplane:runtime-configuration-failed',
          version: RUNTIME_CONFIGURATION_VERSION,
          nonce: childNonce,
          generation: 1,
          code: 'incompatible_bridge',
        },
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Docs' }));
    expect(screen.getByText('Server docs')).toBeTruthy();
    expect(screen.getByText('Incompatible runtime')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByText(customUrl)).toBeTruthy();
    expect(document.body.textContent).not.toContain(secretKey);
  });

  it('installs the parent message listener before assigning the iframe navigation URL', async () => {
    const addEventListener = vi.spyOn(window, 'addEventListener');
    const setAttribute = vi.spyOn(Element.prototype, 'setAttribute');
    const rendered = renderWorkspace({ requestedMode: 'docs' });
    await waitFor(() =>
      expect(rendered.container.querySelector('iframe')).toBeTruthy()
    );

    const messageListenerCall = addEventListener.mock.calls.findIndex(
      ([type]) => type === 'message'
    );
    const iframeSrcCall = setAttribute.mock.calls.findIndex(
      ([name], index) =>
        name === 'src' &&
        setAttribute.mock.instances[index] instanceof HTMLIFrameElement
    );
    expect(messageListenerCall).toBeGreaterThanOrEqual(0);
    expect(iframeSrcCall).toBeGreaterThanOrEqual(0);
    expect(
      addEventListener.mock.invocationCallOrder[messageListenerCall]
    ).toBeLessThan(
      setAttribute.mock.invocationCallOrder[iframeSrcCall] ?? Infinity
    );
  });

  it('exposes focusable panel headings without remounting Run', async () => {
    const rendered = renderWorkspace({ requestedMode: 'run' });
    const runTarget = await screen.findByRole('heading', {
      name: 'LangGraph Streaming Run',
    });
    const frame = rendered.container.querySelector('iframe');
    expect(runTarget.tabIndex).toBe(-1);
    expect(runTarget.getAttribute('data-workspace-panel-target')).toBe('Run');

    fireEvent.click(screen.getByRole('button', { name: 'Code' }));
    const codeTarget = screen.getByRole('heading', {
      name: 'LangGraph Streaming Code',
    });
    expect(codeTarget.tabIndex).toBe(-1);
    expect(codeTarget.getAttribute('data-workspace-panel-target')).toBe('Code');
    await waitFor(() => expect(document.activeElement).toBe(codeTarget));
    expect(rendered.container.querySelector('iframe')).toBe(frame);

    fireEvent.click(screen.getByRole('button', { name: 'Docs' }));
    const docsTarget = screen.getByRole('heading', {
      name: 'LangGraph Streaming Docs',
    });
    expect(docsTarget.tabIndex).toBe(-1);
    await waitFor(() => expect(document.activeElement).toBe(docsTarget));
    expect(rendered.container.querySelector('iframe')).toBe(frame);
  });

  it('implements mobile, tablet rail/context, and desktop shell breakpoints', () => {
    const sourceRoot = process.cwd().endsWith('/libs/workspace-react')
      ? process.cwd()
      : resolve(process.cwd(), 'libs/workspace-react');
    const css = readFileSync(
      resolve(sourceRoot, 'src/styles/workspace.css'),
      'utf8'
    );

    expect(css).toMatch(
      /@media \(min-width: 48rem\) and \(max-width: 63\.999rem\)[\s\S]*grid-template-columns:\s*56px minmax\(0, 1fr\)/
    );
    expect(css).toMatch(
      /@media \(min-width: 64rem\)[\s\S]*grid-template-columns:\s*var\(--workspace-navigation-width, 328px\) minmax\(0, 1fr\)/
    );
    expect(css).toMatch(
      /\.workspace-navigation-resize\s*\{[^}]*display:\s*none/
    );
    expect(css).toMatch(
      /@media \(min-width: 64rem\)[\s\S]*\.workspace-navigation-resize\s*\{[^}]*display:\s*flex/
    );
    expect(css).toContain(
      'calc(var(--workspace-navigation-width, 328px) - 56px)'
    );
    expect(css).toContain('.workspace-tablet-context-trigger');
    expect(css).toContain('.workspace-tablet-context-surface');
    expect(css).toMatch(
      /\.workspace-tablet-context-surface \.workspace-control-plane\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/
    );
  });

  it('uses neutral Workspace landmark and modal labels by default', () => {
    renderWorkspace({ docsSlot: <article>Server docs</article> });
    expect(screen.getByRole('main', { name: 'Workspace shell' })).toBeTruthy();
    expect(
      screen.getByRole('navigation', { name: 'Workspace modes' })
    ).toBeTruthy();
    expect(
      screen.getByRole('complementary', { name: 'Workspace context' })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(
      screen.getByRole('dialog', { name: 'Workspace control plane' })
    ).toBeTruthy();
  });

  it('lets an embedding host use a labelled region instead of a nested main', () => {
    renderWorkspace({
      docsSlot: <article>Server docs</article>,
      rootElement: 'section',
    });

    expect(
      screen.getByRole('region', { name: 'Workspace shell' })
    ).toBeTruthy();
    expect(screen.queryByRole('main', { name: 'Workspace shell' })).toBeNull();
  });

  it('accepts product labels and neutral header actions from a host adapter', () => {
    const ProductWorkspaceShell = WorkspaceShell as React.ComponentType<
      React.ComponentProps<typeof WorkspaceShell> & {
        modeNavigationLabel: string;
        contextPaneLabel: string;
        mobileDialogLabel: string;
        mobileTitle: string;
        headerActions: React.ReactNode;
      }
    >;
    render(
      <RuntimeTargetProvider>
        <WorkspaceProvider
          resolution={resolution}
          presentation={presentation}
          contentBundle={contentBundle}
          routePath={identity.docsPath}
          requestedMode="docs"
          pushIdentity={vi.fn()}
          pushMode={vi.fn()}
          replaceMode={vi.fn()}
          getSessionId={() => 'session-1'}
        >
          <ProductWorkspaceShell
            navigationTree={[]}
            manifest={cockpitManifest}
            modeNavigationLabel="Product modes"
            contextPaneLabel="Product context"
            mobileDialogLabel="Product control plane"
            mobileTitle="Product"
            headerActions={<a href="https://example.test/docs">Read docs</a>}
          />
        </WorkspaceProvider>
      </RuntimeTargetProvider>
    );

    expect(
      screen.getByRole('navigation', { name: 'Product modes' })
    ).toBeTruthy();
    expect(
      screen.getByRole('complementary', { name: 'Product context' })
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Read docs' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(
      screen.getByRole('dialog', { name: 'Product control plane' })
    ).toBeTruthy();
    expect(screen.getByText('Product')).toBeTruthy();
  });

  it('renders nothing in the Docs panel when no server slot is present', () => {
    renderWorkspace({ requestedMode: 'docs' });
    const panel = screen.getByRole('region', { name: 'Docs workspace panel' });
    expect(panel.querySelector('h1')).toBeNull();
    // A crashed panel falls back to WorkspacePanelBoundary's
    // role="alert" markup; assert that fallback never fired.
    expect(panel.querySelector('[role="alert"]')).toBeNull();
    // With no docsSlot, the panel should render only its heading text
    // ("<entryTitle> Docs") and nothing else -- distinguishing a
    // cleanly empty panel from one that silently swallowed a crash.
    expect(panel.textContent?.trim()).toBe(`${identity.title} Docs`);
  });

  it('does not mount Run for docs-only or mapped identities without Run', () => {
    const docsOnly: WorkspaceResolution = {
      kind: 'docs-only',
      docsPath: '/docs/example',
      title: 'Example docs',
      unavailableReason: 'no-workspace-capability',
    };
    const docsOnlyPresentation: WorkspacePresentation = {
      kind: 'docs-only',
      docsPath: '/docs/example',
      title: 'Example docs',
      runnable: false,
    };
    const rendered = renderWorkspace({
      resolution: docsOnly,
      presentation: docsOnlyPresentation,
      contentBundle: { ...contentBundle, runtimeUrl: null },
      docsSlot: <article>Docs-only article</article>,
    });
    expect(rendered.container.querySelector('iframe')).toBeNull();

    const limitedIdentity = {
      ...identity,
      availableModes: ['Docs', 'Code'] as const,
    };
    rendered.rerender(
      <RuntimeTargetProvider>
        <WorkspaceProvider
          resolution={{ kind: 'mapped', identity: limitedIdentity }}
          presentation={{ ...presentation, identity: limitedIdentity }}
          contentBundle={contentBundle}
          routePath={limitedIdentity.docsPath}
          requestedMode="docs"
          docsSlot={<article>Limited article</article>}
          pushIdentity={vi.fn()}
          pushMode={vi.fn()}
          replaceMode={vi.fn()}
          getSessionId={() => 'session-1'}
        >
          <WorkspaceShell navigationTree={[]} manifest={cockpitManifest} />
        </WorkspaceProvider>
      </RuntimeTargetProvider>
    );
    expect(rendered.container.querySelector('iframe')).toBeNull();
  });

  it('renders disabled modes with explicit mode-specific accessible reasons', () => {
    const docsOnly: WorkspaceResolution = {
      kind: 'docs-only',
      docsPath: '/docs/example',
      title: 'Example docs',
      unavailableReason: 'no-workspace-capability',
    };
    renderWorkspace({
      resolution: docsOnly,
      presentation: {
        kind: 'docs-only',
        docsPath: '/docs/example',
        title: 'Example docs',
        runnable: false,
      },
      contentBundle: { ...contentBundle, runtimeUrl: null },
      docsSlot: <article>Docs-only article</article>,
    });

    for (const mode of ['Run', 'Code', 'API'] as const) {
      const reason = `${mode} is unavailable because this page has no workspace capability.`;
      const control = screen.getByRole('button', {
        name: mode,
        description: reason,
      });
      expect(control.getAttribute('aria-disabled')).toBe('true');
      expect((control as HTMLButtonElement).disabled).toBe(false);
      control.focus();
      expect(document.activeElement).toBe(control);
      fireEvent.click(control);
      expect(
        screen
          .getByRole('button', { name: 'Docs' })
          .getAttribute('aria-pressed')
      ).toBe('true');
      const descriptionId = control.getAttribute('aria-describedby');
      expect(descriptionId).toBeTruthy();
      expect(document.getElementById(descriptionId ?? '')?.textContent).toBe(
        reason
      );
    }
    expect(
      (screen.getByRole('button', { name: 'Docs' }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });

  it('describes unavailable modes for a mapped limited-mode identity', () => {
    const limitedIdentity = {
      ...identity,
      title: 'Limited streaming',
      availableModes: ['Docs', 'Code'] as const,
    };
    renderWorkspace({
      resolution: { kind: 'mapped', identity: limitedIdentity },
      presentation: { ...presentation, identity: limitedIdentity },
      docsSlot: <article>Limited article</article>,
    });

    expect(
      (screen.getByRole('button', { name: 'Code' }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
    for (const mode of ['Run', 'API'] as const) {
      const control = screen.getByRole('button', { name: mode });
      expect(control.getAttribute('aria-disabled')).toBe('true');
      expect((control as HTMLButtonElement).disabled).toBe(false);
      expect(
        document.getElementById(control.getAttribute('aria-describedby') ?? '')
          ?.textContent
      ).toBe(`${mode} is unavailable for Limited streaming.`);
    }
  });

  it('styles unavailable modes without pointer or hover affordances', () => {
    const sourceRoot = process.cwd().endsWith('/libs/workspace-react')
      ? process.cwd()
      : resolve(process.cwd(), 'libs/workspace-react');
    const css = readFileSync(
      resolve(sourceRoot, 'src/styles/workspace.css'),
      'utf8'
    );
    expect(css).toMatch(
      /\[data-control-plane-rail-item\]\[aria-disabled=['"]true['"]\]/
    );
    expect(css).toMatch(/:not\(\[aria-disabled=['"]true['"]\]\):hover/);
  });

  it('recovers a failed persistent Run panel after runtime reload', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    runModeFault.shouldThrow = true;
    const rendered = renderWorkspace({ requestedMode: 'run' });
    expect(screen.getByRole('alert').textContent).toContain(
      'Run panel unavailable.'
    );

    runModeFault.shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Reload runtime' }));
    await waitFor(() =>
      expect(rendered.container.querySelector('iframe')).toBeTruthy()
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('contains a panel render failure without replacing the workspace shell', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function BrokenDocs() {
      throw new Error('sensitive panel failure');
    }
    renderWorkspace({ requestedMode: 'docs', docsSlot: <BrokenDocs /> });

    expect(screen.getByRole('main', { name: 'Workspace shell' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(
      'Docs panel unavailable.'
    );
    expect(screen.getByRole('button', { name: RUN_RAIL_ITEM })).toBeTruthy();
  });
});

describe('WorkspaceShell header trail', () => {
  afterEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('keeps the derived mono label when no host supplies a trail', () => {
    renderWorkspace({ requestedMode: 'docs' });

    // Cockpit passes no trail, so nothing about its header may change.
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull();
    expect(
      screen.getByText('LangGraph / Core Capabilities / Streaming')
    ).toBeTruthy();
  });

  it('renders a supplied trail as a real breadcrumb', () => {
    renderWorkspace({
      requestedMode: 'docs',
      contextTrail: [
        { label: 'Docs', href: '/docs' },
        {
          label: 'AG-UI',
          href: '/docs/angular/ag-ui/getting-started/introduction',
        },
        { label: 'Getting Started' },
        { label: 'Introduction' },
      ],
    });

    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(nav).toBeTruthy();

    // Rungs with an href link; rungs without are plain text, because no
    // section index route exists to point the section rung at.
    expect(
      within(nav).getByRole('link', { name: 'Docs' }).getAttribute('href')
    ).toBe('/docs');
    expect(
      within(nav).getByRole('link', { name: 'AG-UI' }).getAttribute('href')
    ).toBe('/docs/angular/ag-ui/getting-started/introduction');
    expect(
      within(nav).queryByRole('link', { name: 'Getting Started' })
    ).toBeNull();

    // The last rung is the current page and is never a link.
    const current = within(nav).getByText('Introduction');
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(current.tagName).not.toBe('A');

    // The derived label must not also be present — that was the duplication.
    expect(
      screen.queryByText('LangGraph / Core Capabilities / Streaming')
    ).toBeNull();
  });

  it('never links the last rung, even when it carries an href', () => {
    renderWorkspace({
      requestedMode: 'docs',
      contextTrail: [
        { label: 'Docs', href: '/docs' },
        {
          label: 'Introduction',
          href: '/docs/angular/ag-ui/getting-started/introduction',
        },
      ],
    });

    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    // You are already on this page; linking it is a dead control.
    expect(
      within(nav).queryByRole('link', { name: 'Introduction' })
    ).toBeNull();
    const current = within(nav).getByText('Introduction');
    expect(current.tagName).not.toBe('A');
    expect(current.getAttribute('aria-current')).toBe('page');
    // The earlier rung still links, so this is not passing because nothing rendered.
    expect(
      within(nav).getByRole('link', { name: 'Docs' }).getAttribute('href')
    ).toBe('/docs');
  });

  it('renders a crumb icon inside that rung, hidden from assistive tech', () => {
    renderWorkspace({
      requestedMode: 'docs',
      contextTrail: [
        { label: 'Docs', href: '/docs' },
        {
          label: 'AG-UI',
          href: '/docs/angular/ag-ui/getting-started/introduction',
          icon: <svg data-testid="library-mark" />,
        },
        { label: 'Introduction' },
      ],
    });

    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const agUiLink = within(nav).getByRole('link', { name: 'AG-UI' });
    const mark = within(agUiLink).getByTestId('library-mark');
    expect(mark.parentElement?.hasAttribute('data-workspace-trail-icon')).toBe(
      true
    );
    expect(mark.parentElement?.getAttribute('aria-hidden')).toBe('true');

    // A rung with no icon renders no icon wrapper at all.
    const docsLink = within(nav).getByRole('link', { name: 'Docs' });
    expect(docsLink.querySelector('[data-workspace-trail-icon]')).toBeNull();
  });
});
