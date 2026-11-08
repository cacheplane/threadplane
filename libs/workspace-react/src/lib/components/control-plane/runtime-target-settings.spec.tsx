/** @vitest-environment jsdom */
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RuntimeAdapter } from '@threadplane/cockpit-registry';
import {
  RuntimeTargetProvider,
  useRuntimeTargetView,
} from '../../runtime/runtime-target-provider';
import { RuntimeTargetSettings } from './runtime-target-settings';

const workspaceRoot = process.cwd().endsWith('/libs/workspace-react')
  ? resolve(process.cwd(), '../..')
  : process.cwd();
const workspaceCss = readFileSync(
  resolve(workspaceRoot, 'libs/workspace-react/src/styles/workspace.css'),
  'utf8'
);
const runtimeOrigin = 'https://streaming.runtime.example.test';
const fixtureKey = 'test-key-redact-me';

function ViewProbe({ adapter }: { adapter: RuntimeAdapter }) {
  const view = useRuntimeTargetView(adapter);
  return <output data-testid="target-view">{JSON.stringify(view)}</output>;
}

function renderSettings(adapter: RuntimeAdapter) {
  return render(
    <RuntimeTargetProvider>
      <RuntimeTargetSettings adapter={adapter} runtimeOrigin={runtimeOrigin} />
      <ViewProbe adapter={adapter} />
    </RuntimeTargetProvider>
  );
}

