import { describe, it, expect } from 'vitest';
import type { A2uiSurface, A2uiComponent } from '@threadplane/a2ui';
import { buildA2uiActionMessage } from './build-action-message';

function makeSurface(
  components: A2uiComponent[],
  dataModel: Record<string, unknown> = {},
  sendDataModel?: boolean,
): A2uiSurface {
  const map = new Map<string, A2uiComponent>();
  for (const c of components) map.set(c.id, c);
  return { surfaceId: 's1', catalogId: 'basic', sendDataModel, components: map, dataModel };
}

const c = (comp: Record<string, unknown>): A2uiComponent => comp as unknown as A2uiComponent;

function makeTextComp(): A2uiComponent {
  return c({ id: 'root', component: 'Text', text: 'hi' });
}

describe('buildA2uiActionMessage (v0.9)', () => {
  it('builds an action message with required fields', () => {
    const surface = makeSurface([makeTextComp()]);
    const params = {
      surfaceId: 's1',
      sourceComponentId: 'submit-btn',
      name: 'formSubmit',
      context: {},
    };
    const msg = buildA2uiActionMessage(params, surface);
    expect(msg.version).toBe('v0.9');
    expect(msg.action.name).toBe('formSubmit');
    expect(msg.action.surfaceId).toBe('s1');
    expect(msg.action.sourceComponentId).toBe('submit-btn');
    expect(msg.action.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(msg.metadata).toBeUndefined();
  });

  it('passes context values through unwrapped (v0.9 plain object)', () => {
    const surface = makeSurface([makeTextComp()]);
    const params = {
      surfaceId: 's1',
      sourceComponentId: 'btn',
      name: 'submit',
      context: { surface: 'feedback', score: 5, checked: true },
    };
    const msg = buildA2uiActionMessage(params, surface);
    expect(msg.action.context).toEqual({ surface: 'feedback', score: 5, checked: true });
  });

  it('attaches data model when sendDataModel is true', () => {
    const surface = makeSurface(
      [makeTextComp()],
      { name: 'Alice', email: 'alice@co.com' },
      true,
    );
    const params = { surfaceId: 's1', sourceComponentId: 'btn', name: 'submit', context: {} };
    const msg = buildA2uiActionMessage(params, surface);
    expect(msg.metadata).toBeDefined();
    expect(msg.metadata!.a2uiClientDataModel!.surfaces['s1']).toEqual({ name: 'Alice', email: 'alice@co.com' });
  });

  it('does not attach data model when sendDataModel is false', () => {
    const surface = makeSurface([makeTextComp()], {}, false);
    const params = { surfaceId: 's1', sourceComponentId: 'btn', name: 'submit', context: {} };
    const msg = buildA2uiActionMessage(params, surface);
    expect(msg.metadata).toBeUndefined();
  });

  it('defaults context to empty object when not provided in params', () => {
    const surface = makeSurface([makeTextComp()]);
    const params = { surfaceId: 's1', sourceComponentId: 'btn', name: 'click' } as Record<string, unknown>;
    const msg = buildA2uiActionMessage(params, surface);
    expect(msg.action.context).toEqual({});
  });

  it('derives action.label from source Button child Text', () => {
    const components: A2uiComponent[] = [
      c({ id: 'submit-btn', component: 'Button', child: 'submit-label',
        action: { event: { name: 'formSubmit' } } }),
      c({ id: 'submit-label', component: 'Text', text: 'Search flights' }),
    ];
    const surface = makeSurface(components);
    const params = { surfaceId: 's1', sourceComponentId: 'submit-btn', name: 'formSubmit', context: {} };
    const msg = buildA2uiActionMessage(params, surface);
    expect(msg.action.label).toBe('Search flights');
  });

  it('leaves action.label undefined when Button child Text is a path binding', () => {
    const components: A2uiComponent[] = [
      c({ id: 'btn', component: 'Button', child: 'lbl', action: { event: { name: 'go' } } }),
      c({ id: 'lbl', component: 'Text', text: { path: '/cta' } }),
    ];
    const surface = makeSurface(components);
    const params = { surfaceId: 's1', sourceComponentId: 'btn', name: 'go', context: {} };
    const msg = buildA2uiActionMessage(params, surface);
    expect(msg.action.label).toBeUndefined();
  });

  it('leaves action.label undefined when source is not a Button', () => {
    const components: A2uiComponent[] = [
      c({ id: 'cb', component: 'CheckBox', label: 'Agree', value: false }),
    ];
    const surface = makeSurface(components);
    const params = { surfaceId: 's1', sourceComponentId: 'cb', name: 'agreeToggle', context: {} };
    const msg = buildA2uiActionMessage(params, surface);
    expect(msg.action.label).toBeUndefined();
  });

  it('leaves action.label undefined when Button has no child Text id', () => {
    const components: A2uiComponent[] = [
      c({ id: 'submit-btn', component: 'Button', action: { event: { name: 'formSubmit' } } }),
    ];
    const surface = makeSurface(components);
    const params = { surfaceId: 's1', sourceComponentId: 'submit-btn', name: 'formSubmit', context: {} };
    const msg = buildA2uiActionMessage(params, surface);
    expect(msg.action.label).toBeUndefined();
  });

  it('leaves action.label undefined when sourceComponentId does not exist in surface', () => {
    const surface = makeSurface([makeTextComp()]);
    const params = { surfaceId: 's1', sourceComponentId: 'ghost-id', name: 'click', context: {} };
    const msg = buildA2uiActionMessage(params, surface);
    expect(msg.action.label).toBeUndefined();
  });
});
