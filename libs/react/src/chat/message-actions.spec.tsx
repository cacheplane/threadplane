import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageActions } from './index';

afterEach(cleanup);
describe('MessageActions', () => {
  it('renders an authored group with native buttons and literal labels', () => {
    const onSelect = vi.fn();
    const view = render(
      <MessageActions
        label="Answer controls"
        className="custom"
        actions={[{ id: 'copy', label: '<b>Copy</b>', onSelect }]}
      />
    );
    expect(view.getByRole('group', { name: 'Answer controls' }).className).toBe(
      'tp-message-actions custom'
    );
    const button = view.getByRole('button', { name: '<b>Copy</b>' });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.querySelector('b')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(onSelect.mock.calls).toEqual([[]]);
  });
  it('honors root and per-action disabled state', () => {
    const onSelect = vi.fn();
    const actions = [
      { id: 'one', label: 'One', onSelect },
      { id: 'two', label: 'Two', onSelect, disabled: true },
    ];
    const view = render(<MessageActions actions={actions} disabled />);
    for (const button of view.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(button);
    }
    expect(onSelect).not.toHaveBeenCalled();
    view.rerender(<MessageActions actions={actions} />);
    fireEvent.click(view.getByText('Two'));
    fireEvent.click(view.getByText('One'));
    expect(onSelect).toHaveBeenCalledOnce();
  });
  it('uses current same-ID callbacks without implicit consumption', () => {
    const old = vi.fn(),
      current = vi.fn();
    const view = render(
      <MessageActions actions={[{ id: 'one', label: 'Old', onSelect: old }]} />
    );
    view.rerender(
      <MessageActions
        actions={[{ id: 'one', label: 'Current', onSelect: current }]}
      />
    );
    fireEvent.click(view.getByText('Current'));
    fireEvent.click(view.getByText('Current'));
    expect(current).toHaveBeenCalledTimes(2);
    expect(old).not.toHaveBeenCalled();
    expect(view.getByRole('group', { name: 'Message actions' })).toBeTruthy();
  });
  it('is inert across StrictMode, replacement and remount, and hides empty groups', () => {
    const onSelect = vi.fn();
    const actions = [{ id: 'x', label: 'X', onSelect }];
    const view = render(
      <StrictMode>
        <MessageActions actions={actions} />
      </StrictMode>
    );
    view.rerender(
      <StrictMode>
        <MessageActions actions={[]} />
      </StrictMode>
    );
    expect(view.queryByRole('group')).toBeNull();
    view.unmount();
    render(<MessageActions actions={actions} />);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'isolates decorative SVG names with compact=%s',
    (iconOnly) => {
      const onSelect = vi.fn();
      const label = '<b>Copy & "quote"</b>';
      const view = render(
        <MessageActions
          actions={[
            {
              id: 'copy',
              label,
              onSelect,
              iconOnly,
              icon: (
                <svg>
                  <title>Delete everything</title>
                  <path d="M0 0h16" />
                </svg>
              ),
            },
          ]}
        />
      );
      const button = view.getByRole('button', { name: label });
      const icon = button.querySelector('.tp-message-actions__icon');
      const literal = button.querySelector('.tp-message-actions__label');
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
      expect(icon?.querySelector('title')?.textContent).toBe(
        'Delete everything'
      );
      expect(literal?.textContent).toBe(label);
      expect(literal?.hasAttribute('hidden')).toBe(false);
      expect(literal?.hasAttribute('aria-hidden')).toBe(false);
      expect(literal?.getAttribute('style')).toBeNull();
      expect(button.querySelector('b')).toBeNull();
      expect(
        button.classList.contains('tp-message-actions__action--icon-only')
      ).toBe(iconOnly);
      expect(button.getAttribute('title')).toBe(iconOnly ? label : null);
      expect(onSelect).not.toHaveBeenCalled();
      fireEvent.click(button);
      expect(onSelect.mock.calls).toEqual([[]]);
    }
  );

  it.each([null, undefined, false, true])(
    'falls back to its label for absent icon %s',
    (icon) => {
      const view = render(
        <MessageActions
          actions={[
            {
              id: 'copy',
              label: 'Copy',
              onSelect: vi.fn(),
              icon,
              iconOnly: true,
            },
          ]}
        />
      );
      const button = view.getByRole('button', { name: 'Copy' });
      expect(button.querySelector('.tp-message-actions__icon')).toBeNull();
      expect(
        button.querySelector('.tp-message-actions__label')?.textContent
      ).toBe('Copy');
      expect(
        button.classList.contains('tp-message-actions__action--icon-only')
      ).toBe(false);
      expect(button.hasAttribute('title')).toBe(false);
    }
  );

  it.each([
    { name: 'zero', icon: 0, text: '0' },
    { name: 'string', icon: '*', text: '*' },
    { name: 'empty string', icon: '', text: '' },
    {
      name: 'array',
      icon: [<span key="one">One</span>, <span key="two">Two</span>],
      text: 'OneTwo',
    },
    { name: 'empty array', icon: [], text: '' },
    { name: 'fragment', icon: <>Fragment</>, text: 'Fragment' },
    { name: 'empty fragment', icon: <></>, text: '' },
    { name: 'null component', icon: <EmptyIcon />, text: '' },
  ])('preserves ordinary ReactNode semantics for $name', ({ icon, text }) => {
    const view = render(
      <MessageActions
        actions={[
          {
            id: 'copy',
            label: 'Copy',
            onSelect: vi.fn(),
            icon,
            iconOnly: true,
          },
        ]}
      />
    );
    const button = view.getByRole('button', { name: 'Copy' });
    expect(button.querySelector('.tp-message-actions__icon')?.textContent).toBe(
      text
    );
    expect(
      button.classList.contains('tp-message-actions__action--icon-only')
    ).toBe(true);
    expect(button.getAttribute('title')).toBe('Copy');
  });

  it('requires an explicitly true compact flag', () => {
    const view = render(
      <MessageActions
        actions={[
          { id: 'default', label: 'Default', onSelect: vi.fn(), icon: <svg /> },
          {
            id: 'false',
            label: 'False',
            onSelect: vi.fn(),
            icon: <svg />,
            iconOnly: false,
          },
        ]}
      />
    );
    for (const button of view.getAllByRole('button')) {
      expect(button.querySelector('.tp-message-actions__icon')).not.toBeNull();
      expect(
        button.classList.contains('tp-message-actions__action--icon-only')
      ).toBe(false);
      expect(button.hasAttribute('title')).toBe(false);
    }
  });

  it('preserves keyed native buttons and focus while updating presentation, order and callbacks', () => {
    const old = vi.fn(),
      current = vi.fn(),
      other = vi.fn();
    const second = {
      id: 'second',
      label: 'Second',
      onSelect: other,
      icon: <svg />,
      iconOnly: true,
    };
    const view = render(
      <MessageActions
        actions={[
          {
            id: 'copy',
            label: 'Old',
            onSelect: old,
            icon: <svg />,
            iconOnly: true,
          },
          second,
        ]}
      />
    );
    const button = view.getByRole('button', { name: 'Old' });
    const otherButton = view.getByRole('button', { name: 'Second' });
    button.focus();
    view.rerender(
      <MessageActions
        actions={[
          second,
          {
            id: 'copy',
            label: 'Current',
            onSelect: current,
            icon: 'New icon',
            iconOnly: false,
          },
        ]}
      />
    );
    expect(view.getAllByRole('button')).toEqual([otherButton, button]);
    expect(view.getByRole('button', { name: 'Current' })).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(button.querySelector('.tp-message-actions__icon')?.textContent).toBe(
      'New icon'
    );
    expect(button.hasAttribute('title')).toBe(false);
    expect(
      button.classList.contains('tp-message-actions__action--icon-only')
    ).toBe(false);
    expect(old).not.toHaveBeenCalled();
    expect(current).not.toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(current.mock.calls).toEqual([[], []]);

    view.rerender(
      <MessageActions
        actions={[
          {
            id: 'copy',
            label: 'Current',
            onSelect: current,
            icon: <svg />,
            iconOnly: true,
            disabled: true,
          },
        ]}
      />
    );
    expect(view.getByRole('button', { name: 'Current' })).toBe(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    view.rerender(
      <MessageActions
        disabled
        actions={[
          {
            id: 'copy',
            label: 'Current',
            onSelect: current,
            icon: <svg />,
            iconOnly: true,
          },
        ]}
      />
    );
    expect(view.getByRole('button', { name: 'Current' })).toBe(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(current.mock.calls).toEqual([[], []]);
    expect(old).not.toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();
  });

  it('does not invoke icon actions during StrictMode updates, removal or unmount', () => {
    const onSelect = vi.fn();
    const view = render(
      <StrictMode>
        <MessageActions
          actions={[
            {
              id: 'copy',
              label: 'Copy',
              onSelect,
              icon: <svg />,
              iconOnly: true,
            },
          ]}
        />
      </StrictMode>
    );
    expect(
      view.getByRole('button', { name: 'Copy' }).getAttribute('title')
    ).toBe('Copy');
    view.rerender(
      <StrictMode>
        <MessageActions
          actions={[
            {
              id: 'copy',
              label: 'Updated',
              onSelect,
              icon: '*',
              iconOnly: false,
            },
          ]}
        />
      </StrictMode>
    );
    view.rerender(
      <StrictMode>
        <MessageActions actions={[]} />
      </StrictMode>
    );
    expect(view.queryByRole('group')).toBeNull();
    view.unmount();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('server-renders escaped literal labels and compact tooltips without invoking actions', () => {
    const onSelect = vi.fn();
    const label = '<b>Copy & "quote"</b>';
    const markup = renderToString(
      <MessageActions
        actions={[
          {
            id: 'compact',
            label,
            onSelect,
            icon: (
              <svg>
                <title>Misleading name</title>
              </svg>
            ),
            iconOnly: true,
          },
          {
            id: 'absent',
            label: 'Fallback <label>',
            onSelect,
            icon: null,
            iconOnly: true,
          },
        ]}
      />
    );
    expect(markup).toContain(
      'class="tp-message-actions__action tp-message-actions__action--icon-only"'
    );
    expect(markup).toContain(
      'title="&lt;b&gt;Copy &amp; &quot;quote&quot;&lt;/b&gt;"'
    );
    expect(markup).toContain(
      '<span class="tp-message-actions__icon" aria-hidden="true"><svg><title>Misleading name</title></svg></span>'
    );
    expect(markup).toContain(
      '<span class="tp-message-actions__label">&lt;b&gt;Copy &amp; &quot;quote&quot;&lt;/b&gt;</span>'
    );
    expect(markup).toContain(
      '<button type="button" class="tp-message-actions__action"><span class="tp-message-actions__label">Fallback &lt;label&gt;</span></button>'
    );
    expect(markup).not.toContain('<b>');
    expect(onSelect).not.toHaveBeenCalled();
  });
});

function EmptyIcon() {
  return null;
}
