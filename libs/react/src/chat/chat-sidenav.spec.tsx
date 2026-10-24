import { StrictMode, useEffect, useState } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChatSidenav,
  type ChatSidenavMode,
  type ChatSidenavProps,
} from './index';

afterEach(cleanup);

function shortcut(target: EventTarget = window, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key: 'b',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe('ChatSidenav toggle shortcut', () => {
  const props = {
    mode: 'expanded' as ChatSidenavMode,
    open: false,
    onOpenChange: vi.fn(),
    onModeChange: vi.fn(),
  };
  afterEach(() => vi.restoreAllMocks());

  it('requires strict opt-in and advertises only enabled desktop controls', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const view = render(<ChatSidenav {...props} />);
    const button = view.getByRole('button', { name: 'Collapse conversations' });
    expect(button.hasAttribute('aria-keyshortcuts')).toBe(false);
    expect(button.hasAttribute('title')).toBe(false);
    expect(add.mock.calls.filter(([name]) => name === 'keydown')).toHaveLength(
      0
    );
    for (const enabled of [false, undefined, 'true' as unknown as boolean]) {
      view.rerender(<ChatSidenav {...props} toggleShortcut={enabled} />);
      expect(shortcut().defaultPrevented).toBe(false);
    }
    view.rerender(
      <ChatSidenav
        {...props}
        toggleShortcut
        collapseLabel="Narrow"
        expandLabel="Widen"
      />
    );
    expect(button.getAttribute('aria-label')).toBe('Narrow');
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Control+B Meta+B');
    expect(button.getAttribute('title')).toBe('Narrow (Ctrl/Command+B)');
    view.rerender(
      <ChatSidenav
        {...props}
        mode="collapsed"
        toggleShortcut
        expandLabel="Widen"
      />
    );
    expect(button.getAttribute('title')).toBe('Widen (Ctrl/Command+B)');
    view.rerender(<ChatSidenav {...props} mode="drawer" toggleShortcut />);
    expect(button.hasAttribute('aria-keyshortcuts')).toBe(false);
    expect(button.hasAttribute('title')).toBe(false);
    expect(shortcut().defaultPrevented).toBe(false);
    view.rerender(<ChatSidenav {...props} toggleShortcut={false} />);
    expect(button.hasAttribute('aria-keyshortcuts')).toBe(false);
    expect(button.hasAttribute('title')).toBe(false);
  });

  it('claims supported chords before requesting controlled changes using latest committed props', () => {
    const first = vi.fn((mode: Exclude<ChatSidenavMode, 'drawer'>) => {
      expect(mode).toBe('collapsed');
      expect(event.defaultPrevented).toBe(true);
    });
    const view = render(
      <ChatSidenav {...props} toggleShortcut onModeChange={first}>
        <button>Retained focus</button>
      </ChatSidenav>
    );
    const focused = view.getByText('Retained focus');
    focused.focus();
    let event: KeyboardEvent;
    for (const init of [
      {},
      { key: 'B', ctrlKey: false, metaKey: true },
      { metaKey: true },
    ]) {
      event = new KeyboardEvent('keydown', {
        key: 'b',
        ctrlKey: true,
        cancelable: true,
        ...init,
      });
      expect(window.dispatchEvent(event)).toBe(false);
    }
    expect(first.mock.calls).toEqual([
      ['collapsed'],
      ['collapsed'],
      ['collapsed'],
    ]);
    expect(document.activeElement).toBe(focused);
    expect(
      view.getByRole('button', { name: 'Collapse conversations' })
    ).toBeTruthy();
    const next = vi.fn();
    view.rerender(
      <ChatSidenav
        {...props}
        mode="collapsed"
        toggleShortcut
        onModeChange={next}
      />
    );
    expect(shortcut().defaultPrevented).toBe(true);
    expect(next).toHaveBeenCalledExactlyOnceWith('expanded');
    expect(first).toHaveBeenCalledTimes(3);
  });

  it('leaves excluded and already claimed events unclaimed', () => {
    const change = vi.fn();
    render(<ChatSidenav {...props} toggleShortcut onModeChange={change} />);
    for (const init of [
      { key: 'a' },
      { ctrlKey: false },
      { altKey: true },
      { shiftKey: true },
      { repeat: true },
      { isComposing: true },
      { keyCode: 229 },
      { cancelable: false },
    ])
      expect(shortcut(window, init).defaultPrevented).toBe(false);
    const claimed = new KeyboardEvent('keydown', {
      key: 'b',
      ctrlKey: true,
      cancelable: true,
    });
    claimed.preventDefault();
    window.dispatchEvent(claimed);
    expect(change).not.toHaveBeenCalled();
  });

  it('honors local prevention and propagation on noneditable targets', () => {
    const change = vi.fn();
    const view = render(
      <ChatSidenav {...props} toggleShortcut onModeChange={change}>
        <button onKeyDown={(e) => e.preventDefault()}>Prevent</button>
        <button onKeyDown={(e) => e.stopPropagation()}>Stop</button>
      </ChatSidenav>
    );
    expect(shortcut(view.getByText('Prevent')).defaultPrevented).toBe(true);
    expect(shortcut(view.getByText('Stop')).defaultPrevented).toBe(false);
    expect(change).not.toHaveBeenCalled();
  });

  it('protects form controls and inherited editing, permitting false islands and inspecting shadow paths', () => {
    const change = vi.fn();
    const view = render(
      <ChatSidenav {...props} toggleShortcut onModeChange={change}>
        <input aria-label="Input" />
        <textarea aria-label="Textarea" />
        <select aria-label="Select" />
        <div contentEditable suppressContentEditableWarning>
          <span>Editable</span>
          <div contentEditable={false}>
            <button>False island</button>
          </div>
        </div>
        <div contentEditable="plaintext-only" suppressContentEditableWarning>
          <span>Plaintext</span>
        </div>
        <div data-testid="shadow" />
      </ChatSidenav>
    );
    for (const name of ['Input', 'Textarea', 'Select'])
      expect(shortcut(view.getByLabelText(name)).defaultPrevented).toBe(false);
    for (const name of ['Editable', 'Plaintext'])
      expect(shortcut(view.getByText(name)).defaultPrevented).toBe(false);
    const shadow = view.getByTestId('shadow').attachShadow({ mode: 'open' });
    const input = document.createElement('input');
    shadow.append(input);
    expect(shortcut(input).defaultPrevented).toBe(false);
    expect(change).not.toHaveBeenCalled();
    expect(shortcut(view.getByText('False island')).defaultPrevented).toBe(
      true
    );
    expect(change).toHaveBeenCalledExactlyOnceWith('collapsed');
  });

  it('keeps registration priority across callback, mode and drawer updates with eligible fallback', () => {
    const first = vi.fn();
    const second = vi.fn();
    const next = vi.fn();
    const shell = (
      mode: ChatSidenavMode = 'expanded',
      onModeChange = first,
      hidden = false,
      inert = false,
      enabled = true
    ) => (
      <>
        <div hidden={hidden} inert={inert}>
          <ChatSidenav
            {...props}
            mode={mode}
            toggleShortcut={enabled}
            onModeChange={onModeChange}
          />
        </div>
        <ChatSidenav {...props} toggleShortcut onModeChange={second} />
      </>
    );
    const view = render(shell());
    shortcut();
    expect(first).toHaveBeenCalledExactlyOnceWith('collapsed');
    expect(second).not.toHaveBeenCalled();
    view.rerender(shell('collapsed', next));
    shortcut();
    expect(next).toHaveBeenLastCalledWith('expanded');
    for (const [mode, callback, hidden, inert, enabled] of [
      ['drawer', next, false, false, true],
      ['expanded', next, true, false, true],
      ['expanded', next, false, true, true],
    ] as const) {
      view.rerender(shell(mode, callback, hidden, inert, enabled));
      expect(shortcut().defaultPrevented).toBe(true);
      view.rerender(shell('expanded', next));
      shortcut();
      expect(next).toHaveBeenLastCalledWith('collapsed');
    }
    expect(second).toHaveBeenCalledTimes(3);
    view.rerender(shell('expanded', next, false, false, false));
    shortcut();
    expect(second).toHaveBeenCalledTimes(4);
    view.rerender(shell('expanded', next));
    shortcut();
    expect(second).toHaveBeenCalledTimes(5);
  });

  it('uses its owner window and rejects disconnected roots', () => {
    const main = vi.fn();
    const framed = vi.fn();
    render(<ChatSidenav {...props} toggleShortcut onModeChange={main} />);
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    const doc = iframe.contentDocument;
    const owner = doc?.defaultView;
    if (!doc || !owner)
      throw new Error('Expected connected same-origin iframe');
    const container = doc.createElement('div');
    doc.body.append(container);
    const view = render(
      <ChatSidenav {...props} toggleShortcut onModeChange={framed} />,
      { container, baseElement: doc.body }
    );
    try {
      shortcut();
      expect(main).toHaveBeenCalledTimes(1);
      expect(framed).not.toHaveBeenCalled();
      const event = new (owner as unknown as typeof window).KeyboardEvent(
        'keydown',
        { key: 'b', metaKey: true, bubbles: true, cancelable: true }
      );
      expect(container.dispatchEvent(event)).toBe(false);
      expect(framed).toHaveBeenCalledExactlyOnceWith('collapsed');
      expect(main).toHaveBeenCalledTimes(1);
      container.remove();
      const detachedEvent = new (
        owner as unknown as typeof window
      ).KeyboardEvent('keydown', { key: 'b', ctrlKey: true, cancelable: true });
      expect(owner.dispatchEvent(detachedEvent)).toBe(true);
      expect(framed).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
      iframe.remove();
    }
  });

  it('cleans up on StrictMode replay, opt-out and unmount', () => {
    const change = vi.fn();
    const shell = (enabled: boolean) => (
      <StrictMode>
        <ChatSidenav
          {...props}
          toggleShortcut={enabled}
          onModeChange={change}
        />
      </StrictMode>
    );
    const view = render(shell(true));
    shortcut();
    expect(change).toHaveBeenCalledTimes(1);
    view.rerender(shell(false));
    expect(shortcut().defaultPrevented).toBe(false);
    view.rerender(shell(true));
    shortcut();
    expect(change).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(shortcut().defaultPrevented).toBe(false);
  });

  it('hands off disappearing body/compact focus only after acceptance and preserves external focus', () => {
    function Shell() {
      const [mode, setMode] = useState<ChatSidenavMode>('expanded');
      return (
        <>
          <button>External</button>
          <ChatSidenav
            {...props}
            mode={mode}
            toggleShortcut
            onModeChange={setMode}
            collapsedContent={<button>Compact</button>}
          >
            <button>Body</button>
          </ChatSidenav>
        </>
      );
    }
    const view = render(<Shell />);
    view.getByText('Body').focus();
    fireEvent.keyDown(view.getByText('Body'), { key: 'b', ctrlKey: true });
    expect(document.activeElement).toBe(
      view.getByLabelText('Expand conversations')
    );
    view.getByText('Compact').focus();
    fireEvent.keyDown(view.getByText('Compact'), { key: 'b', metaKey: true });
    expect(document.activeElement).toBe(
      view.getByLabelText('Collapse conversations')
    );
    const external = view.getByText('External');
    external.focus();
    fireEvent.keyDown(external, { key: 'b', ctrlKey: true });
    expect(document.activeElement).toBe(external);
  });
});

