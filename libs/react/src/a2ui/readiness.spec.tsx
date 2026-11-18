import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { A2uiSurfaceSnapshot } from '@threadplane/content/a2ui';
import type { RenderViewProps } from '../render/index';
import { A2uiSurface } from './index';

afterEach(cleanup);

type Component = A2uiSurfaceSnapshot['components'][number];
const surface = (
  components: readonly Component[],
  dataModel: A2uiSurfaceSnapshot['dataModel'] = {}
): A2uiSurfaceSnapshot => ({
  surfaceId: 's1',
  catalogId: 'basic',
  components,
  dataModel,
});
const components: readonly Component[] = [
  { id: 'root', component: 'Column', children: ['title', 'guest'] },
  { id: 'title', component: 'Text', text: { path: '/title' } },
  {
    id: 'guest',
    component: 'TextField',
    label: { path: '/guestLabel' },
    value: { path: '/guest' },
  },
];

describe('A2uiSurface readiness', () => {
  it('shows placeholders for components that arrive before the data model, then mounts them', () => {
    const view = render(<A2uiSurface surface={surface(components)} />);
    const pending = view.getAllByRole('status');
    expect(pending).toHaveLength(2);
    expect(pending.every((el) => el.closest('.a2ui-surface'))).toBe(true);
    expect(view.queryByRole('textbox')).toBeNull();

    // The input value is never seeded: the person fills it in.
    view.rerender(
      <A2uiSurface
        surface={surface(components, { title: 'Lyon trip', guestLabel: 'Guest' })}
      />
    );
    expect(view.queryByRole('status')).toBeNull();
    expect(view.container.textContent).toContain('Lyon trip');
    expect((view.getByLabelText('Guest') as HTMLInputElement).value).toBe('');
  });

  it('keeps a mounted component when its data later goes missing', () => {
    const view = render(
      <A2uiSurface
        surface={surface(components, { title: 'Lyon trip', guestLabel: 'Guest' })}
      />
    );
    const field = view.getByRole('textbox');
    view.rerender(<A2uiSurface surface={surface(components)} />);
    expect(view.queryByRole('status')).toBeNull();
    expect(view.getByRole('textbox')).toBe(field);
  });

  it('takes a custom pendingFallback, or null to mount at once', () => {
    const Pending = ({ elementKey }: RenderViewProps) => (
      <p data-pending={elementKey}>waiting</p>
    );
    const view = render(
      <A2uiSurface surface={surface(components)} pendingFallback={Pending} />
    );
    expect(
      [...view.container.querySelectorAll('[data-pending]')].map((el) =>
        el.getAttribute('data-pending')
      )
    ).toEqual(['title', 'guest']);
    cleanup();
    const eager = render(
      <A2uiSurface surface={surface(components)} pendingFallback={null} />
    );
    expect(eager.queryByRole('status')).toBeNull();
    expect(eager.getByRole('textbox')).toBeTruthy();
  });
});
