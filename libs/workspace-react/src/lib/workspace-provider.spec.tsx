/** @vitest-environment jsdom */
import React, { act } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  WorkspaceIdentity,
  WorkspaceResolution,
} from '@threadplane/cockpit-registry';
import type {
  ContentBundle,
  WorkspacePresentation,
} from '@threadplane/cockpit-shell';
import {
  WorkspaceProvider,
  useWorkspace,
  type WorkspaceProviderProps,
} from './workspace-provider';
import { RuntimeTargetProvider } from './runtime/runtime-target-provider';
import {
  useAgUiRuntimeTarget,
  useLangGraphRuntimeTarget,
} from './runtime/runtime-target-provider';

const identity: WorkspaceIdentity = {
  id: 'langgraph:core-capabilities:streaming:overview:python',
  product: 'langgraph',
  section: 'core-capabilities',
  topic: 'streaming',
  page: 'overview',
  language: 'python',
  title: 'Streaming',
  docsPath: '/docs/angular/langgraph/guides/streaming',
  runtimeAdapter: 'langgraph',
  availableModes: ['Docs', 'Run', 'Code', 'API'],
};

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
  codeFiles: { 'example.ts': '<pre>source</pre>' },
  codeSources: { 'example.ts': 'source' },
  promptFiles: {},
  runtimeUrl: null,
  docSections: [],
};

function Readout() {
  const workspace = useWorkspace();
  return (
    <div>
      <output aria-label="Active mode">{workspace.activeMode}</output>
      <output aria-label="Active utility">
        {workspace.activeUtility ?? 'none'}
      </output>
      <output aria-label="Activity count">{workspace.events.length}</output>
      <button type="button" onClick={() => workspace.selectMode('Run')}>
        Select Run
      </button>
      <button
        type="button"
        onClick={() => workspace.setActiveUtility('settings')}
      >
        Open Settings
      </button>
      <button
        type="button"
        onClick={() =>
          workspace.hostServices.navigate({
            path: identity.docsPath,
            restoreFocus: 'mobile-navigation-trigger',
          })
        }
      >
        Navigate with focus
      </button>
    </div>
  );
}

function RuntimeGenerationReadout() {
  const workspace = useWorkspace();
  return (
    <output aria-label="Runtime generations">
      {JSON.stringify({
        adapter:
          workspace.resolution.kind === 'mapped'
            ? workspace.resolution.identity.runtimeAdapter
            : 'none',
        phase: workspace.runtimeController.snapshot.phase,
        targetGeneration: workspace.runtimeController.snapshot.targetGeneration,
        frameGeneration: workspace.runtimeController.snapshot.frameGeneration,
        routeGeneration: workspace.runtimeController.snapshot.routeGeneration,
      })}
    </output>
  );
}

function RuntimeTargetControls() {
  const agUi = useAgUiRuntimeTarget();
  const langgraph = useLangGraphRuntimeTarget();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          langgraph.applyCustomTarget(
            'https://api.example.test/langgraph',
            'test-key-redact-me'
          )
        }
      >
        Apply LangGraph
      </button>
      <button
        type="button"
        onClick={() =>
          agUi.applyCustomTarget('https://agents.example.test/ag-ui')
        }
      >
        Apply AG-UI
      </button>
    </>
  );
}

type ProviderHarnessProps = Omit<WorkspaceProviderProps, 'children'>;

function TestedWorkspaceProvider(props: WorkspaceProviderProps) {
  return (
    <RuntimeTargetProvider>
      <WorkspaceProvider {...props} />
    </RuntimeTargetProvider>
  );
}

const providerProps = (
  overrides: Partial<ProviderHarnessProps> = {}
): ProviderHarnessProps => ({
  resolution,
  presentation,
  contentBundle,
  routePath: identity.docsPath,
  requestedMode: 'code',
  docsSlot: <article>Server docs</article>,
  pushIdentity: vi.fn(),
  pushMode: vi.fn(),
  replaceMode: vi.fn(),
  getSessionId: () => 'session-1',
  ...overrides,
});