function setup(mode: ChatSidenavMode = 'expanded', open = false) {
  const onOpenChange = vi.fn();
  const onModeChange = vi.fn();
  const shell = (mode: ChatSidenavMode, open: boolean) => (
    <>
      <button>Outside</button>
      <input aria-label="External input" />
      <ChatSidenav {...{ mode, open, onOpenChange, onModeChange }}>
        <input aria-label="Filter" />
      </ChatSidenav>
    </>
  );
  const view = render(shell(mode, open));
  return {
    ...view,
    onOpenChange,
    onModeChange,
    transition: (mode: ChatSidenavMode, open = false) =>
      view.rerender(shell(mode, open)),
    filter: () => view.getByLabelText('Filter'),
  };
}

describe('ChatSidenav', () => {
  it.each(['expanded', 'collapsed'] as const)(
    'lets %s mode determine body visibility independently of open',
    (mode) => {
      const view = setup(mode, true);
      const nav = view.getByRole('navigation', { name: 'Conversations' });
      const body = nav.querySelector('.tp-chat-sidenav__body');
      expect(body?.hasAttribute('hidden')).toBe(mode === 'collapsed');
      expect(body?.hasAttribute('inert')).toBe(mode === 'collapsed');
      expect(view.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(document.body);
      expect(
        view
          .getByRole('button', {
            name:
              mode === 'expanded'
                ? 'Collapse conversations'
                : 'Expand conversations',
          })
          .getAttribute('aria-controls')
      ).toBe(body?.id);
      expect(
        view.queryByRole('button', { name: 'Open conversations' })
      ).toBeNull();
      expect(
        view.queryByRole('button', { name: 'Close conversations' })
      ).toBeNull();
    }
  );

  it('waits for controlled props after launcher, Close and toggle requests', () => {
    const view = setup('drawer');
    const nav = view.container.querySelector('nav');
    if (!nav) throw new Error('Expected a persistent navigation element');
    expect(nav.hidden).toBe(true);
    expect(nav.hasAttribute('inert')).toBe(true);
    const launcher = view.getByRole('button', { name: 'Open conversations' });
    launcher.focus();
    fireEvent.click(launcher);
    expect(view.onOpenChange).toHaveBeenLastCalledWith(true);
    expect(nav.hidden).toBe(true);
    expect(document.activeElement).toBe(launcher);
    view.transition('drawer', true);
    const close = view.getByRole('button', { name: 'Close conversations' });
    expect(document.activeElement).toBe(close);
    fireEvent.click(close);
    expect(view.onOpenChange).toHaveBeenLastCalledWith(false);
    expect(nav.hidden).toBe(false);
    expect(document.activeElement).toBe(close);
    view.transition('expanded');
    const toggle = view.getByRole('button', { name: 'Collapse conversations' });
    toggle.focus();
    fireEvent.click(toggle);
    expect(view.onModeChange).toHaveBeenLastCalledWith('collapsed');
    expect(document.activeElement).toBe(toggle);
    expect(view.getByRole('textbox', { name: 'Filter' })).toBeTruthy();
    view.transition('collapsed');
    fireEvent.click(view.getByRole('button', { name: 'Expand conversations' }));
    expect(view.onModeChange).toHaveBeenLastCalledWith('expanded');
  });

  it('uses stable unique nav/body IDs, custom labels and button semantics', () => {
    const shell = (
      <>
        <ChatSidenav
          mode="drawer"
          open={false}
          onOpenChange={vi.fn()}
          onModeChange={vi.fn()}
          label="Saved"
          launcherLabel="Browse"
          closeLabel="Dismiss"
          expandLabel="Widen"
          collapseLabel="Narrow"
          className="custom"
        />
        <ChatSidenav
          mode="expanded"
          open
          onOpenChange={vi.fn()}
          onModeChange={vi.fn()}
        />
      </>
    );
    const view = render(shell);
    const navs = [...view.container.querySelectorAll('nav')];
    const ids = navs.map((nav) => nav.id);
    expect(
      new Set([
        ...ids,
        ...[...view.container.querySelectorAll('.tp-chat-sidenav__body')].map(
          (body) => body.id
        ),
      ]).size
    ).toBe(4);
    expect(navs[0].getAttribute('aria-label')).toBe('Saved');
    expect(
      view.getByRole('button', { name: 'Browse' }).getAttribute('aria-controls')
    ).toBe(ids[0]);
    expect(view.container.querySelector('.custom')).toBeTruthy();
    for (const button of view.container.querySelectorAll('button'))
      expect(button.type).toBe('button');
    view.rerender(shell);
    expect(
      [...view.container.querySelectorAll('nav')].map((nav) => nav.id)
    ).toEqual(ids);
  });

  it('retains child DOM, draft and mount counts through every mode in StrictMode', () => {
    const mount = vi.fn();
    const unmount = vi.fn();
    function Draft() {
      const [draft, setDraft] = useState('');
      useEffect(() => {
        mount();
        return unmount;
      }, []);
      return (
        <input
          aria-label="Draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      );
    }
    const shell = (mode: ChatSidenavMode, open: boolean) => (
      <StrictMode>
        <ChatSidenav
          {...{ mode, open }}
          onOpenChange={vi.fn()}
          onModeChange={vi.fn()}
        >
          <Draft />
        </ChatSidenav>
      </StrictMode>
    );
    const view = render(shell('expanded', false));
    const input = view.getByLabelText('Draft') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Retained draft' } });
    const mounts = mount.mock.calls.length;
    const unmounts = unmount.mock.calls.length;
    for (const [mode, open] of [
      ['collapsed', false],
      ['drawer', false],
      ['drawer', true],
      ['expanded', true],
    ] as const) {
      view.rerender(shell(mode, open));
      expect(view.getByLabelText('Draft')).toBe(input);
      expect(input.value).toBe('Retained draft');
    }
    expect(mount).toHaveBeenCalledTimes(mounts);
    expect(unmount).toHaveBeenCalledTimes(unmounts);
  });

  it.each([
    ['expanded', false, 'Filter', 'collapsed', false, 'Expand conversations'],
    [
      'collapsed',
      false,
      'Expand conversations',
      'expanded',
      true,
      'Collapse conversations',
    ],
    ['expanded', false, 'Filter', 'drawer', false, 'Open conversations'],
    [
      'collapsed',
      false,
      'Expand conversations',
      'drawer',
      false,
      'Open conversations',
    ],
    ['drawer', true, 'Filter', 'drawer', false, 'Open conversations'],
    ['drawer', true, 'Filter', 'collapsed', false, 'Expand conversations'],
    [
      'drawer',
      true,
      'Close conversations',
      'expanded',
      false,
      'Collapse conversations',
    ],
    [
      'drawer',
      true,
      'Close conversations',
      'collapsed',
      true,
      'Expand conversations',
    ],
    [
      'drawer',
      false,
      'Open conversations',
      'expanded',
      false,
      'Collapse conversations',
    ],
    [
      'drawer',
      false,
      'Open conversations',
      'collapsed',
      false,
      'Expand conversations',
    ],
  ] as const)(
    'restores disappearing %s/%s/%s focus on accepted %s/%s',
    (from, fromOpen, focus, to, toOpen, expected) => {
      const view = setup(from, fromOpen);
      view.getByLabelText(focus).focus();
      view.transition(to, toOpen);
      expect(document.activeElement).toBe(
        view.getByRole('button', { name: expected })
      );
    }
  );

  it('restores locally owned focus when the browser blurs hidden content to body', () => {
    const view = setup();
    view.filter().focus();
    view.filter().blur();
    view.transition('drawer');
    expect(document.activeElement).toBe(
      view.getByRole('button', { name: 'Open conversations' })
    );
  });

  it('preserves a visible child when leaving drawer and focuses Close on accepted drawer entry', () => {
    const view = setup('drawer', true);
    view.filter().focus();
    view.transition('expanded', true);
    expect(document.activeElement).toBe(view.filter());
    view.transition('drawer', true);
    expect(document.activeElement).toBe(
      view.getByRole('button', { name: 'Close conversations' })
    );
  });

  it.each(['expanded', 'collapsed', 'drawer'] as const)(
    'focuses Close when %s accepts an open drawer',
    (mode) => {
      const view = setup(mode);
      view.transition('drawer', true);
      expect(document.activeElement).toBe(
        view.getByRole('button', { name: 'Close conversations' })
      );
    }
  );

  it.each(['collapsed', 'drawer'] as const)(
    'does not steal external focus when initially %s',
    (mode) => {
      const external = document.createElement('input');
      document.body.append(external);
      external.focus();
      const view = setup(mode);
      expect(document.activeElement).toBe(external);
      view.unmount();
      external.remove();
    }
  );

  it('honors each custom control label', () => {
    const shell = (mode: ChatSidenavMode, open = false) => (
      <ChatSidenav
        {...{ mode, open }}
        onModeChange={vi.fn()}
        onOpenChange={vi.fn()}
        label="Saved"
        launcherLabel="Browse"
        closeLabel="Dismiss"
        expandLabel="Widen"
        collapseLabel="Narrow"
      />
    );
    const view = render(shell('expanded'));
    expect(view.getByRole('button', { name: 'Narrow' })).toBeTruthy();
    view.rerender(shell('collapsed'));
    expect(view.getByRole('button', { name: 'Widen' })).toBeTruthy();
    view.rerender(shell('drawer', true));
    expect(view.getByRole('button', { name: 'Dismiss' })).toBe(
      document.activeElement
    );
    expect(view.getByRole('navigation', { name: 'Saved' })).toBeTruthy();
  });

  it.each(['Outside', 'External input'])(
    'preserves external %s focus on close/collapse/mode changes',
    (label) => {
      const view = setup('drawer', true);
      const external =
        label === 'Outside'
          ? view.getByRole('button', { name: label })
          : view.getByLabelText(label);
      for (const [mode, open] of [
        ['drawer', false],
        ['expanded', false],
        ['collapsed', false],
        ['drawer', false],
      ] as const) {
        external.focus();
        view.transition(mode, open);
        expect(document.activeElement).toBe(external);
      }
    }
  );

  it('handles only unclaimed, noncomposing Escape inside an open drawer', () => {
    const change = vi.fn();
    const outer = vi.fn();
    const shell = (mode: ChatSidenavMode, open: boolean, claimed = false) => (
      <div onKeyDown={outer}>
        <ChatSidenav
          {...{ mode, open }}
          onOpenChange={change}
          onModeChange={vi.fn()}
        >
          <input
            aria-label="Filter"
            onKeyDown={(event) => {
              if (claimed) event.preventDefault();
            }}
          />
        </ChatSidenav>
        <button>Outside</button>
      </div>
    );
    const view = render(shell('drawer', true));
    const input = view.getByLabelText('Filter');
    expect(fireEvent.keyDown(input, { key: 'Escape' })).toBe(false);
    expect(change).toHaveBeenCalledExactlyOnceWith(false);
    expect(outer).not.toHaveBeenCalled();
    change.mockClear();
    for (const event of [
      { key: 'Enter' },
      { key: 'Escape', isComposing: true },
      { key: 'Escape', keyCode: 229 },
    ])
      fireEvent.keyDown(input, event);
    fireEvent.keyDown(view.getByRole('button', { name: 'Outside' }), {
      key: 'Escape',
    });
    view.rerender(shell('drawer', true, true));
    fireEvent.keyDown(input, { key: 'Escape' });
    for (const [mode, open] of [
      ['expanded', true],
      ['collapsed', true],
      ['drawer', false],
    ] as const) {
      view.rerender(shell(mode, open));
      fireEvent.keyDown(input, { key: 'Escape' });
    }
    expect(change).not.toHaveBeenCalled();
  });
});

describe('ChatSidenav compact content', () => {
  const shell = (
    mode: ChatSidenavMode,
    open = false,
    collapsedContent: ChatSidenavProps['collapsedContent'] = (
      <input aria-label="Compact draft" />
    )
  ) => (
    <>
      <button>External</button>
      <ChatSidenav
        mode={mode}
        open={open}
        onModeChange={vi.fn()}
        onOpenChange={vi.fn()}
        collapsedContent={collapsedContent}
      >
        <input aria-label="Full draft" />
      </ChatSidenav>
    </>
  );
  it.each(['expanded', 'collapsed', 'drawer'] as const)(
    'keeps compact and full trees mounted in %s with either open value',
    (mode) => {
      const view = render(shell('expanded'));
      const full = view.getByLabelText('Full draft') as HTMLInputElement;
      const compact = view.getByLabelText('Compact draft') as HTMLInputElement;
      fireEvent.change(full, { target: { value: 'full retained' } });
      fireEvent.change(compact, { target: { value: 'compact retained' } });
      for (const open of [false, true]) {
        view.rerender(shell(mode, open));
        const wrapper = view.container.querySelector(
          '.tp-chat-sidenav__collapsed-content'
        ) as HTMLElement;
        expect(wrapper).not.toBeNull();
        expect(wrapper.hidden).toBe(mode !== 'collapsed');
        expect(wrapper.hasAttribute('inert')).toBe(mode !== 'collapsed');
        expect(view.getByLabelText('Full draft')).toBe(full);
        expect(view.getByLabelText('Compact draft')).toBe(compact);
        expect(full.value).toBe('full retained');
        expect(compact.value).toBe('compact retained');
        expect(
          view.queryByRole('textbox', { name: 'Compact draft' }) !== null
        ).toBe(mode === 'collapsed');
      }
    }
  );
  it('omits the wrapper by default and preserves explicitly empty compact slots', () => {
    const view = setup('collapsed');
    expect(
      view.container.querySelector('.tp-chat-sidenav__collapsed-content')
    ).toBeNull();
    view.unmount();
    const compact = render(shell('collapsed', false, null));
    for (const value of [null, false]) {
      compact.rerender(shell('collapsed', false, value));
      expect(
        compact.container.querySelector('.tp-chat-sidenav__collapsed-content')
          ?.childNodes.length
      ).toBe(0);
      expect(compact.queryByRole('textbox')).toBeNull();
    }
  });
  it.each([
    ['expanded', false, 'Collapse conversations'],
    ['drawer', false, 'Open conversations'],
    ['drawer', true, 'Close conversations'],
  ] as const)(
    'restores disappearing compact focus to %s/%s control',
    (mode, open, label) => {
      const view = render(shell('collapsed'));
      view.getByLabelText('Compact draft').focus();
      view.rerender(shell(mode, open));
      expect(document.activeElement).toBe(
        view.getByRole('button', { name: label })
      );
    }
  );
  it('retains compact ownership after browser blur but clears it on external transfer', () => {
    const view = render(shell('collapsed'));
    view.getByLabelText('Compact draft').focus();
    view.getByLabelText('Compact draft').blur();
    view.rerender(shell('expanded'));
    expect(document.activeElement).toBe(
      view.getByRole('button', { name: 'Collapse conversations' })
    );
    view.rerender(shell('collapsed'));
    view.getByLabelText('Compact draft').focus();
    const external = view.getByRole('button', { name: 'External' });
    external.focus();
    view.rerender(shell('expanded'));
    expect(document.activeElement).toBe(external);
    view.rerender(shell('collapsed'));
    view.getByLabelText('Compact draft').focus();
    external.focus();
    external.blur();
    view.rerender(shell('drawer'));
    expect(document.activeElement).toBe(document.body);
  });
});
