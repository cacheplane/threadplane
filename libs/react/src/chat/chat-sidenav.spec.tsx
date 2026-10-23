import { StrictMode, useEffect, useState } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatSidenav, type ChatSidenavMode } from './index';

afterEach(cleanup);

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
