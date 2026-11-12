import { StrictMode, useSyncExternalStore } from 'react';
import { renderToString } from 'react-dom/server';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createA2uiSurfaces,
  type A2uiSurfaces,
} from '@threadplane/content/a2ui';
import type { RenderViewProps } from '../../render/index';
import { A2uiSurface, a2uiBasicCatalog, useA2uiSurfaceWriter } from '../index';

afterEach(cleanup);

type Message = Parameters<A2uiSurfaces['apply']>[0];
function store(components: readonly Record<string, unknown>[], data: unknown = {}) {
  const surfaces = createA2uiSurfaces();
  for (const message of [
    { version: 'v0.9', createSurface: { surfaceId: 's', catalogId: 'basic' } },
    { version: 'v0.9', updateComponents: { surfaceId: 's', components } },
    { version: 'v0.9', updateDataModel: { surfaceId: 's', value: data } },
  ])
    surfaces.apply(message as unknown as Message);
  return surfaces;
}
/** The intended wiring: the app holds the store and passes its current snapshot. */
function Host({ surfaces, editable = true }: { surfaces: A2uiSurfaces; editable?: boolean }) {
  const snapshot = useSyncExternalStore(surfaces.subscribe, surfaces.getSnapshot, surfaces.getSnapshot);
  return (
    <A2uiSurface
      surface={snapshot.surfaces[0]}
      surfaces={editable ? surfaces : undefined}
    />
  );
}
const model = (surfaces: A2uiSurfaces) => surfaces.getSnapshot().surfaces[0].dataModel;
const form = [
  { id: 'root', component: 'Column', children: ['name', 'echo', 'agree', 'size'] },
  { id: 'name', component: 'TextField', label: 'Name', value: { path: '/form/name' }, placeholder: 'Your name' },
  { id: 'echo', component: 'Text', text: { path: '/form/name' } },
  { id: 'agree', component: 'CheckBox', label: 'Agree', value: { path: '/form/agree' } },
  { id: 'size', component: 'Slider', label: 'Party', value: { path: '/size' }, min: 1, max: 8 },
];
const initial = { form: { name: 'Ada', agree: false }, size: 2, other: 'kept' };

