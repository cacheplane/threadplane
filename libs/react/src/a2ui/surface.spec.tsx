import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createA2uiSurfaces,
  type A2uiSurfaces,
  type A2uiSurfaceSnapshot,
} from '@threadplane/content/a2ui';
import type { RenderViewProps } from '../render/index';
import { A2uiSurface, a2uiBasicCatalog } from './index';
import { a2uiSurfaceSpec } from './surface-spec';

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
const trip = surface(
  [
    { id: 'root', component: 'Column', children: ['title', 'card', 'rule', 'row'] },
    { id: 'title', component: 'Text', text: 'Lyon trip', variant: 'h2' },
    { id: 'card', component: 'Card', child: 'body' },
    { id: 'body', component: 'Text', text: { path: '/summary' } },
    { id: 'rule', component: 'Divider' },
    { id: 'row', component: 'Row', children: ['a', 'b'], justify: 'spaceBetween', align: 'center' },
    { id: 'a', component: 'Text', text: 'Depart', variant: 'caption' },
    { id: 'b', component: 'Text', text: '09:40' },
  ],
  { summary: 'Two nights <b>in</b> Lyon' }
);

describe('A2uiSurface', () => {
  it('renders a static tree of the five basic components in document order', () => {
    const view = render(<A2uiSurface surface={trip} className="mine" />);
    const root = view.container.firstElementChild as HTMLElement;
    expect(root.className).toBe('a2ui-surface mine');
    expect(root.getAttribute('data-surface-id')).toBe('s1');
    const column = root.firstElementChild as HTMLElement;
    expect(column.className).toBe('a2ui-col');
    expect([...column.children].map((el) => el.className)).toEqual([
      'a2ui-text-h2',
      'a2ui-card',
      'a2ui-divider a2ui-divider--horizontal',
      'a2ui-row',
    ]);
    expect(column.children[2].tagName).toBe('HR');
    const row = column.children[3] as HTMLElement;
    expect(row.style.justifyContent).toBe('space-between');
    expect(row.style.alignItems).toBe('center');
    expect([...row.children].map((el) => el.textContent)).toEqual([
      'Depart',
      '09:40',
    ]);
  });

  it('exposes heading variants as headings and other text as plain text', () => {
    const view = render(<A2uiSurface surface={trip} />);
    const heading = view.getByRole('heading', { name: 'Lyon trip' });
    expect(heading.getAttribute('aria-level')).toBe('2');
    expect(view.getAllByRole('heading')).toHaveLength(1);
    expect(view.getByText('Depart').className).toBe('a2ui-text-caption');
    expect(view.getByText('09:40').className).toBe('a2ui-text-body');
  });

  it('reads a path prop from the surface data model as literal text', () => {
    const view = render(<A2uiSurface surface={trip} />);
    const body = view.container.querySelector('.a2ui-card > span');
    expect(body?.textContent).toBe('Two nights <b>in</b> Lyon');
    expect(body?.querySelector('b')).toBeNull();
    view.rerender(
      <A2uiSurface
        surface={{ ...trip, dataModel: { summary: 'Three nights' } }}
      />
    );
    expect(view.container.querySelector('.a2ui-card > span')?.textContent).toBe(
      'Three nights'
    );
  });

  it('maps align, justify and gap, and falls back for unknown values', () => {
    const view = render(
      <A2uiSurface
        surface={surface([
          { id: 'root', component: 'Row', children: ['c1', 'c2', 'c3'], justify: 'stretch', align: 'end', gap: 2 },
          { id: 'c1', component: 'Column', children: [], justify: 'center', gap: 'large' },
          { id: 'c2', component: 'Column', children: [], justify: 'constructor', align: 'toString' },
          { id: 'c3', component: 'Divider', axis: 'vertical' },
        ])}
      />
    );
    const row = view.container.querySelector('.a2ui-row') as HTMLElement;
    expect(row.className).toBe('a2ui-row a2ui-row--justify-stretch');
    expect(row.style.justifyContent).toBe('normal');
    expect(row.style.alignItems).toBe('flex-end');
    expect(row.style.gap).toBe('8px');
    const [first, second] = [
      ...view.container.querySelectorAll<HTMLElement>('.a2ui-col'),
    ];
    expect(first.style.justifyContent).toBe('center');
    expect(first.style.gap).toBe('16px');
    expect(second.style.justifyContent).toBe('flex-start');
    expect(second.style.alignItems).toBe('stretch');
    expect(second.style.gap).toBe('');
    const rule = row.lastElementChild as HTMLElement;
    expect(rule.tagName).toBe('DIV');
    expect(rule.className).toBe('a2ui-divider a2ui-divider--vertical');
  });

  it('keeps the children of a component the catalog lacks', () => {
    const view = render(
      <A2uiSurface
        surface={surface([
          { id: 'root', component: 'Column', children: ['button', 'after'] },
          { id: 'button', component: 'Carousel', child: 'label', action: { event: { name: 'go' } } },
          { id: 'label', component: 'Text', text: 'Book' },
          { id: 'after', component: 'Text', text: 'After' },
        ])}
      />
    );
    const marker = view.container.querySelector('[data-a2ui-unsupported]');
    expect(marker?.getAttribute('data-a2ui-unsupported')).toBe('button');
    expect(marker?.textContent).toBe('Book');
    expect(view.queryByRole('button')).toBeNull();
    expect(view.getByText('After')).toBeTruthy();
  });

  it('uses an app catalog in place of the basic one', () => {
    const Badge = ({ props }: RenderViewProps) => (
      <mark>{String(props['text'])}</mark>
    );
    const catalog = { ...a2uiBasicCatalog(), Text: Badge };
    const view = render(<A2uiSurface surface={trip} catalog={catalog} />);
    expect(view.container.querySelectorAll('mark')).toHaveLength(4);
    expect(view.container.querySelector('.a2ui-col')).toBeTruthy();
  });

  it('renders nothing inside the surface when there are no components', () => {
    const view = render(<A2uiSurface surface={surface([])} />);
    const root = view.container.firstElementChild as HTMLElement;
    expect(root.className).toBe('a2ui-surface');
    expect(root.childElementCount).toBe(0);
  });

  it('renders a surface accumulated from wire messages', () => {
    const surfaces = createA2uiSurfaces();
    const messages = [
      { version: 'v0.9', createSurface: { surfaceId: 'wire', catalogId: 'basic' } },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'wire',
          components: [
            { id: 'root', component: 'Card', child: 'text' },
            { id: 'text', component: 'Text', text: { path: '/greeting' } },
          ],
        },
      },
      { version: 'v0.9', updateDataModel: { surfaceId: 'wire', path: '/greeting', value: 'Bonjour' } },
    ] as unknown as Parameters<A2uiSurfaces['apply']>[0][];
    for (const message of messages) surfaces.apply(message);
    const [published] = surfaces.getSnapshot().surfaces;
    const view = render(
      <StrictMode>
        <A2uiSurface surface={published} />
      </StrictMode>
    );
    expect(view.container.querySelector('.a2ui-card')?.textContent).toBe(
      'Bonjour'
    );
    surfaces.dispose();
  });

  it('server renders the same tree', () => {
    const html = renderToString(<A2uiSurface surface={trip} />);
    expect(html).toContain('data-surface-id="s1"');
    expect(html).toContain('role="heading"');
    expect(html).toContain('Two nights &lt;b&gt;in&lt;/b&gt; Lyon');
  });
});

