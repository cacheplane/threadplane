import { StrictMode, useSyncExternalStore } from 'react';
import { renderToString } from 'react-dom/server';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createA2uiSurfaces,
  type A2uiSurfaces,
} from '@threadplane/content/a2ui';
import { A2uiSurface } from '../index';

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
function Host({ surfaces, editable = true }: { surfaces: A2uiSurfaces; editable?: boolean }) {
  const snapshot = useSyncExternalStore(surfaces.subscribe, surfaces.getSnapshot, surfaces.getSnapshot);
  return <A2uiSurface surface={snapshot.surfaces[0]} surfaces={editable ? surfaces : undefined} />;
}
const model = (surfaces: A2uiSurfaces) => surfaces.getSnapshot().surfaces[0].dataModel;
const OPTIONS = [
  { label: 'Window', value: 'window' },
  { label: { path: '/aisleLabel' }, value: 'aisle' },
  { value: 'middle' },
];
const picker = (extra: Record<string, unknown> = {}) => [
  { id: 'root', component: 'ChoicePicker', label: 'Seat', value: { path: '/seat' }, options: OPTIONS, ...extra },
];
const data = (seat: unknown) => ({ seat, aisleLabel: 'Aisle', other: 'kept' });

describe('A2UI ChoicePicker', () => {
  it('renders one choice as a named radio group and writes a one-item list', () => {
    const surfaces = store(picker(), data(['window']));
    const notify = vi.fn();
    surfaces.subscribe(notify);
    const view = render(<Host surfaces={surfaces} />);
    const group = view.getByRole('radiogroup', { name: 'Seat' });
    const radios = view.getAllByRole('radio') as HTMLInputElement[];
    // A label read from the data model, and a missing one falling back to the value.
    expect(radios.map((radio) => radio.labels?.[0].textContent)).toEqual(['Window', 'Aisle', 'middle']);
    expect(radios.map((radio) => radio.checked)).toEqual([true, false, false]);
    expect(new Set(radios.map((radio) => radio.name)).size).toBe(1);
    expect(radios[0].name).not.toBe('');
    fireEvent.click(radios[1]);
    expect(model(surfaces)).toEqual(data(['aisle']));
    expect(radios.map((radio) => radio.checked)).toEqual([false, true, false]);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(view.getByRole('radiogroup', { name: 'Seat' })).toBe(group);
  });

  it('gives two pickers separate radio groups', () => {
    const surfaces = store(
      [
        { id: 'root', component: 'Column', children: ['a', 'b'] },
        { id: 'a', component: 'ChoicePicker', label: 'A', value: { path: '/a' }, options: OPTIONS },
        { id: 'b', component: 'ChoicePicker', label: 'B', value: { path: '/b' }, options: OPTIONS },
      ],
      { a: ['window'], b: ['aisle'] }
    );
    const view = render(<Host surfaces={surfaces} />);
    const radios = view.getAllByRole('radio') as HTMLInputElement[];
    expect(radios[0].name).not.toBe(radios[3].name);
    expect(radios.filter((radio) => radio.checked)).toHaveLength(2);
  });

  it('writes several choices in option order', () => {
    const surfaces = store(picker({ variant: 'multipleSelection' }), data(['middle']));
    const view = render(<Host surfaces={surfaces} />);
    expect(view.getByRole('group', { name: 'Seat' })).toBeTruthy();
    const boxes = view.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((box) => box.checked)).toEqual([false, false, true]);
    expect(boxes.every((box) => box.name === '')).toBe(true);
    fireEvent.click(boxes[0]);
    expect((model(surfaces) as { seat: unknown }).seat).toEqual(['window', 'middle']);
    fireEvent.click(boxes[2]);
    expect((model(surfaces) as { seat: unknown }).seat).toEqual(['window']);
    fireEvent.click(boxes[0]);
    expect((model(surfaces) as { seat: unknown }).seat).toEqual([]);
  });

  it('keeps a selected value the options no longer list', () => {
    const surfaces = store(picker({ variant: 'multipleSelection' }), data(['gone', 'aisle']));
    const view = render(<Host surfaces={surfaces} />);
    fireEvent.click(view.getByRole('checkbox', { name: 'Window' }));
    expect((model(surfaces) as { seat: unknown }).seat).toEqual(['window', 'aisle', 'gone']);
  });

  it('treats a scalar seeded by the agent as one choice', () => {
    for (const [seat, checked] of [
      ['aisle', [false, true, false]],
      ['', [false, false, false]],
      [null, [false, false, false]],
      [{ a: 1 }, [false, false, false]],
      [['aisle', 7, null], [false, true, false]],
    ] as const) {
      const view = render(<Host surfaces={store(picker(), data(seat))} />);
      expect((view.getAllByRole('radio') as HTMLInputElement[]).map((radio) => radio.checked)).toEqual(checked);
      cleanup();
    }
    const numeric = store(
      [{ id: 'root', component: 'ChoicePicker', value: { path: '/n' }, options: [{ label: 'Five', value: '5' }] }],
      { n: 5 }
    );
    const view = render(<Host surfaces={numeric} />);
    expect((view.getByRole('radio', { name: 'Five' }) as HTMLInputElement).checked).toBe(true);
    expect(view.getByRole('radiogroup', { name: 'Choices' })).toBeTruthy();
  });

  it('renders chips as toggle buttons', () => {
    const surfaces = store(picker({ displayStyle: 'chips', variant: 'multipleSelection' }), data(['window']));
    const view = render(<Host surfaces={surfaces} />);
    expect(view.getByRole('group', { name: 'Seat' })).toBeTruthy();
    const chip = (name: string) => view.getByRole('button', { name });
    expect(chip('Window').getAttribute('aria-pressed')).toBe('true');
    expect(chip('Window').getAttribute('type')).toBe('button');
    expect(chip('Aisle').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(chip('Aisle'));
    expect((model(surfaces) as { seat: unknown }).seat).toEqual(['window', 'aisle']);
    expect(chip('Aisle').className).toBe('a2ui-cp__chip a2ui-cp__chip--selected');
    fireEvent.click(chip('Window'));
    expect((model(surfaces) as { seat: unknown }).seat).toEqual(['aisle']);
  });

  it('keeps one chip chosen when only one is allowed', () => {
    const surfaces = store(picker({ displayStyle: 'chips' }), data(['window']));
    const view = render(<Host surfaces={surfaces} />);
    expect(view.getByRole('group', { name: 'Seat' })).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Aisle' }));
    expect((model(surfaces) as { seat: unknown }).seat).toEqual(['aisle']);
    // Pressing the chosen chip again leaves it chosen.
    fireEvent.click(view.getByRole('button', { name: 'Aisle' }));
    expect((model(surfaces) as { seat: unknown }).seat).toEqual(['aisle']);
  });

  it('filters by label locally without changing the selection', () => {
    const surfaces = store(picker({ filterable: true, variant: 'multipleSelection' }), data(['window']));
    const before = surfaces.getSnapshot();
    const view = render(<Host surfaces={surfaces} />);
    const filter = view.getByRole('textbox', { name: 'Filter Seat' }) as HTMLInputElement;
    fireEvent.change(filter, { target: { value: ' AIS ' } });
    expect(view.getAllByRole('checkbox')).toHaveLength(1);
    expect(view.getByRole('checkbox', { name: 'Aisle' })).toBeTruthy();
    expect(surfaces.getSnapshot()).toBe(before);
    // A choice made while filtered keeps the hidden one.
    fireEvent.click(view.getByRole('checkbox', { name: 'Aisle' }));
    expect((model(surfaces) as { seat: unknown }).seat).toEqual(['window', 'aisle']);
    fireEvent.change(filter, { target: { value: 'zzz' } });
    expect(view.queryAllByRole('checkbox')).toHaveLength(0);
    expect(view.getByRole('status').textContent).toBe('No options match');
    fireEvent.change(filter, { target: { value: '' } });
    expect(view.getAllByRole('checkbox')).toHaveLength(3);
  });

  it('shows no filter unless asked and ignores a filter left from before', () => {
    const view = render(<Host surfaces={store(picker(), data([]))} />);
    expect(view.queryByRole('textbox')).toBeNull();
    expect(view.queryByRole('status')).toBeNull();
  });

  it('is disabled without a store or with a literal value', () => {
    const surfaces = store(picker({ variant: 'multipleSelection' }), data(['window']));
    const before = surfaces.getSnapshot();
    const readOnly = render(<Host surfaces={surfaces} editable={false} />);
    const boxes = readOnly.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.every((box) => box.disabled)).toBe(true);
    expect(boxes[0].checked).toBe(true);
    cleanup();
    const literal = store([
      { id: 'root', component: 'ChoicePicker', label: 'Fixed', displayStyle: 'chips', value: ['aisle'], options: OPTIONS },
    ]);
    const fixed = render(<Host surfaces={literal} />);
    const chip = fixed.getByRole('button', { name: 'aisle' }) as HTMLButtonElement;
    expect([chip.disabled, chip.getAttribute('aria-pressed')]).toEqual([true, 'true']);
    fireEvent.click(chip);
    expect(surfaces.getSnapshot()).toBe(before);
  });

  it('drops malformed and repeated options and renders labels as text', () => {
    const surfaces = store(
      [
        {
          id: 'root',
          component: 'ChoicePicker',
          value: { path: '/v' },
          options: [
            { label: 'One <b>bold</b>', value: 'one' },
            { label: 'Again', value: 'one' },
            { label: 'No value' },
            { label: 'Number', value: 3 },
            'text',
            null,
            { label: { call: 'formatString', args: {} }, value: 'call' },
          ],
        },
      ],
      { v: [] }
    );
    const view = render(<Host surfaces={surfaces} />);
    const radios = view.getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((radio) => radio.labels?.[0].textContent)).toEqual(['One <b>bold</b>', 'call']);
    expect(view.container.querySelector('b')).toBeNull();
    cleanup();
    const none = render(
      <Host surfaces={store([{ id: 'root', component: 'ChoicePicker', label: 'Empty', value: { path: '/v' }, options: 'nope' }], { v: [] })} />
    );
    expect(none.getByRole('radiogroup', { name: 'Empty' }).querySelectorAll('input')).toHaveLength(0);
    expect(none.queryByRole('status')).toBeNull();
  });

  it('writes once per choice under StrictMode and renders on the server', () => {
    const surfaces = store(picker(), data(['window']));
    const notify = vi.fn();
    surfaces.subscribe(notify);
    const view = render(
      <StrictMode>
        <Host surfaces={surfaces} />
      </StrictMode>
    );
    fireEvent.click(view.getByRole('radio', { name: 'Aisle' }));
    expect(notify).toHaveBeenCalledTimes(1);
    const html = renderToString(<A2uiSurface surface={surfaces.getSnapshot().surfaces[0]} />);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('Aisle');
  });
});