describe('A2UI input components', () => {
  it('writes each keystroke to the store and updates a sibling bound to the same path', () => {
    const surfaces = store(form, initial);
    const notify = vi.fn();
    surfaces.subscribe(notify);
    const view = render(<Host surfaces={surfaces} />);
    const input = view.getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    expect(input.value).toBe('Ada');
    expect(input.readOnly).toBe(false);
    expect(input.placeholder).toBe('Your name');
    fireEvent.change(input, { target: { value: 'Grace' } });
    expect(model(surfaces)).toEqual({ form: { name: 'Grace', agree: false }, size: 2, other: 'kept' });
    expect(input.value).toBe('Grace');
    expect(view.container.querySelector('.a2ui-text-body')?.textContent).toBe('Grace');
    // One edit publishes once, and the input keeps its DOM node and focus.
    expect(notify).toHaveBeenCalledTimes(1);
    expect(view.getByRole('textbox', { name: 'Name' })).toBe(input);
  });

  it('keeps an edit across a remount because the store owns it', () => {
    const surfaces = store(form, initial);
    const first = render(<Host surfaces={surfaces} />);
    fireEvent.change(first.getByRole('textbox', { name: 'Name' }), { target: { value: 'Grace' } });
    first.unmount();
    const second = render(<Host surfaces={surfaces} />);
    expect((second.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Grace');
  });

  it('lets a later agent update replace an edited value', () => {
    const surfaces = store(form, initial);
    const view = render(<Host surfaces={surfaces} />);
    const input = view.getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Grace' } });
    surfaces.apply({ version: 'v0.9', updateDataModel: { surfaceId: 's', path: '/form/name', value: 'Agent' } } as unknown as Message);
    view.rerender(<Host surfaces={surfaces} />);
    expect(input.value).toBe('Agent');
  });

  it('writes a checkbox toggle as a boolean', () => {
    const surfaces = store(form, initial);
    const view = render(<Host surfaces={surfaces} />);
    const box = view.getByRole('checkbox', { name: 'Agree' }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(false);
    fireEvent.click(box);
    expect((model(surfaces) as { form: { agree: unknown } }).form.agree).toBe(true);
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect((model(surfaces) as { form: { agree: unknown } }).form.agree).toBe(false);
  });

  it('writes a slider movement as a number and shows it in the label', () => {
    const surfaces = store(form, initial);
    const view = render(<Host surfaces={surfaces} />);
    const slider = view.getByRole('slider', { name: 'Party: 2' }) as HTMLInputElement;
    expect([slider.min, slider.max, slider.value]).toEqual(['1', '8', '2']);
    fireEvent.change(slider, { target: { value: '5' } });
    expect((model(surfaces) as { size: unknown }).size).toBe(5);
    expect(view.getByRole('slider', { name: 'Party: 5' })).toBe(slider);
  });

  it('writes once per edit under StrictMode', () => {
    const surfaces = store(form, initial);
    const notify = vi.fn();
    surfaces.subscribe(notify);
    const view = render(
      <StrictMode>
        <Host surfaces={surfaces} />
      </StrictMode>
    );
    fireEvent.change(view.getByRole('textbox', { name: 'Name' }), { target: { value: 'G' } });
    fireEvent.click(view.getByRole('checkbox', { name: 'Agree' }));
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('shows values and changes nothing when the surface is given no store', () => {
    const surfaces = store(form, initial);
    const before = surfaces.getSnapshot();
    const view = render(<Host surfaces={surfaces} editable={false} />);
    const input = view.getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe('Ada');
    expect((view.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
    expect((view.getByRole('slider') as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'x' } });
    expect(surfaces.getSnapshot()).toBe(before);
    expect(input.value).toBe('Ada');
  });

  it('treats a literal value as fixed even in an editable surface', () => {
    const surfaces = store([
      { id: 'root', component: 'Column', children: ['t', 'c', 's'] },
      { id: 't', component: 'TextField', label: 'Fixed', value: 'literal' },
      { id: 'c', component: 'CheckBox', label: 'Locked', value: true },
      { id: 's', component: 'Slider', value: 40 },
    ]);
    const before = surfaces.getSnapshot();
    const view = render(<Host surfaces={surfaces} />);
    const input = view.getByRole('textbox', { name: 'Fixed' }) as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    fireEvent.change(input, { target: { value: 'x' } });
    expect(input.value).toBe('literal');
    const box = view.getByRole('checkbox', { name: 'Locked' }) as HTMLInputElement;
    expect([box.checked, box.disabled]).toEqual([true, true]);
    const slider = view.getByRole('slider', { name: 'Value' }) as HTMLInputElement;
    expect([slider.value, slider.disabled]).toEqual(['40', true]);
    expect(surfaces.getSnapshot()).toBe(before);
  });

  it('maps text field variants and falls back to plain text', () => {
    const field = (variant: unknown) => {
      const view = render(
        <Host
          surfaces={store(
            [{ id: 'root', component: 'TextField', label: 'F', value: { path: '/v' }, ...(variant === undefined ? {} : { variant }) }],
            { v: 'x' }
          )}
        />
      );
      const element = view.container.querySelector('.a2ui-tf__input') as HTMLInputElement | HTMLTextAreaElement;
      const result = [element.tagName, element.getAttribute('type')];
      cleanup();
      return result;
    };
    expect(field(undefined)).toEqual(['INPUT', 'text']);
    expect(field('shortText')).toEqual(['INPUT', 'text']);
    expect(field('number')).toEqual(['INPUT', 'number']);
    expect(field('obscured')).toEqual(['INPUT', 'password']);
    expect(field('longText')).toEqual(['TEXTAREA', null]);
    expect(field('constructor')).toEqual(['INPUT', 'text']);
    expect(field(7)).toEqual(['INPUT', 'text']);
  });

  it('writes from a multi-line field', () => {
    const surfaces = store(
      [{ id: 'root', component: 'TextField', label: 'Notes', variant: 'longText', value: { path: '/notes' } }],
      { notes: '' }
    );
    const view = render(<Host surfaces={surfaces} />);
    fireEvent.change(view.getByRole('textbox', { name: 'Notes' }), { target: { value: 'line 1\nline 2' } });
    expect(model(surfaces)).toEqual({ notes: 'line 1\nline 2' });
  });

  it('names an unlabelled control and renders literal labels', () => {
    const surfaces = store(
      [
        { id: 'root', component: 'Column', children: ['t', 'c', 'l'] },
        { id: 't', component: 'TextField', value: { path: '/t' } },
        { id: 'c', component: 'CheckBox', value: { path: '/c' } },
        { id: 'l', component: 'CheckBox', label: 'Keep <b>me</b>', value: { path: '/l' } },
      ],
      { t: 5, c: 'yes' }
    );
    const view = render(<Host surfaces={surfaces} />);
    // A finite number shows as text; a non-boolean is unchecked.
    expect((view.getByRole('textbox', { name: 'Text' }) as HTMLInputElement).value).toBe('5');
    expect((view.getByRole('checkbox', { name: 'Option' }) as HTMLInputElement).checked).toBe(false);
    expect(view.getByRole('checkbox', { name: 'Keep <b>me</b>' })).toBeTruthy();
    expect(view.container.querySelector('b')).toBeNull();
  });

  it('clamps a slider to its range and repairs a reversed or missing range', () => {
    const slider = (extra: Record<string, unknown>, data: unknown) => {
      const view = render(
        <Host surfaces={store([{ id: 'root', component: 'Slider', value: { path: '/v' }, ...extra }], data)} />
      );
      const element = view.getByRole('slider') as HTMLInputElement;
      const result = [element.min, element.max, element.value];
      cleanup();
      return result;
    };
    expect(slider({}, { v: 150 })).toEqual(['0', '100', '100']);
    expect(slider({ min: 10, max: 5 }, { v: 1 })).toEqual(['10', '10', '10']);
    expect(slider({ min: 2, max: 9 }, { v: 'x' })).toEqual(['2', '9', '2']);
    expect(slider({ min: 'a', max: null }, {})).toEqual(['0', '100', '0']);
  });

  it('gives an application component the same write channel', () => {
    const Stepper = ({ props, bindings }: RenderViewProps) => {
      const { editable, write } = useA2uiSurfaceWriter();
      return (
        <button type="button" disabled={!editable} onClick={() => write(bindings?.['value'], Number(props['value']) + 1)}>
          {String(props['value'])}
        </button>
      );
    };
    const surfaces = store([{ id: 'root', component: 'Stepper', value: { path: '/n' } }], { n: 1 });
    function CustomHost() {
      const snapshot = useSyncExternalStore(surfaces.subscribe, surfaces.getSnapshot);
      return <A2uiSurface surface={snapshot.surfaces[0]} surfaces={surfaces} catalog={catalog} />;
    }
    const catalog = { ...a2uiBasicCatalog(), Stepper };
    const view = render(<CustomHost />);
    fireEvent.click(view.getByRole('button', { name: '1' }));
    expect(model(surfaces)).toEqual({ n: 2 });
    expect(view.getByRole('button', { name: '2' })).toBeTruthy();
  });

  it('is read-only outside a surface', () => {
    let seen: ReturnType<typeof useA2uiSurfaceWriter> | undefined;
    const Probe = () => {
      seen = useA2uiSurfaceWriter();
      return null;
    };
    render(<Probe />);
    expect(seen?.editable).toBe(false);
    expect(() => seen?.write('/x', 1)).not.toThrow();
  });

  it('server renders the current values', () => {
    const html = renderToString(<Host surfaces={store(form, initial)} />);
    expect(html).toContain('value="Ada"');
    expect(html).toContain('type="range"');
    expect(html).toContain('Party: 2');
  });
});
