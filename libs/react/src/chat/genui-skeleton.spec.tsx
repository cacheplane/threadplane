import { renderToString } from 'react-dom/server';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import * as chat from './index';

const GenerativeUiSkeleton = chat.GenerativeUiSkeleton;

afterEach(cleanup);

describe('GenerativeUiSkeleton', () => {
  it('announces a default label politely and hides the decorative rows', () => {
    const view = render(<GenerativeUiSkeleton />);
    const status = view.getByRole('status');
    expect(status.className).toBe('tp-genui-skeleton');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.getAttribute('aria-atomic')).toBe('true');
    expect(status.textContent).toBe('Building UI…');
    const rows = status.querySelector('.tp-genui-skeleton__rows') as HTMLElement;
    expect(rows.getAttribute('aria-hidden')).toBe('true');
    expect(rows.children).toHaveLength(3);
    expect(status.querySelectorAll('button, a, input, [tabindex]')).toHaveLength(0);
  });

  it('renders a supplied label literally and keeps the caller class', () => {
    const view = render(<GenerativeUiSkeleton label="<b>Drawing</b> the seat map" className="mine" />);
    const status = view.getByRole('status');
    expect(status.className).toBe('tp-genui-skeleton mine');
    expect(status.textContent).toBe('<b>Drawing</b> the seat map');
    expect(status.querySelector('b')).toBeNull();
  });

  it('stays silent when the owner announces progress itself', () => {
    const view = render(<GenerativeUiSkeleton announce={false} />);
    expect(view.queryByRole('status')).toBeNull();
    const root = view.container.firstElementChild as HTMLElement;
    expect(root.hasAttribute('aria-live')).toBe(false);
    expect(root.hasAttribute('aria-atomic')).toBe(false);
    expect(root.textContent).toBe('Building UI…');
  });

  it('keeps its element across label changes', () => {
    const view = render(<GenerativeUiSkeleton label="One" />);
    const status = view.getByRole('status');
    view.rerender(<GenerativeUiSkeleton label="Two" />);
    expect(view.getByRole('status')).toBe(status);
    expect(status.textContent).toBe('Two');
  });

  it('server renders without browser globals', () => {
    expect(renderToString(<GenerativeUiSkeleton label="Wait" />)).toBe(
      '<div class="tp-genui-skeleton" role="status" aria-live="polite" aria-atomic="true"><span class="tp-genui-skeleton__label">Wait</span><span class="tp-genui-skeleton__rows" aria-hidden="true"><span class="tp-genui-skeleton__row"></span><span class="tp-genui-skeleton__row"></span><span class="tp-genui-skeleton__row"></span></span></div>'
    );
  });
});
