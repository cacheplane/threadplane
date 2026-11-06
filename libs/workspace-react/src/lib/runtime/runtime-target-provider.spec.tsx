/** @vitest-environment jsdom */
import React, { useEffect, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeAdapter } from '@threadplane/cockpit-registry';
import {
  RuntimeTargetProvider,
  useAgUiRuntimeTarget,
  useEffectiveRuntimeTarget,
  useLangGraphRuntimeTarget,
  useRuntimeTargetView,
} from './runtime-target-provider';
import * as publicWorkspaceApi from '../../index';

const endpoint = 'https://agents.example.test/ag-ui';
const apiUrl = 'https://api.example.test/langgraph/';
const apiKey = 'test-key-redact-me';

function Probe({ adapter = 'langgraph' }: { adapter?: RuntimeAdapter }) {
  const agUi = useAgUiRuntimeTarget();
  const langgraph = useLangGraphRuntimeTarget();
  const view = useRuntimeTargetView(adapter);
  const [draft, setDraft] = useState('');

  useEffect(
    () =>
      adapter === 'none'
        ? undefined
        : adapter === 'ag-ui'
        ? agUi.registerDraftClear(() => setDraft(''))
        : langgraph.registerDraftClear(() => setDraft('')),
    [adapter, agUi.registerDraftClear, langgraph.registerDraftClear]
  );

  return (
    <div>
      <output data-testid="ag-ui-kind">{agUi.view.kind}</output>
      <output data-testid="langgraph-kind">{langgraph.view.kind}</output>
      <output data-testid="view">{JSON.stringify(view)}</output>
      <output data-testid="public-controls">
        {JSON.stringify({ agUi, langgraph })}
      </output>
      <input
        aria-label="Local draft"
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
      />
      <button onClick={() => agUi.applyCustomTarget(endpoint)}>
        Apply AG-UI
      </button>
      <button onClick={() => langgraph.applyCustomTarget(apiUrl, apiKey)}>
        Apply LangGraph
      </button>
      <button onClick={() => agUi.useSharedDevelopment()}>Clear AG-UI</button>
      <button onClick={() => langgraph.useSharedDevelopment()}>
        Clear LangGraph
      </button>
    </div>
  );
}

const renderProvider = (adapter: RuntimeAdapter = 'langgraph') =>
  render(
    <RuntimeTargetProvider>
      <Probe adapter={adapter} />
    </RuntimeTargetProvider>
  );

