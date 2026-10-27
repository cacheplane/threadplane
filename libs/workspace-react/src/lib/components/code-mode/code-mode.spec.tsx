/** @vitest-environment jsdom */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { CodeMode } from './code-mode';

describe('CodeMode', () => {
  let container: HTMLDivElement | undefined;
  let root: ReturnType<typeof createRoot> | undefined;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
  });

  it('renders one tree row and tab when a prompt is also an actual code include', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<CodeMode entryTitle="Client Tools" codeAssetPaths={['prompts/client-tools.md']} backendAssetPaths={['prompts/client-tools.md']} codeFiles={{'prompts/client-tools.md': '<pre>actual prompt</pre>'}} promptFiles={{'prompts/client-tools.md': 'actual prompt'}} />));
    expect(container.querySelectorAll('[data-file-row]')).toHaveLength(1);
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(1);
    expect(container.textContent).toContain('actual prompt');
  });

  it('renders Shiki-highlighted HTML for the active file', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    const codeFiles: Record<string, string> = {
      'apps/cockpit/src/app/page.tsx': '<pre class="shiki"><code>export default function Page() {}</code></pre>',
      'cockpit/langgraph/streaming/python/src/index.ts': '<pre class="shiki"><code>const x = 1;</code></pre>',
    };

    act(() => {
      root!.render(
        <CodeMode
          entryTitle="LangGraph Streaming"
          codeAssetPaths={[
            'apps/cockpit/src/app/page.tsx',
            'cockpit/langgraph/streaming/python/src/index.ts',
          ]}
          backendAssetPaths={[]}
          codeFiles={codeFiles}
          promptFiles={{}}
        />
      );
    });

    expect(container.querySelector('.shiki')).not.toBeNull();
    // The filename now lives in the tab strip (no chrome around the code body).
    const activeTab = container.querySelector('[role="tab"][data-state="active"]');
    expect((activeTab?.textContent ?? '').replace(/×/g, '').trim()).toBe('page.tsx');
    expect(container.textContent).toContain('export default function Page() {}');

    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    expect(tabs.map((tab) => (tab.textContent ?? '').replace(/×/g, '').trim())).toEqual(['page.tsx', 'index.ts']);

    act(() => {
      (tabs[1] as HTMLElement).dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })
      );
    });

    expect(container.textContent).toContain('const x = 1;');
  });

  it('renders a fallback message when codeFiles has no entry for a path', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        <CodeMode
          entryTitle="Test"
          codeAssetPaths={['missing/file.ts']}
          backendAssetPaths={[]}
          codeFiles={{}}
          promptFiles={{}}
        />
      );
    });

    expect(container.textContent).toContain('No source available');
  });

  it('renders prompt files as tabs after a separator', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    const promptFiles: Record<string, string> = {
      'prompts/system.md': 'You are a helpful assistant.',
    };

    act(() => {
      root!.render(
        <CodeMode
          entryTitle="Test Entry"
          codeAssetPaths={['src/app.tsx']}
          backendAssetPaths={[]}
          codeFiles={{ 'src/app.tsx': '<pre class="shiki"><code>const app = true;</code></pre>' }}
          promptFiles={promptFiles}
        />
      );
    });

    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    const tabLabels = tabs.map((tab) => (tab.textContent ?? '').replace(/×/g, '').trim());
    expect(tabLabels).toContain('app.tsx');
    expect(tabLabels).toContain('system.md');

    act(() => {
      const promptTab = tabs.find((tab) => (tab.textContent ?? '').replace(/×/g, '').trim() === 'system.md') as HTMLElement;
      promptTab.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })
      );
    });

    expect(container.textContent).toContain('You are a helpful assistant.');
  });

  it('pre-opens all code, backend, and prompt files as tabs with the first code file active', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        <CodeMode
          entryTitle="Planning"
          codeAssetPaths={['src/a.ts']}
          backendAssetPaths={['backend/graph.py']}
          codeFiles={{
            'src/a.ts': '<pre class="shiki"><code>a</code></pre>',
            'backend/graph.py': '<pre class="shiki"><code>g</code></pre>',
          }}
          promptFiles={{ 'prompts/p.md': 'hello' }}
        />,
      );
    });

    const tabLabels = Array.from(container.querySelectorAll('[role="tab"]')).map((t) => (t.textContent ?? '').replace(/×/g, '').trim());
    expect(tabLabels).toEqual(['a.ts', 'graph.py', 'p.md']);

    const active = container.querySelector('[role="tab"][data-state="active"]');
    expect((active?.textContent ?? '').replace(/×/g, '').trim()).toBe('a.ts');
  });

  it('opens a closed file and activates it when the tree row is clicked', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        <CodeMode
          entryTitle="Planning"
          codeAssetPaths={['src/a.ts', 'src/b.ts']}
          backendAssetPaths={[]}
          codeFiles={{
            'src/a.ts': '<pre class="shiki"><code>a</code></pre>',
            'src/b.ts': '<pre class="shiki"><code>b</code></pre>',
          }}
          promptFiles={{}}
        />,
      );
    });

    // Locate the tree row for b.ts and click it. Since FT5 has both files pre-opened,
    // this verifies the tree-click path even before FT6 introduces close behaviour.
    const bRow = Array.from(container.querySelectorAll('[data-file-row]')).find(
      (el) => el.querySelector('[data-file-label]')?.textContent === 'b.ts',
    ) as HTMLElement;
    expect(bRow).toBeDefined();

    act(() => { bRow.click(); });

    const active = container.querySelector('[role="tab"][data-state="active"]');
    expect((active?.textContent ?? '').replace(/×/g, '').trim()).toBe('b.ts');
  });

  it('closes a tab and activates its left neighbor', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        <CodeMode
          entryTitle="Planning"
          codeAssetPaths={['src/a.ts', 'src/b.ts', 'src/c.ts']}
          backendAssetPaths={[]}
          codeFiles={{
            'src/a.ts': '<pre class="shiki"><code>a</code></pre>',
            'src/b.ts': '<pre class="shiki"><code>b</code></pre>',
            'src/c.ts': '<pre class="shiki"><code>c</code></pre>',
          }}
          promptFiles={{}}
        />,
      );
    });

    // Activate b.ts, then close it.
    const bTab = Array.from(container.querySelectorAll('[role="tab"]')).find(
      (el) => el.textContent?.startsWith('b.ts'),
    ) as HTMLElement;
    act(() => {
      bTab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    });

    const closeBtn = container.querySelector('[role="tab"][data-state="active"] [data-tab-close]') as HTMLElement;
    expect(closeBtn).not.toBeNull();
    act(() => { closeBtn.click(); });

    const tabs = Array.from(container.querySelectorAll('[role="tab"]')).map((t) =>
      (t.textContent ?? '').replace(/×/g, '').trim(),
    );
    expect(tabs).toEqual(['a.ts', 'c.ts']);

    const active = container.querySelector('[role="tab"][data-state="active"]');
    expect((active?.textContent ?? '').startsWith('a.ts')).toBe(true);
  });

  it('shows the empty state after the last tab is closed', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        <CodeMode
          entryTitle="Planning"
          codeAssetPaths={['src/only.ts']}
          backendAssetPaths={[]}
          codeFiles={{ 'src/only.ts': '<pre class="shiki"><code>x</code></pre>' }}
          promptFiles={{}}
        />,
      );
    });

    const closeBtn = container.querySelector('[role="tab"] [data-tab-close]') as HTMLElement;
    act(() => { closeBtn.click(); });

    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(container.textContent).toContain('Select a file from the tree');
  });

  it('closes a tab when Enter is pressed on the close button', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        <CodeMode
          entryTitle="Planning"
          codeAssetPaths={['src/a.ts', 'src/b.ts']}
          backendAssetPaths={[]}
          codeFiles={{
            'src/a.ts': '<pre class="shiki"><code>a</code></pre>',
            'src/b.ts': '<pre class="shiki"><code>b</code></pre>',
          }}
          promptFiles={{}}
        />,
      );
    });

    // The first tab (a.ts) is active by default; its close span is focusable.
    const closeBtn = container.querySelector(
      '[role="tab"][data-state="active"] [data-tab-close]',
    ) as HTMLElement;
    expect(closeBtn).not.toBeNull();
    expect(closeBtn.getAttribute('tabindex')).toBe('0');

    act(() => {
      closeBtn.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });

    const tabs = Array.from(container.querySelectorAll('[role="tab"]')).map((t) =>
      (t.textContent ?? '').replace(/×/g, '').trim(),
    );
    expect(tabs).toEqual(['b.ts']);
  });

});