describe('A2UI DateTimeInput', () => {
  const input = (props: Record<string, unknown>, value: unknown, editable = true) => {
    const surfaces = store(
      [{ id: 'root', component: 'DateTimeInput', label: 'When', value: { path: '/when' }, ...props }],
      { when: value, other: 'kept' }
    );
    const view = render(<Host surfaces={surfaces} editable={editable} />);
    return { surfaces, view, element: view.getByLabelText('When') as HTMLInputElement };
  };
  const shown = (props: Record<string, unknown>, value: unknown) => {
    const { element } = input(props, value);
    const result = [element.type, element.value];
    cleanup();
    return result;
  };
  const local = (iso: string) => {
    const at = new Date(iso);
    const two = (part: number) => String(part).padStart(2, '0');
    return {
      date: `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`,
      time: `${two(at.getHours())}:${two(at.getMinutes())}`,
    };
  };

  it('chooses the native input from enableDate and enableTime', () => {
    expect(shown({}, '2026-03-04')).toEqual(['date', '2026-03-04']);
    expect(shown({ enableDate: true, enableTime: true }, '2026-03-04T09:30')).toEqual(['datetime-local', '2026-03-04T09:30']);
    expect(shown({ enableTime: true }, '2026-03-04T09:30')).toEqual(['datetime-local', '2026-03-04T09:30']);
    expect(shown({ enableDate: false, enableTime: true }, '09:30')).toEqual(['time', '09:30']);
    expect(shown({ enableDate: false, enableTime: false }, '2026-03-04')).toEqual(['date', '2026-03-04']);
    expect(shown({ enableTime: 'yes' }, '2026-03-04')).toEqual(['date', '2026-03-04']);
  });

  it('shows the part of a zone-less ISO value its input accepts', () => {
    expect(shown({}, '2026-03-04T09:30:00')).toEqual(['date', '2026-03-04']);
    expect(shown({ enableDate: false, enableTime: true }, '2026-03-04T09:30:00.000')).toEqual(['time', '09:30']);
    expect(shown({ enableDate: false, enableTime: true }, '09:30:15')).toEqual(['time', '09:30:15']);
    // jsdom pads the seconds it reads back with milliseconds; browsers do not.
    expect(shown({ enableTime: true }, '2026-03-04T09:30:15')[1]).toMatch(/^2026-03-04T09:30:15(\.000)?$/);
    expect(shown({ enableTime: true }, '2026-03-04')).toEqual(['datetime-local', '2026-03-04T00:00']);
    expect(shown({}, ' 2026-03-04 ')).toEqual(['date', '2026-03-04']);
  });

  it('shows a value with a zone in local time', () => {
    for (const iso of ['2026-03-04T23:30:00Z', '2026-03-04T01:15:00+09:00']) {
      const at = local(iso);
      expect(shown({}, iso)).toEqual(['date', at.date]);
      expect(shown({ enableDate: false, enableTime: true }, iso)).toEqual(['time', at.time]);
      expect(shown({ enableTime: true }, iso)).toEqual(['datetime-local', `${at.date}T${at.time}`]);
    }
  });

  it('shows nothing for a value that is not an ISO date or time', () => {
    for (const value of ['tomorrow', '03/04/2026', '2026-3-4', '', 20260304, null, true, { a: 1 }, '09:30Z'])
      expect(shown({}, value)[1]).toBe('');
    expect(shown({ enableDate: false, enableTime: true }, '2026-03-04')[1]).toBe('');
    expect(shown({}, '09:30')[1]).toBe('');
  });

  it('writes the native value to the store', () => {
    const { surfaces, element } = input({}, '2026-03-04');
    const notify = vi.fn();
    surfaces.subscribe(notify);
    expect(element.readOnly).toBe(false);
    fireEvent.change(element, { target: { value: '2026-04-01' } });
    expect(model(surfaces)).toEqual({ when: '2026-04-01', other: 'kept' });
    expect(element.value).toBe('2026-04-01');
    expect(notify).toHaveBeenCalledTimes(1);
    fireEvent.change(element, { target: { value: '' } });
    expect((model(surfaces) as { when: unknown }).when).toBe('');
    cleanup();
    const both = input({ enableTime: true }, '2026-03-04T09:30');
    fireEvent.change(both.element, { target: { value: '2026-03-05T10:45' } });
    expect((model(both.surfaces) as { when: unknown }).when).toBe('2026-03-05T10:45');
    cleanup();
    const time = input({ enableDate: false, enableTime: true }, '09:30');
    fireEvent.change(time.element, { target: { value: '18:05' } });
    expect((model(time.surfaces) as { when: unknown }).when).toBe('18:05');
  });

  it('maps min and max to the native bounds in the same format', () => {
    const { element } = input({ min: '2026-03-01T00:00:00', max: { path: '/latest' } }, '2026-03-04');
    expect([element.min, element.max]).toEqual(['2026-03-01', '']);
    cleanup();
    const surfaces = store(
      [{ id: 'root', component: 'DateTimeInput', label: 'When', value: { path: '/when' }, min: 'soon', max: { path: '/latest' }, enableTime: true }],
      { when: '', latest: '2026-03-31T18:00' }
    );
    const view = render(<Host surfaces={surfaces} />);
    const bounded = view.getByLabelText('When') as HTMLInputElement;
    expect([bounded.hasAttribute('min'), bounded.max]).toEqual([false, '2026-03-31T18:00']);
  });

  it('cannot be edited without a store or with a literal value', () => {
    const readOnly = input({}, '2026-03-04', false);
    const before = readOnly.surfaces.getSnapshot();
    expect(readOnly.element.readOnly).toBe(true);
    fireEvent.change(readOnly.element, { target: { value: '2026-04-01' } });
    expect(readOnly.surfaces.getSnapshot()).toBe(before);
    expect(readOnly.element.value).toBe('2026-03-04');
    cleanup();
    const view = render(<Host surfaces={store([{ id: 'root', component: 'DateTimeInput', value: '2026-03-04' }])} />);
    const fixed = view.getByLabelText('Date') as HTMLInputElement;
    expect([fixed.readOnly, fixed.value]).toEqual([true, '2026-03-04']);
  });

  it('names an unlabelled input by its kind', () => {
    const named = (props: Record<string, unknown>) => {
      const view = render(<Host surfaces={store([{ id: 'root', component: 'DateTimeInput', value: { path: '/v' }, ...props }], { v: '' })} />);
      const name = (view.container.querySelector('input') as HTMLInputElement).getAttribute('aria-label');
      cleanup();
      return name;
    };
    expect(named({})).toBe('Date');
    expect(named({ enableDate: false, enableTime: true })).toBe('Time');
    expect(named({ enableTime: true })).toBe('Date and time');
    const { view, element } = input({}, '');
    expect(element.hasAttribute('aria-label')).toBe(false);
    expect(view.container.querySelector('label')?.htmlFor).toBe(element.id);
  });

  it('lets a later agent update replace an edited date', () => {
    const { surfaces, view, element } = input({}, '2026-03-04');
    fireEvent.change(element, { target: { value: '2026-04-01' } });
    surfaces.apply({ version: 'v0.9', updateDataModel: { surfaceId: 's', path: '/when', value: '2026-05-06T12:00:00' } } as unknown as Message);
    view.rerender(<Host surfaces={surfaces} />);
    expect(element.value).toBe('2026-05-06');
  });
});