describe('RuntimeTargetSettings', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/docs/angular/langgraph/guides/streaming');
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('offers explicit Shared and Custom AG-UI choices with a normalized endpoint', () => {
    renderSettings('ag-ui');

    expect(
      (
        screen.getByRole('radio', {
          name: 'Shared development',
        }) as HTMLInputElement
      ).checked
    ).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Custom AG-UI' }));
    const endpoint = screen.getByRole('textbox', { name: 'Endpoint' });
    expect(endpoint.getAttribute('autocomplete')).toBe('off');
    fireEvent.change(endpoint, {
      target: { value: 'HTTPS://Agents.Example.Test:443/ag-ui/' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use custom target' }));

    expect(screen.getByTestId('target-view').textContent).toContain(
      'https://agents.example.test/ag-ui/'
    );
    expect(screen.getByText('https://agents.example.test/ag-ui/')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Use shared development' })
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', { name: 'Use shared development' })
    );
    expect(screen.getByTestId('target-view').textContent).toContain('shared');
    expect((endpoint as HTMLInputElement).value).toBe('');
  });

  it('synchronizes sibling Settings from effective apply and clear transitions without clobbering local drafts', () => {
    const settings = (revision: string) => (
      <RuntimeTargetProvider>
        <div data-testid="settings-a" data-revision={revision}>
          <RuntimeTargetSettings
            adapter="ag-ui"
            runtimeOrigin={runtimeOrigin}
          />
        </div>
        <div data-testid="settings-b">
          <RuntimeTargetSettings
            adapter="ag-ui"
            runtimeOrigin={runtimeOrigin}
          />
        </div>
      </RuntimeTargetProvider>
    );
    const { rerender } = render(settings('first'));
    const first = within(screen.getByTestId('settings-a'));
    const sibling = within(screen.getByTestId('settings-b'));

    fireEvent.click(first.getByRole('radio', { name: 'Custom AG-UI' }));
    const firstEndpoint = first.getByRole('textbox', { name: 'Endpoint' });
    fireEvent.change(firstEndpoint, {
      target: { value: 'HTTPS://Agents.Example.Test:443/ag-ui/' },
    });

    rerender(settings('second'));
    expect((firstEndpoint as HTMLInputElement).value).toBe(
      'HTTPS://Agents.Example.Test:443/ag-ui/'
    );
    expect(
      (
        sibling.getByRole('radio', {
          name: 'Shared development',
        }) as HTMLInputElement
      ).checked
    ).toBe(true);
    fireEvent.click(first.getByRole('button', { name: 'Use custom target' }));

    expect(
      (
        sibling.getByRole('radio', {
          name: 'Custom AG-UI',
        }) as HTMLInputElement
      ).checked
    ).toBe(true);
    const siblingEndpoint = sibling.getByRole('textbox', {
      name: 'Endpoint',
    });
    expect((siblingEndpoint as HTMLInputElement).value).toBe(
      'https://agents.example.test/ag-ui/'
    );

    fireEvent.click(
      sibling.getByRole('button', { name: 'Use shared development' })
    );
    expect(
      (
        first.getByRole('radio', {
          name: 'Shared development',
        }) as HTMLInputElement
      ).checked
    ).toBe(true);
    expect(
      (
        sibling.getByRole('radio', {
          name: 'Shared development',
        }) as HTMLInputElement
      ).checked
    ).toBe(true);
    expect(first.queryByRole('textbox', { name: 'Endpoint' })).toBeNull();
    expect(sibling.queryByRole('textbox', { name: 'Endpoint' })).toBeNull();
  });

  it('keeps the LangSmith key only in an uncontrolled password input before apply', () => {
    const { container } = renderSettings('langgraph');
    fireEvent.click(screen.getByRole('radio', { name: 'Custom LangSmith' }));

    const apiUrl = screen.getByRole('textbox', { name: 'API URL' });
    const key = screen.getByLabelText('API key') as HTMLInputElement;
    expect(apiUrl.getAttribute('autocomplete')).toBe('off');
    expect(key.type).toBe('password');
    expect(key.autocomplete).toBe('new-password');
    expect(key.name).toBe('rts');
    expect(key.getAttribute('value')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /reveal|copy|save|history/i })
    ).toBeNull();

    fireEvent.change(apiUrl, {
      target: { value: 'https://API.Example.Test:443/langgraph' },
    });
    fireEvent.input(key, { target: { value: fixtureKey } });

    const beforeApply = container.cloneNode(true) as HTMLElement;
    beforeApply.querySelector('input[type="password"]')?.remove();
    expect(beforeApply.innerHTML).not.toContain(fixtureKey);

    fireEvent.click(screen.getByRole('button', { name: 'Use custom target' }));

    expect(key.value).toBe('');
    expect(screen.getByTestId('target-view').textContent).toContain(
      'https://api.example.test/langgraph'
    );
    expect(container.innerHTML).not.toContain(fixtureKey);
    expect(document.body.textContent).not.toContain(fixtureKey);
  });

  it('focuses the first invalid field and never echoes rejected input', () => {
    renderSettings('langgraph');
    fireEvent.click(screen.getByRole('radio', { name: 'Custom LangSmith' }));
    const apiUrl = screen.getByRole('textbox', { name: 'API URL' });
    const key = screen.getByLabelText('API key');
    fireEvent.change(apiUrl, {
      target: {
        value: 'https://raw-secret.example.test/path?token=raw-secret',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use custom target' }));

    expect(document.activeElement).toBe(apiUrl);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Remove the query string from the URL.');
    expect(alert.textContent).not.toContain('raw-secret');
    expect(apiUrl.getAttribute('aria-describedby')).toBe(alert.id);
    expect(key.getAttribute('aria-describedby')).toBeNull();
    expect(screen.getByTestId('target-view').textContent).toContain('shared');
  });

  it('focuses the key when the URL is valid but the key is empty', () => {
    renderSettings('langgraph');
    fireEvent.click(screen.getByRole('radio', { name: 'Custom LangSmith' }));
    const langGraphUrl = screen.getByRole('textbox', { name: 'API URL' });
    const key = screen.getByLabelText('API key');
    fireEvent.change(langGraphUrl, {
      target: { value: 'https://api.example.test/langgraph' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use custom target' }));

    const alert = screen.getByRole('alert');
    expect(document.activeElement).toBe(key);
    expect(alert.textContent).toBe('Enter an API key.');
    expect(langGraphUrl.getAttribute('aria-describedby')).toBeNull();
    expect(key.getAttribute('aria-describedby')).toBe(alert.id);
  });

  it('shows exact iframe-origin CORS guidance and the memory-only note', () => {
    renderSettings('ag-ui');
    expect(
      screen.getByText(
        `Allow Origin: ${runtimeOrigin}. This is the embedded Angular runtime origin, not necessarily the top-level workspace origin.`
      )
    ).toBeTruthy();
    expect(
      screen.getByText('Kept in this tab until refresh. Nothing is saved.')
    ).toBeTruthy();
  });

  it('explains unavailable static runtimes without rendering a target form', () => {
    renderSettings('none');
    expect(
      screen.getByText(
        'Custom runtime targets are unavailable for this capability.'
      )
    ).toBeTruthy();
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('clears mounted endpoint and key drafts on document lifecycle reset', () => {
    renderSettings('langgraph');
    fireEvent.click(screen.getByRole('radio', { name: 'Custom LangSmith' }));
    const apiUrl = screen.getByRole('textbox', { name: 'API URL' });
    const key = screen.getByLabelText('API key') as HTMLInputElement;
    fireEvent.change(apiUrl, { target: { value: 'https://api.example.test' } });
    fireEvent.input(key, { target: { value: fixtureKey } });

    act(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));

    expect((apiUrl as HTMLInputElement).value).toBe('');
    expect(key.value).toBe('');
    expect(
      (
        screen.getByRole('radio', {
          name: 'Shared development',
        }) as HTMLInputElement
      ).checked
    ).toBe(true);
  });

  it('does not carry a LangGraph draft or key into AG-UI after adapter navigation', () => {
    const { rerender } = render(
      <RuntimeTargetProvider>
        <RuntimeTargetSettings
          adapter="langgraph"
          runtimeOrigin={runtimeOrigin}
        />
      </RuntimeTargetProvider>
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Custom LangSmith' }));
    const langGraphUrl = screen.getByRole('textbox', { name: 'API URL' });
    fireEvent.change(langGraphUrl, {
      target: { value: 'https://langgraph-draft.example.test/path' },
    });
    const langGraphKey = screen.getByLabelText('API key') as HTMLInputElement;
    fireEvent.input(langGraphKey, {
      target: { value: fixtureKey },
    });

    rerender(
      <RuntimeTargetProvider>
        <RuntimeTargetSettings adapter="ag-ui" runtimeOrigin={runtimeOrigin} />
      </RuntimeTargetProvider>
    );

    expect(screen.queryByLabelText('API key')).toBeNull();
    expect(langGraphUrl.isConnected).toBe(false);
    expect(langGraphKey.isConnected).toBe(false);
    expect((langGraphUrl as HTMLInputElement).value).toBe('');
    expect(langGraphKey.value).toBe('');
    expect(
      (
        screen.getByRole('radio', {
          name: 'Shared development',
        }) as HTMLInputElement
      ).checked
    ).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Custom AG-UI' }));
    const agUiEndpoint = screen.getByRole('textbox', {
      name: 'Endpoint',
    }) as HTMLInputElement;
    expect(agUiEndpoint).not.toBe(langGraphUrl);
    expect(agUiEndpoint.value).toBe('');
    expect(document.body.textContent).not.toContain(fixtureKey);
    expect(document.body.textContent).not.toContain(
      'langgraph-draft.example.test'
    );
  });

  it('gives the utility panel its own scroll and all mobile controls a 44px target', () => {
    expect(workspaceCss).toMatch(
      /\[data-control-plane-utility-panel\][^{]*\{[^}]*overflow-y:\s*auto/
    );
    expect(workspaceCss).toMatch(
      /\[data-runtime-target-settings\][\s\S]*?input[^}]*min-height:\s*44px/
    );
    expect(workspaceCss).toMatch(
      /\[data-runtime-target-settings\][\s\S]*?button[^}]*min-height:\s*44px/
    );
  });
});