describe('WorkspaceProvider route mode ownership', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', identity.docsPath);
  });

  it('initializes a syntactically valid and available query mode', () => {
    render(
      <TestedWorkspaceProvider {...providerProps()}>
        <Readout />
      </TestedWorkspaceProvider>
    );

    expect(screen.getByLabelText('Active mode').textContent).toBe('Code');
  });

  it('replaces invalid and valid-but-unavailable modes with the truthful route default', async () => {
    const limitedIdentity: WorkspaceIdentity = {
      ...identity,
      availableModes: ['Docs', 'Code'],
    };
    const limitedResolution: WorkspaceResolution = {
      kind: 'mapped',
      identity: limitedIdentity,
    };
    const replaceMode = vi.fn();
    const rendered = render(
      <TestedWorkspaceProvider
        {...providerProps({
          resolution: limitedResolution,
          presentation: { ...presentation, identity: limitedIdentity },
          requestedMode: 'run',
          replaceMode,
        })}
      >
        <Readout />
      </TestedWorkspaceProvider>
    );

    expect(screen.getByLabelText('Active mode').textContent).toBe('Docs');
    await waitFor(() => expect(replaceMode).toHaveBeenCalledWith('Docs'));

    replaceMode.mockClear();
    rendered.rerender(
      <TestedWorkspaceProvider
        {...providerProps({
          resolution: limitedResolution,
          presentation: { ...presentation, identity: limitedIdentity },
          requestedMode: 'preview',
          replaceMode,
        })}
      >
        <Readout />
      </TestedWorkspaceProvider>
    );
    await waitFor(() => expect(replaceMode).toHaveBeenCalledWith('Docs'));
  });

  it('restores modes from route updates and browser Back/Forward events', async () => {
    const rendered = render(
      <TestedWorkspaceProvider {...providerProps({ requestedMode: 'code' })}>
        <Readout />
      </TestedWorkspaceProvider>
    );
    expect(screen.getByLabelText('Active mode').textContent).toBe('Code');

    rendered.rerender(
      <TestedWorkspaceProvider {...providerProps({ requestedMode: 'docs' })}>
        <Readout />
      </TestedWorkspaceProvider>
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Active mode').textContent).toBe('Docs')
    );

    act(() => {
      window.history.replaceState({}, '', `${identity.docsPath}?mode=api`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() =>
      expect(screen.getByLabelText('Active mode').textContent).toBe('API')
    );
  });

  it('normalizes repeated popstate mode values through the route default', async () => {
    const replaceMode = vi.fn();
    render(
      <TestedWorkspaceProvider
        {...providerProps({
          routePath: identity.docsPath,
          requestedMode: 'code',
          replaceMode,
        })}
      >
        <Readout />
      </TestedWorkspaceProvider>
    );
    expect(screen.getByLabelText('Active mode').textContent).toBe('Code');

    act(() => {
      window.history.replaceState(
        {},
        '',
        `${identity.docsPath}?mode=api&mode=docs`
      );
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await waitFor(() =>
      expect(screen.getByLabelText('Active mode').textContent).toBe('Docs')
    );
    expect(replaceMode).toHaveBeenCalledWith('Docs');
  });

  it('pushes explicit user mode changes, records Activity, and preserves the mode through utility switches', () => {
    const pushMode = vi.fn();
    const replaceMode = vi.fn();
    const trackModeChange = vi.fn();
    render(
      <TestedWorkspaceProvider
        {...providerProps({
          requestedMode: 'docs',
          pushMode,
          replaceMode,
          trackModeChange,
        })}
      >
        <Readout />
      </TestedWorkspaceProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select Run' }));
    expect(screen.getByLabelText('Active mode').textContent).toBe('Run');
    expect(pushMode).toHaveBeenCalledWith('Run');
    expect(replaceMode).not.toHaveBeenCalled();
    expect(trackModeChange).toHaveBeenCalledWith({
      capability: identity.topic,
      fromMode: 'Docs',
      toMode: 'Run',
    });
    expect(screen.getByLabelText('Activity count').textContent).toBe('1');

    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(screen.getByLabelText('Active utility').textContent).toBe(
      'settings'
    );
    expect(screen.getByLabelText('Active mode').textContent).toBe('Run');
  });

  it('forwards focus restoration intent to the identity navigation adapter', () => {
    const pushIdentity = vi.fn();
    render(
      <TestedWorkspaceProvider {...providerProps({ pushIdentity })}>
        <Readout />
      </TestedWorkspaceProvider>
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Navigate with focus' })
    );
    expect(pushIdentity).toHaveBeenCalledWith(identity.docsPath, {
      restoreFocus: 'mobile-navigation-trigger',
    });
  });

  it('defers a cross-identity popstate until the host provides the destination resolution', async () => {
    const limitedIdentity: WorkspaceIdentity = {
      ...identity,
      availableModes: ['Docs'],
    };
    const destinationIdentity: WorkspaceIdentity = {
      ...identity,
      id: 'langgraph:core-capabilities:memory:overview:python',
      topic: 'memory',
      title: 'Memory',
      docsPath: '/docs/angular/langgraph/guides/memory',
      availableModes: ['Docs', 'Run'],
    };
    const replaceMode = vi.fn();
    const rendered = render(
      <TestedWorkspaceProvider
        {...providerProps({
          resolution: { kind: 'mapped', identity: limitedIdentity },
          presentation: { ...presentation, identity: limitedIdentity },
          requestedMode: 'docs',
          replaceMode,
        })}
      >
        <Readout />
      </TestedWorkspaceProvider>
    );

    act(() => {
      window.history.replaceState(
        {},
        '',
        `${destinationIdentity.docsPath}?mode=run`
      );
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByLabelText('Active mode').textContent).toBe('Docs');
    expect(replaceMode).not.toHaveBeenCalled();

    rendered.rerender(
      <TestedWorkspaceProvider
        {...providerProps({
          resolution: { kind: 'mapped', identity: destinationIdentity },
          presentation: { ...presentation, identity: destinationIdentity },
          routePath: destinationIdentity.docsPath ?? '',
          requestedMode: 'run',
          replaceMode,
        })}
      >
        <Readout />
      </TestedWorkspaceProvider>
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Active mode').textContent).toBe('Run')
    );
    expect(replaceMode).not.toHaveBeenCalled();
  });

  it('selects the active adapter slot while the controller alone owns target generation', () => {
    const runtimeContent = {
      ...contentBundle,
      runtimeUrl: 'https://runtime.example.test/frame',
    };
    const renderTree = (nextResolution: WorkspaceResolution) => (
      <RuntimeTargetProvider>
        <RuntimeTargetControls />
        <WorkspaceProvider
          {...providerProps({
            resolution: nextResolution,
            presentation: {
              ...presentation,
              identity:
                nextResolution.kind === 'mapped'
                  ? nextResolution.identity
                  : identity,
            },
            contentBundle: runtimeContent,
          })}
        >
          <RuntimeGenerationReadout />
        </WorkspaceProvider>
      </RuntimeTargetProvider>
    );
    const rendered = render(renderTree(resolution));
    const readGenerations = () =>
      JSON.parse(
        screen.getByLabelText('Runtime generations').textContent ?? ''
      );

    expect(readGenerations()).toMatchObject({
      adapter: 'langgraph',
      phase: 'configuring',
      targetGeneration: 0,
      frameGeneration: 0,
      routeGeneration: 0,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Apply AG-UI' }));
    expect(readGenerations()).toMatchObject({
      adapter: 'langgraph',
      targetGeneration: 0,
      frameGeneration: 0,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Apply LangGraph' }));
    expect(readGenerations()).toMatchObject({
      adapter: 'langgraph',
      targetGeneration: 1,
      frameGeneration: 1,
      routeGeneration: 0,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply LangGraph' }));
    expect(readGenerations().targetGeneration).toBe(1);

    const agUiIdentity: WorkspaceIdentity = {
      ...identity,
      id: 'ag-ui:agents:streaming:overview:python',
      product: 'ag-ui',
      runtimeAdapter: 'ag-ui',
    };
    rendered.rerender(renderTree({ kind: 'mapped', identity: agUiIdentity }));
    expect(readGenerations()).toMatchObject({
      adapter: 'ag-ui',
      targetGeneration: 2,
      frameGeneration: 2,
      routeGeneration: 0,
    });
    expect(screen.getByLabelText('Runtime generations').outerHTML).not.toMatch(
      /api\.example\.test|agents\.example\.test|test-key-redact-me/i
    );
  });
});