describe('RuntimeTargetProvider', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/docs/angular/langgraph/guides/streaming');
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes independent AG-UI and LangGraph slots to Shared', () => {
    renderProvider();

    expect(screen.getByTestId('ag-ui-kind').textContent).toBe('shared');
    expect(screen.getByTestId('langgraph-kind').textContent).toBe('shared');
    expect(screen.getByTestId('view').textContent).toContain(
      'Shared development'
    );
  });

  it('validates and atomically applies only the selected adapter slot', () => {
    let serializedApplyResult = '';
    function AtomicProbe() {
      const agUi = useAgUiRuntimeTarget();
      const langgraph = useLangGraphRuntimeTarget();
      return (
        <>
          <output data-testid="atomic-ag-ui">{agUi.view.kind}</output>
          <output data-testid="atomic-langgraph">{langgraph.view.kind}</output>
          <button
            onClick={() => {
              const result = langgraph.applyCustomTarget(
                'https://api.example.test/working',
                apiKey
              );
              if (!result.ok) throw new Error('Expected a valid target');
              serializedApplyResult = JSON.stringify(result);
            }}
          >
            Apply valid
          </button>
          <button
            onClick={() =>
              langgraph.applyCustomTarget('https://bad.example.test/?key=1', '')
            }
          >
            Apply invalid
          </button>
        </>
      );
    }
    render(
      <RuntimeTargetProvider>
        <AtomicProbe />
      </RuntimeTargetProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Apply valid' }));
    expect(screen.getByTestId('atomic-langgraph').textContent).toBe(
      'langsmith'
    );
    expect(screen.getByTestId('atomic-ag-ui').textContent).toBe('shared');
    expect(serializedApplyResult).toBe('{"ok":true}');
    expect(serializedApplyResult).not.toContain(apiKey);

    fireEvent.click(screen.getByRole('button', { name: 'Apply invalid' }));
    expect(screen.getByTestId('atomic-langgraph').textContent).toBe(
      'langsmith'
    );
    expect(screen.getByTestId('atomic-ag-ui').textContent).toBe('shared');
  });

  it('retains same-adapter values through every mode and route changes', () => {
    const view = renderProvider('langgraph');
    fireEvent.click(screen.getByRole('button', { name: 'Apply LangGraph' }));

    for (const suffix of ['', '?mode=run', '?mode=code', '?mode=api']) {
      window.history.pushState(
        {},
        '',
        `/docs/angular/langgraph/guides/streaming${suffix}`
      );
      view.rerender(
        <RuntimeTargetProvider>
          <Probe adapter="langgraph" />
        </RuntimeTargetProvider>
      );
      expect(screen.getByTestId('langgraph-kind').textContent).toBe(
        'langsmith'
      );
    }

    window.history.pushState({}, '', '/docs/angular/langgraph/guides/persistence');
    view.rerender(
      <RuntimeTargetProvider>
        <Probe adapter="langgraph" />
      </RuntimeTargetProvider>
    );
    expect(screen.getByTestId('langgraph-kind').textContent).toBe('langsmith');
  });

  it('selects independent slots during cross-adapter navigation', () => {
    const view = renderProvider('langgraph');
    fireEvent.click(screen.getByRole('button', { name: 'Apply LangGraph' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply AG-UI' }));

    view.rerender(
      <RuntimeTargetProvider>
        <Probe adapter="ag-ui" />
      </RuntimeTargetProvider>
    );
    expect(screen.getByTestId('view').textContent).toContain('Custom AG-UI');

    view.rerender(
      <RuntimeTargetProvider>
        <Probe adapter="langgraph" />
      </RuntimeTargetProvider>
    );
    expect(screen.getByTestId('view').textContent).toContain(
      'Custom LangSmith'
    );
  });

  it('clears only the requested adapter slot', () => {
    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'Apply LangGraph' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply AG-UI' }));

    fireEvent.click(screen.getByRole('button', { name: 'Clear AG-UI' }));

    expect(screen.getByTestId('ag-ui-kind').textContent).toBe('shared');
    expect(screen.getByTestId('langgraph-kind').textContent).toBe('langsmith');
  });

  it('keeps local draft edits outside effective target state', () => {
    renderProvider('ag-ui');
    fireEvent.change(screen.getByRole('textbox', { name: 'Local draft' }), {
      target: { value: 'https://draft.example.test/never-applied' },
    });

    expect(screen.getByTestId('ag-ui-kind').textContent).toBe('shared');
    expect(screen.getByTestId('view').textContent).not.toContain(
      'draft.example.test'
    );
  });

  it('synchronously clears both slots and registered drafts on pagehide', () => {
    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'Apply LangGraph' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply AG-UI' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Local draft' }), {
      target: { value: 'unsaved draft' },
    });

    act(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));

    expect(screen.getByTestId('ag-ui-kind').textContent).toBe('shared');
    expect(screen.getByTestId('langgraph-kind').textContent).toBe('shared');
    expect(
      (screen.getByRole('textbox', { name: 'Local draft' }) as HTMLInputElement)
        .value
    ).toBe('');
  });

  it('clears only on persisted pageshow and leaves ordinary routing alone', () => {
    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'Apply LangGraph' }));

    act(() => window.dispatchEvent(new PageTransitionEvent('pageshow')));
    window.history.pushState(
      {},
      '',
      '/docs/angular/langgraph/guides/streaming?mode=api'
    );
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(screen.getByTestId('langgraph-kind').textContent).toBe('langsmith');

    act(() =>
      window.dispatchEvent(
        new PageTransitionEvent('pageshow', { persisted: true })
      )
    );
    expect(screen.getByTestId('langgraph-kind').textContent).toBe('shared');
  });

  it('clears both slots and every registered draft on persisted pageshow', () => {
    function BothDrafts() {
      const agUi = useAgUiRuntimeTarget();
      const langgraph = useLangGraphRuntimeTarget();
      const [agUiDraft, setAgUiDraft] = useState('');
      const [langgraphDraft, setLanggraphDraft] = useState('');
      useEffect(
        () => agUi.registerDraftClear(() => setAgUiDraft('')),
        [agUi.registerDraftClear]
      );
      useEffect(
        () => langgraph.registerDraftClear(() => setLanggraphDraft('')),
        [langgraph.registerDraftClear]
      );
      return (
        <>
          <output data-testid="both-ag-ui-kind">{agUi.view.kind}</output>
          <output data-testid="both-langgraph-kind">
            {langgraph.view.kind}
          </output>
          <input
            aria-label="AG-UI draft"
            value={agUiDraft}
            onChange={(event) => setAgUiDraft(event.currentTarget.value)}
          />
          <input
            aria-label="LangGraph draft"
            value={langgraphDraft}
            onChange={(event) => setLanggraphDraft(event.currentTarget.value)}
          />
          <button onClick={() => agUi.applyCustomTarget(endpoint)}>
            Apply both AG-UI
          </button>
          <button onClick={() => langgraph.applyCustomTarget(apiUrl, apiKey)}>
            Apply both LangGraph
          </button>
        </>
      );
    }
    render(
      <RuntimeTargetProvider>
        <BothDrafts />
      </RuntimeTargetProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apply both AG-UI' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply both LangGraph' })
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'AG-UI draft' }), {
      target: { value: 'ag-ui draft' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'LangGraph draft' }), {
      target: { value: 'langgraph draft' },
    });

    act(() =>
      window.dispatchEvent(
        new PageTransitionEvent('pageshow', { persisted: true })
      )
    );

    expect(screen.getByTestId('both-ag-ui-kind').textContent).toBe('shared');
    expect(screen.getByTestId('both-langgraph-kind').textContent).toBe(
      'shared'
    );
    expect(
      (screen.getByRole('textbox', { name: 'AG-UI draft' }) as HTMLInputElement)
        .value
    ).toBe('');
    expect(
      (
        screen.getByRole('textbox', {
          name: 'LangGraph draft',
        }) as HTMLInputElement
      ).value
    ).toBe('');
  });

  it('keeps raw effective target access narrow to the internal module hook', () => {
    let internalTarget = '';
    function TrustedRuntimeProbe() {
      const langgraph = useLangGraphRuntimeTarget();
      const effective = useEffectiveRuntimeTarget('langgraph');
      internalTarget = JSON.stringify(effective);
      return (
        <button onClick={() => langgraph.applyCustomTarget(apiUrl, apiKey)}>
          Apply trusted target
        </button>
      );
    }
    render(
      <RuntimeTargetProvider>
        <TrustedRuntimeProbe />
      </RuntimeTargetProvider>
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply trusted target' })
    );

    expect(internalTarget).toContain(apiKey);
    expect(screen.queryByText(apiKey)).toBeNull();
    expect('useEffectiveRuntimeTarget' in publicWorkspaceApi).toBe(false);
  });

  it('keeps the internal effective object stable across ordinary rerenders and unrelated slot updates', () => {
    let latestEffective: ReturnType<typeof useEffectiveRuntimeTarget> | null =
      null;
    function StabilityProbe({ tick }: { tick: number }) {
      const agUi = useAgUiRuntimeTarget();
      latestEffective = useEffectiveRuntimeTarget('langgraph');
      return (
        <>
          <output data-testid="stability-tick">{tick}</output>
          <button onClick={() => agUi.applyCustomTarget(endpoint)}>
            Update unrelated slot
          </button>
        </>
      );
    }
    const view = render(
      <RuntimeTargetProvider>
        <StabilityProbe tick={0} />
      </RuntimeTargetProvider>
    );
    const initial = latestEffective;

    view.rerender(
      <RuntimeTargetProvider>
        <StabilityProbe tick={1} />
      </RuntimeTargetProvider>
    );
    expect(latestEffective).toBe(initial);

    fireEvent.click(
      screen.getByRole('button', { name: 'Update unrelated slot' })
    );
    expect(latestEffective).toBe(initial);
  });

  it('changes the internal effective object only for a selected-slot effective change', () => {
    let latestEffective: ReturnType<typeof useEffectiveRuntimeTarget> | null =
      null;
    function SelectedSlotProbe() {
      const langgraph = useLangGraphRuntimeTarget();
      latestEffective = useEffectiveRuntimeTarget('langgraph');
      return (
        <button onClick={() => langgraph.applyCustomTarget(apiUrl, apiKey)}>
          Apply selected slot
        </button>
      );
    }
    render(
      <RuntimeTargetProvider>
        <SelectedSlotProbe />
      </RuntimeTargetProvider>
    );
    const initial = latestEffective;

    fireEvent.click(
      screen.getByRole('button', { name: 'Apply selected slot' })
    );
    const custom = latestEffective;
    expect(custom).not.toBe(initial);

    fireEvent.click(
      screen.getByRole('button', { name: 'Apply selected slot' })
    );
    expect(latestEffective).toBe(custom);
  });

  it('keeps internal raw targets aligned with the committed sanitized view', () => {
    const committedSnapshots: string[] = [];
    function ConsistencyProbe() {
      const agUi = useAgUiRuntimeTarget();
      const langgraph = useLangGraphRuntimeTarget();
      const effective = useEffectiveRuntimeTarget('langgraph');
      committedSnapshots.push(
        `${effective.target?.kind ?? 'none'}:${langgraph.view.kind}`
      );
      return (
        <>
          <button onClick={() => agUi.applyCustomTarget(endpoint)}>
            Apply unrelated consistency target
          </button>
          <button onClick={() => langgraph.applyCustomTarget(apiUrl, apiKey)}>
            Apply selected consistency target
          </button>
        </>
      );
    }
    render(
      <RuntimeTargetProvider>
        <ConsistencyProbe />
      </RuntimeTargetProvider>
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Apply unrelated consistency target',
      })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply selected consistency target' })
    );

    expect(committedSnapshots).toEqual([
      'shared:shared',
      'shared:shared',
      'langsmith:langsmith',
    ]);
  });

  it('defaults again when the provider remounts', () => {
    const view = renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'Apply LangGraph' }));
    expect(screen.getByTestId('langgraph-kind').textContent).toBe('langsmith');

    view.unmount();
    renderProvider();
    expect(screen.getByTestId('langgraph-kind').textContent).toBe('shared');
  });

  it('does not copy target values into browser or generic observation surfaces', () => {
    const localSet = vi.spyOn(Storage.prototype, 'setItem');
    const pushState = vi.spyOn(window.history, 'pushState');
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const analyticsBag: unknown[] = [];
    Object.defineProperty(window, 'dataLayer', {
      configurable: true,
      value: analyticsBag,
    });
    const initialHref = window.location.href;

    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'Apply LangGraph' }));

    expect(window.location.href).toBe(initialHref);
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(localSet).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(analyticsBag).toEqual([]);
    expect(document.documentElement.outerHTML).not.toContain(apiKey);
    expect(screen.getByTestId('view').textContent).not.toContain(apiKey);
    expect(screen.getByTestId('public-controls').textContent).not.toContain(
      apiKey
    );
    expect(
      Array.from(document.querySelectorAll('*')).flatMap((element) =>
        Array.from(element.attributes, (attribute) => attribute.value)
      )
    ).not.toContain(apiKey);
  });
});
