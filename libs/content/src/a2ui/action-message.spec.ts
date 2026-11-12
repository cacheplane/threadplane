import { describe, expect, it, vi } from 'vitest';
import type { A2uiMessage } from '@threadplane/a2ui';
import { createA2uiActionMessage, createA2uiSurfaces } from './index.js';

function surface(components: readonly Record<string, unknown>[], data: unknown = {}, sendDataModel?: boolean) {
  const owner = createA2uiSurfaces();
  for (const message of [
    { version: 'v0.9', createSurface: { surfaceId: 's', catalogId: 'basic', ...(sendDataModel === undefined ? {} : { sendDataModel }) } },
    { version: 'v0.9', updateComponents: { surfaceId: 's', components } },
    { version: 'v0.9', updateDataModel: { surfaceId: 's', value: data } },
  ])
    owner.apply(message as unknown as A2uiMessage);
  return owner;
}
const book = [
  { id: 'root', component: 'Column', children: ['go'] },
  {
    id: 'go', component: 'Button', child: 'label',
    action: { event: { name: 'book', context: {
      guest: { path: '/form/name' }, first: { path: '/form/tags/0' }, absent: { path: '/nope/x' },
      source: 'form', count: 2, flag: false, list: [1, 2], nothing: null,
      computed: { call: 'formatDate', args: {} },
    } } },
  },
  { id: 'label', component: 'Text', text: 'Book now' },
];
const data = { form: { name: 'Ada', tags: ['vip'] } };
const AT = '2026-11-11T00:00:00.000Z';

describe('createA2uiActionMessage', () => {
  it('resolves path context from the current data model and keeps literals', () => {
    const owner = surface(book, data);
    expect(createA2uiActionMessage(owner.getSnapshot().surfaces[0], 'go', AT)).toEqual({
      version: 'v0.9',
      action: {
        name: 'book', surfaceId: 's', sourceComponentId: 'go', timestamp: AT, label: 'Book now',
        context: { guest: 'Ada', first: 'vip', absent: undefined, source: 'form', count: 2, flag: false, list: [1, 2], nothing: null },
      },
    });
  });

  it('reads a local edit made after the surface was built', () => {
    const owner = surface(book, data);
    owner.setValue('s', '/form/name', 'Grace');
    expect(createA2uiActionMessage(owner.getSnapshot().surfaces[0], 'go', AT)?.action.context['guest']).toBe('Grace');
  });

  it('leaves function-call context values out', () => {
    const message = createA2uiActionMessage(surface(book, data).getSnapshot().surfaces[0], 'go', AT);
    expect(Object.hasOwn(message?.action.context ?? {}, 'computed')).toBe(false);
  });

  it('attaches the whole data model only when the surface asked for it', () => {
    const snapshot = (flag?: boolean) => surface(book, data, flag).getSnapshot().surfaces[0];
    expect(createA2uiActionMessage(snapshot(), 'go', AT)?.metadata).toBeUndefined();
    expect(createA2uiActionMessage(snapshot(false), 'go', AT)?.metadata).toBeUndefined();
    const sent = snapshot(true);
    expect(createA2uiActionMessage(sent, 'go', AT)?.metadata).toEqual({ a2uiClientDataModel: { surfaces: { s: data } } });
    expect(createA2uiActionMessage(sent, 'go', AT)?.metadata?.a2uiClientDataModel.surfaces['s']).toBe(sent.dataModel);
  });

  it('labels only a Button whose child is literal text', () => {
    const label = (components: readonly Record<string, unknown>[], id = 'go') =>
      createA2uiActionMessage(surface(components, { t: 'Bound' }).getSnapshot().surfaces[0], id, AT)?.action.label;
    const action = { event: { name: 'x' } };
    const root = { id: 'root', component: 'Column', children: ['go'] };
    expect(label([root, { id: 'go', component: 'Button', child: 'l', action }, { id: 'l', component: 'Text', text: { path: '/t' } }])).toBeUndefined();
    expect(label([root, { id: 'go', component: 'Button', child: 'l', action }, { id: 'l', component: 'Text', text: '' }])).toBeUndefined();
    expect(label([root, { id: 'go', component: 'Button', child: 'l', action }, { id: 'l', component: 'Icon', text: 'Icon' }])).toBeUndefined();
    expect(label([root, { id: 'go', component: 'Button', child: 'missing', action }])).toBeUndefined();
    expect(label([root, { id: 'go', component: 'Card', child: 'l', action }, { id: 'l', component: 'Text', text: 'Card text' }])).toBeUndefined();
  });

  it('uses an empty context when none is authored', () => {
    const owner = surface([{ id: 'root', component: 'Button', action: { event: { name: 'ping' } } }]);
    expect(createA2uiActionMessage(owner.getSnapshot().surfaces[0], 'root', AT)?.action.context).toEqual({});
  });

  it('returns null for a missing component or anything that is not an event action', () => {
    const owner = surface([
      { id: 'root', component: 'Column', children: [] },
      { id: 'none', component: 'Button' },
      { id: 'local', component: 'Button', action: { functionCall: { call: 'openUrl', args: { url: 'https://example.test' } } } },
      { id: 'unnamed', component: 'Button', action: { event: { context: {} } } },
      { id: 'text', component: 'Button', action: 'book' },
      { id: 'list', component: 'Button', action: { event: ['book'] } },
    ]);
    const snapshot = owner.getSnapshot().surfaces[0];
    for (const id of ['missing', 'root', 'none', 'local', 'unnamed', 'text', 'list', 'toString'])
      expect(createA2uiActionMessage(snapshot, id, AT), id).toBeNull();
  });

  it('stamps the current time by default and returns frozen data', () => {
    vi.useFakeTimers({ now: new Date('2030-01-02T03:04:05.006Z') });
    const message = createA2uiActionMessage(surface(book, data, true).getSnapshot().surfaces[0], 'go');
    vi.useRealTimers();
    expect(message?.action.timestamp).toBe('2030-01-02T03:04:05.006Z');
    for (const value of [message, message?.action, message?.action.context, message?.metadata, message?.metadata?.a2uiClientDataModel.surfaces])
      expect(Object.isFrozen(value)).toBe(true);
  });
});
