import { cleanup, fireEvent, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as chat from './index';

afterEach(cleanup);

describe('ScrollBubble', () => {
  for (const mode of ['idle', 'streaming'] as const) {
    it(`renders a passive ${mode} action with decorative artwork`, () => {
      const onClick = vi.fn();
      const view = render(
        <chat.ScrollBubble mode={mode} onClick={onClick} className="mine" />
      );
      const button = view.getByRole('button', {
        name:
          mode === 'idle'
            ? 'Scroll to latest'
            : 'Scroll to latest, response in progress',
      });
      expect(button.getAttribute('type')).toBe('button');
      expect(button.classList.contains('mine')).toBe(true);
      expect(view.getByText('Scroll to latest')).toBeTruthy();
      expect(view.container.querySelector('[aria-hidden="true"]')).toBeTruthy();
      expect(
        view.container.querySelector(
          '[aria-live],[role="status"],[role="alert"]'
        )
      ).toBeNull();
      expect(onClick).not.toHaveBeenCalled();
      fireEvent.click(button);
      expect(onClick.mock.calls).toEqual([[]]);
    });
    it(`keeps a custom ${mode} action label literal and prevents disabled activation`, () => {
      const onClick = vi.fn();
      const label = '<img src=x onerror=bad()> <script>literal</script>';
      const view = render(
        <chat.ScrollBubble
          mode={mode}
          onClick={onClick}
          label={label}
          disabled
        />
      );
      const button = view.getByRole('button', { name: label });
      expect(button.textContent).toContain(label);
      expect(view.container.querySelector('img,script')).toBeNull();
      fireEvent.click(button);
      expect(onClick).not.toHaveBeenCalled();
    });
  }
  it('leaves lifecycle, focus and visibility to the parent', () => {
    const onClick = vi.fn();
    const ui = (mode: 'idle' | 'streaming') => (
      <>
        <input aria-label="Draft" />
        <StrictMode>
          <chat.ScrollBubble mode={mode} onClick={onClick} />
        </StrictMode>
      </>
    );
    const view = render(ui('idle'));
    const draft = view.getByRole('textbox');
    draft.focus();
    view.rerender(ui('streaming'));
    expect(view.getAllByRole('button')).toHaveLength(1);
    expect(document.activeElement).toBe(draft);
    view.rerender(ui('idle'));
    expect(document.activeElement).toBe(draft);
    view.unmount();
    expect(onClick).not.toHaveBeenCalled();
  });
});
