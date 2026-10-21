import { StrictMode, useEffect, useState } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatSidebar } from './index';

afterEach(cleanup);

describe('ChatSidebar', () => {
  it('reserves page space only for accepted open and opt-in push props', () => {
    const change = vi.fn();
    const sidebar = (open: boolean, pushContent?: boolean) => (
      <ChatSidebar
        open={open}
        pushContent={pushContent}
        title="Support"
        onOpenChange={change}
        pageContent={<input aria-label="Page filter" />}
      />
    );
    const view = render(sidebar(false));
    const layout = view.container.querySelector('.tp-chat-sidebar-layout');
    const page = view.container.querySelector('.tp-chat-sidebar-layout__page');
    expect(layout).toBeTruthy();
    expect(page?.contains(view.getByRole('textbox'))).toBe(true);
    expect(layout?.classList.contains('tp-chat-sidebar-layout--push')).toBe(
      false
    );
    fireEvent.click(view.getByRole('button', { name: 'Chat' }));
    expect(change).toHaveBeenLastCalledWith(true);
    expect(layout?.classList.contains('tp-chat-sidebar-layout--push')).toBe(
      false
    );
    view.rerender(sidebar(true));
    expect(layout?.classList.contains('tp-chat-sidebar-layout--push')).toBe(
      false
    );
    view.rerender(sidebar(true, true));
    expect(layout?.classList.contains('tp-chat-sidebar-layout--push')).toBe(
      true
    );
    view.rerender(sidebar(false, true));
    expect(layout?.classList.contains('tp-chat-sidebar-layout--push')).toBe(
      false
    );
    view.rerender(sidebar(true, false));
    expect(layout?.classList.contains('tp-chat-sidebar-layout--push')).toBe(
      false
    );
  });

  it('retains the page, panel and drafts across layout and page-presence changes', () => {
    const sidebar = (open: boolean, pushContent: boolean, hasPage = true) => (
      <StrictMode>
        <ChatSidebar
          open={open}
          pushContent={pushContent}
          title="Support"
          onOpenChange={vi.fn()}
          pageContent={
            hasPage ? (
              <input aria-label="Page filter" defaultValue="" />
            ) : undefined
          }
        >
          <textarea aria-label="Panel draft" defaultValue="" />
        </ChatSidebar>
      </StrictMode>
    );
    const view = render(sidebar(true, true));
    const page = view.container.querySelector('.tp-chat-sidebar-layout__page');
    const panel = view.getByRole('dialog');
    const filter = view.getByRole('textbox', {
      name: 'Page filter',
    }) as HTMLInputElement;
    const draft = view.getByRole('textbox', {
      name: 'Panel draft',
    }) as HTMLTextAreaElement;
    fireEvent.change(filter, { target: { value: 'Saved filter' } });
    fireEvent.change(draft, { target: { value: 'Unsent draft' } });
    filter.focus();
    for (const [open, push] of [
      [true, false],
      [false, false],
      [false, true],
      [true, true],
    ]) {
      view.rerender(sidebar(open, push));
      expect(
        view.container.querySelector('.tp-chat-sidebar-layout__page')
      ).toBe(page);
      expect(view.container.querySelector('[role="dialog"]')).toBe(panel);
      expect(view.getByRole('textbox', { name: 'Page filter' })).toBe(filter);
      expect(filter.closest('[hidden], [inert], [role="dialog"]')).toBeNull();
      expect(filter.value).toBe('Saved filter');
      expect(view.container.querySelector('textarea')).toBe(draft);
      expect(draft.value).toBe('Unsent draft');
      // Accepted opening focuses the close button; layout-only changes do not.
      if (!open) expect(document.activeElement).toBe(filter);
      filter.focus();
    }
    view.rerender(sidebar(false, true, false));
    expect(view.container.querySelector('.tp-chat-sidebar-layout__page')).toBe(
      page
    );
    expect(page?.childNodes).toHaveLength(0);
    expect(view.container.querySelector('textarea')).toBe(draft);
    view.rerender(sidebar(true, false));
    expect(view.container.querySelector('[role="dialog"]')).toBe(panel);
    expect(view.container.querySelector('textarea')).toBe(draft);
    expect(draft.value).toBe('Unsent draft');
  });

  it('forwards labels, title, children and classes onto one non-modal popup with stable unique IDs', () => {
    const sidebar = (open: boolean) => (
      <>
        <ChatSidebar
          open={open}
          title="Support"
          launcherLabel="Ask"
          closeLabel="Dismiss"
          className="custom"
          onOpenChange={vi.fn()}
        >
          <p>Conversation</p>
        </ChatSidebar>
        <ChatSidebar open={false} title="Other" onOpenChange={vi.fn()} />
      </>
    );
    const view = render(sidebar(true));
    expect(view.container.children).toHaveLength(2);
    const root = view.container.querySelector('.tp-chat-popup');
    expect(root?.classList.contains('tp-chat-popup')).toBe(true);
    expect(root?.classList.contains('tp-chat-sidebar')).toBe(true);
    expect(root?.classList.contains('custom')).toBe(true);
    const panel = view.getByRole('dialog', { name: 'Support' });
    expect(panel.getAttribute('aria-modal')).toBe('false');
    expect(view.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
    expect(view.getByText('Conversation')).toBeTruthy();
    const launcher = view.getByRole('button', { name: 'Ask' });
    expect(launcher.getAttribute('aria-controls')).toBe(panel.id);
    const panels = [...view.container.querySelectorAll('[role="dialog"]')];
    expect(new Set(panels.map((item) => item.id)).size).toBe(2);
    expect(
      new Set(panels.map((item) => item.getAttribute('aria-labelledby'))).size
    ).toBe(2);
    const titleId = panel.getAttribute('aria-labelledby');
    expect(view.getByRole('heading', { name: 'Support' }).id).toBe(titleId);
    view.rerender(sidebar(false));
    expect(view.container.querySelector('[role="dialog"]')).toBe(panel);
    expect(panel.getAttribute('aria-labelledby')).toBe(titleId);
  });

  it('waits for accepted open and close props and returns focus to the launcher', () => {
    const change = vi.fn();
    const sidebar = (open: boolean) => (
      <ChatSidebar open={open} title="Support" onOpenChange={change}>
        <input aria-label="Message" />
      </ChatSidebar>
    );
    const view = render(sidebar(false));
    const root = view.container.querySelector('.tp-chat-popup');
    const launcher = view.getByRole('button', { name: 'Chat' });
    const panel = view.container.querySelector('[role="dialog"]');
    launcher.focus();
    fireEvent.click(launcher);
    expect(change).toHaveBeenLastCalledWith(true);
    view.rerender(sidebar(false));
    expect(root?.classList.contains('tp-chat-sidebar--open')).toBe(false);
    expect(panel?.hasAttribute('hidden')).toBe(true);
    expect(panel?.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(launcher);
    view.rerender(sidebar(true));
    expect(root?.classList.contains('tp-chat-sidebar--open')).toBe(true);
    expect(launcher.getAttribute('aria-expanded')).toBe('true');
    expect(panel?.hasAttribute('hidden')).toBe(false);
    expect(panel?.hasAttribute('inert')).toBe(false);
    const close = view.getByRole('button', { name: 'Close chat' });
    expect(document.activeElement).toBe(close);
    const input = view.getByRole('textbox');
    input.focus();
    fireEvent.click(close);
    expect(change).toHaveBeenLastCalledWith(false);
    view.rerender(sidebar(true));
    expect(root?.classList.contains('tp-chat-sidebar--open')).toBe(true);
    expect(document.activeElement).toBe(input);
    view.rerender(sidebar(false));
    expect(root?.classList.contains('tp-chat-sidebar--open')).toBe(false);
    expect(launcher.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(launcher);
  });

  it('retains a child draft and DOM through accepted toggles in StrictMode', () => {
    const mount = vi.fn();
    const unmount = vi.fn();
    function Draft() {
      const [draft, setDraft] = useState('');
      useEffect(() => {
        mount();
        return unmount;
      }, []);
      return (
        <textarea
          aria-label="Draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      );
    }
    const sidebar = (open: boolean) => (
      <StrictMode>
        <ChatSidebar open={open} title="Support" onOpenChange={vi.fn()}>
          <Draft />
        </ChatSidebar>
      </StrictMode>
    );
    const view = render(sidebar(true));
    const input = view.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Unsent draft' } });
    const mounts = mount.mock.calls.length;
    const unmounts = unmount.mock.calls.length;
    view.rerender(sidebar(false));
    expect(view.container.querySelector('textarea')).toBe(input);
    view.rerender(sidebar(true));
    expect(view.getByRole('textbox')).toBe(input);
    expect(input.value).toBe('Unsent draft');
    expect(mount).toHaveBeenCalledTimes(mounts);
    expect(unmount).toHaveBeenCalledTimes(unmounts);
  });

  it('preserves external focus at closed mount and accepted close', () => {
    const external = document.createElement('button');
    document.body.append(external);
    external.focus();
    const sidebar = (open: boolean) => (
      <ChatSidebar open={open} title="Support" onOpenChange={vi.fn()} />
    );
    const view = render(sidebar(false));
    expect(document.activeElement).toBe(external);
    view.rerender(sidebar(true));
    expect(document.activeElement).toBe(
      view.getByRole('button', { name: 'Close chat' })
    );
    external.focus();
    view.rerender(sidebar(false));
    expect(document.activeElement).toBe(external);
    external.remove();
  });

  it('forwards scoped Escape handling, IME guards, child claims and disabled dismissal', () => {
    const change = vi.fn();
    const outer = vi.fn();
    const sidebar = (open: boolean, closeOnEscape = true, claimed = false) => (
      <div onKeyDown={outer}>
        <button>Outside</button>
        <ChatSidebar
          open={open}
          title="Support"
          closeOnEscape={closeOnEscape}
          onOpenChange={change}
        >
          <input
            aria-label="Message"
            onKeyDown={(event) => {
              if (claimed) event.preventDefault();
            }}
          />
        </ChatSidebar>
      </div>
    );
    const view = render(sidebar(true));
    const input = view.getByRole('textbox');
    for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
      expect(fireEvent.keyDown(input, { key: 'Escape', ...composition })).toBe(
        true
      );
    }
    fireEvent.keyDown(view.getByRole('button', { name: 'Outside' }), {
      key: 'Escape',
    });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(change).not.toHaveBeenCalled();
    outer.mockClear();
    expect(fireEvent.keyDown(input, { key: 'Escape' })).toBe(false);
    expect(change).toHaveBeenCalledExactlyOnceWith(false);
    expect(outer).not.toHaveBeenCalled();
    change.mockClear();
    view.rerender(sidebar(true, true, true));
    fireEvent.keyDown(input, { key: 'Escape' });
    view.rerender(sidebar(true, false));
    expect(fireEvent.keyDown(input, { key: 'Escape' })).toBe(true);
    view.rerender(sidebar(false));
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(change).not.toHaveBeenCalled();
  });
});