describe('a2uiSurfaceSpec', () => {
  it('drops protocol keys, resolves function calls, and binds path props', () => {
    const { spec, state } = a2uiSurfaceSpec(
      surface(
        [
          {
            id: 'root',
            component: 'Text',
            text: { path: '/a' },
            variant: 'h1',
            weight: 2,
            accessibility: { label: 'x' },
            hint: { call: 'formatString', args: { value: '${/a}!' } },
            gone: { call: 'launch', args: {} },
          },
        ],
        { a: 'A' }
      )
    );
    expect(spec?.root).toBe('root');
    expect(spec?.elements['root']).toEqual({
      type: 'Text',
      props: { text: { $bindState: '/a' }, variant: 'h1', hint: 'A!' },
      children: [],
    });
    expect(state).toEqual({ a: 'A' });
  });

  it('uses the first component as root when none is named root', () => {
    const { spec } = a2uiSurfaceSpec(
      surface([
        { id: 'first', component: 'Card', child: 'second' },
        { id: 'second', component: 'Text', text: 'x' },
      ])
    );
    expect(spec?.root).toBe('first');
    expect(Object.keys(spec?.elements ?? {})).toEqual(['first', 'second']);
  });

  it('keeps each reachable component once and drops cycles, missing ids and a template without a list', () => {
    const { spec } = a2uiSurfaceSpec(
      surface([
        { id: 'root', component: 'Column', children: ['a', 'missing', 'a', 'list'] },
        { id: 'a', component: 'Card', child: 'root' },
        { id: 'list', component: 'Row', children: { path: '/items', componentId: 'a' } },
        { id: 'orphan', component: 'Text', text: 'unreachable' },
      ])
    );
    expect(Object.keys(spec?.elements ?? {})).toEqual(['root', 'a', 'list']);
    expect(spec?.elements['root'].children).toEqual(['a', 'list']);
    expect(spec?.elements['a'].children).toEqual([]);
    expect(spec?.elements['list'].children).toEqual([]);
  });

  it('returns no spec and empty state for an empty surface with non-object data', () => {
    expect(a2uiSurfaceSpec(surface([], 'text'))).toEqual({
      spec: null,
      state: {},
      sources: new Map(),
    });
  });
});
