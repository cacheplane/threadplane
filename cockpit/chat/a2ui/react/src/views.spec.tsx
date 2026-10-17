// @vitest-environment jsdom
import { StrictMode, Suspense, startTransition } from 'react';
import { createRoot } from 'react-dom/client';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createRenderState } from '@threadplane/content/render-state';
import { prepareSurface } from './protocol';
import { createBookingForm } from './form';
import { createActions } from './actions';
import { A2uiSurface, a2uiRegistry } from './views';
import type { SurfaceView } from './application';
const wire = [
  '---a2ui_JSON---\n{"version": "v0.9", "createSurface": {"surfaceId": "booking", "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}\n{"version": "v0.9", "updateComponents": {"surfaceId": "booking", "components": [{"id": "root", "component": "Column", "children": ["card"]}, {"id": "card", "component": "Card", "child": "card_col"}, {"id": "card_col", "component": "Column", "children": ["title", "origin", "dest", "date", "passengers", "fare", "submit"]}, {"id": "title", "component": "Text", "text": "Book a flight", "variant": "h2"}, {"id": "origin", "component": "ChoicePicker", "label": "Origin", "options": [{"label": "LAX", "value": "LAX"}, {"label": "JFK", "value": "JFK"}, {"label": "SFO", "value": "SFO"}, {"label": "ORD", "value": "ORD"}, {"label": "BOS", "value": "BOS"}, {"label": "ATL", "value": "ATL"}, {"label": "DFW", "value": "DFW"}, {"label": "SEA", "value": "SEA"}, {"label": "MIA", "value": "MIA"}, {"label": "DEN", "value": "DEN"}], "value": {"path": "/origin"}, "variant": "mutuallyExclusive"}, {"id": "dest", "component": "ChoicePicker", "label": "Destination", "options": [{"label": "LAX", "value": "LAX"}, {"label": "JFK", "value": "JFK"}, {"label": "SFO", "value": "SFO"}, {"label": "ORD", "value": "ORD"}, {"label": "BOS", "value": "BOS"}, {"label": "ATL", "value": "ATL"}, {"label": "DFW", "value": "DFW"}, {"label": "SEA", "value": "SEA"}, {"label": "MIA", "value": "MIA"}, {"label": "DEN", "value": "DEN"}], "value": {"path": "/dest"}, "variant": "mutuallyExclusive"}, {"id": "fare", "component": "ChoicePicker", "label": "Fare class", "options": [{"label": "Economy", "value": "Economy"}, {"label": "Premium", "value": "Premium"}, {"label": "Business", "value": "Business"}, {"label": "First", "value": "First"}], "value": {"path": "/fare_class"}, "variant": "mutuallyExclusive"}, {"id": "date", "component": "DateTimeInput", "label": "Departure date (YYYY-MM-DD)", "value": {"path": "/date"}, "enableDate": true}, {"id": "passengers", "component": "TextField", "label": "Passengers", "value": {"path": "/passengers"}, "variant": "number"}, {"id": "submit", "component": "Button", "child": "submit_label", "variant": "primary", "action": {"event": {"name": "bookingSubmit", "context": {"formId": "booking", "origin": {"path": "/origin"}, "dest": {"path": "/dest"}, "date": {"path": "/date"}, "passengers": {"path": "/passengers"}, "fare_class": {"path": "/fare_class"}}}}}, {"id": "submit_label", "component": "Text", "text": "Search flights"}]}}\n{"version": "v0.9", "updateDataModel": {"surfaceId": "booking", "path": "/", "value": {"origin": ["LAX"], "dest": ["JFK"], "date": "", "passengers": 1, "fare_class": ["Economy"]}}}\n',
  '---a2ui_JSON---\n{"version": "v0.9", "createSurface": {"surfaceId": "results", "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}\n{"version": "v0.9", "updateComponents": {"surfaceId": "results", "components": [{"id": "root", "component": "Column", "children": ["card_0"]}, {"id": "card_0", "component": "Card", "child": "col_0"}, {"id": "col_0", "component": "Column", "children": ["title_0", "route_0", "time_0", "btn_0"]}, {"id": "title_0", "component": "Text", "text": "UA flight UA123", "variant": "h3"}, {"id": "route_0", "component": "Text", "text": "LAX \\u2192 JFK  \\u2022  330 min  \\u2022  Boeing 787", "variant": "body"}, {"id": "time_0", "component": "Text", "text": "Depart 08:00  \\u2022  Arrive 16:30  \\u2022  Gate B14", "variant": "caption"}, {"id": "btn_0", "component": "Button", "child": "btn_label_0", "variant": "primary", "action": {"event": {"name": "flightSelect", "context": {"flightId": "UA123"}}}}, {"id": "btn_label_0", "component": "Text", "text": "Select"}]}}\n',
  '---a2ui_JSON---\n{"version": "v0.9", "createSurface": {"surfaceId": "confirmation", "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}\n{"version": "v0.9", "updateComponents": {"surfaceId": "confirmation", "components": [{"id": "root", "component": "Column", "children": ["card"]}, {"id": "card", "component": "Card", "child": "card_col"}, {"id": "card_col", "component": "Column", "children": ["title", "party_text", "modify"]}, {"id": "title", "component": "Text", "text": "UA flight UA123", "variant": "h2"}, {"id": "party_text", "component": "Text", "text": "2 passengers  \\u2022  Business", "variant": "body"}, {"id": "modify", "component": "Button", "child": "modify_label", "variant": "primary", "action": {"event": {"name": "modifySearch", "context": {"formId": "booking"}}}}, {"id": "modify_label", "component": "Text", "text": "Modify search"}]}}\n',
  '---a2ui_JSON---\n{"version": "v0.9", "createSurface": {"surfaceId": "booking", "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}\n{"version": "v0.9", "updateComponents": {"surfaceId": "booking", "components": [{"id": "root", "component": "Column", "children": ["card"]}, {"id": "card", "component": "Card", "child": "card_col"}, {"id": "card_col", "component": "Column", "children": ["title", "origin", "dest", "date", "passengers", "fare", "submit"]}, {"id": "title", "component": "Text", "text": "Book a flight", "variant": "h2"}, {"id": "origin", "component": "ChoicePicker", "label": "Origin", "options": [{"label": "LAX", "value": "LAX"}, {"label": "JFK", "value": "JFK"}, {"label": "SFO", "value": "SFO"}, {"label": "ORD", "value": "ORD"}, {"label": "BOS", "value": "BOS"}, {"label": "ATL", "value": "ATL"}, {"label": "DFW", "value": "DFW"}, {"label": "SEA", "value": "SEA"}, {"label": "MIA", "value": "MIA"}, {"label": "DEN", "value": "DEN"}], "value": {"path": "/origin"}, "variant": "mutuallyExclusive"}, {"id": "dest", "component": "ChoicePicker", "label": "Destination", "options": [{"label": "LAX", "value": "LAX"}, {"label": "JFK", "value": "JFK"}, {"label": "SFO", "value": "SFO"}, {"label": "ORD", "value": "ORD"}, {"label": "BOS", "value": "BOS"}, {"label": "ATL", "value": "ATL"}, {"label": "DFW", "value": "DFW"}, {"label": "SEA", "value": "SEA"}, {"label": "MIA", "value": "MIA"}, {"label": "DEN", "value": "DEN"}], "value": {"path": "/dest"}, "variant": "mutuallyExclusive"}, {"id": "fare", "component": "ChoicePicker", "label": "Fare class", "options": [{"label": "Economy", "value": "Economy"}, {"label": "Premium", "value": "Premium"}, {"label": "Business", "value": "Business"}, {"label": "First", "value": "First"}], "value": {"path": "/fare_class"}, "variant": "mutuallyExclusive"}, {"id": "date", "component": "DateTimeInput", "label": "Departure date (YYYY-MM-DD)", "value": {"path": "/date"}, "enableDate": true}, {"id": "passengers", "component": "TextField", "label": "Passengers", "value": {"path": "/passengers"}, "variant": "number"}, {"id": "submit", "component": "Button", "child": "submit_label", "variant": "primary", "action": {"event": {"name": "bookingSubmit", "context": {"formId": "booking", "origin": {"path": "/origin"}, "dest": {"path": "/dest"}, "date": {"path": "/date"}, "passengers": {"path": "/passengers"}, "fare_class": {"path": "/fare_class"}}}}}, {"id": "submit_label", "component": "Text", "text": "Search flights"}]}}\n{"version": "v0.9", "updateDataModel": {"surfaceId": "booking", "path": "/", "value": {"origin": ["LAX"], "dest": ["JFK"], "date": "2026-11-03", "passengers": 2, "fare_class": ["Business"]}}}\n',
];
afterEach(cleanup);
function setup(content = wire[3]) {
  const prepared = prepareSurface(content, 'booking'),
    state = createRenderState(prepared.model),
    form = createBookingForm(prepared, state),
    sent: unknown[] = [];
  const actions = createActions(prepared, {
    form,
    timestamp: () => '2026-10-16T00:00:00Z',
    dispatch: (p) => {
      sent.push(p);
    },
  });
  const edits: Record<string, (s: string) => void> = Object.create(null),
    clicks: Record<string, () => boolean> = Object.create(null);
  for (const c of Object.values(prepared.components)) {
    edits[c.id] = form.captureEdit(c.id);
    if (c.component === 'Button') clicks[c.id] = actions.capability(c.id);
  }
  const card: SurfaceView = {
    id: 'local',
    kind: 'booking',
    messageId: 'ai',
    spec: prepared.spec,
    prose: prepared.prose,
    wire: content,
    model: prepared.model,
    form,
    edits,
    actions: clicks,
  };
  return {
    card,
    form,
    sent,
    prepared,
    state,
    actions,
    dispose() {
      actions.dispose();
      form.dispose();
      prepared.dispose();
      state.dispose();
    },
  };
}
it('uses the stable ten-view registry, visible latest values and single-select array mapping', () => {
  expect(Object.keys(a2uiRegistry)).toEqual([
    'Column',
    'Row',
    'List',
    'Card',
    'Text',
    'Divider',
    'ChoicePicker',
    'DateTimeInput',
    'TextField',
    'Button',
  ]);
  const f = setup();
  render(<A2uiSurface surface={f.card} active />);
  expect((screen.getByLabelText('Origin') as HTMLSelectElement).value).toBe(
    'LAX'
  );
  fireEvent.change(screen.getByLabelText('Origin'), {
    target: { value: 'SFO' },
  });
  expect(f.form.getSnapshot().model.origin).toEqual(['SFO']);
  fireEvent.change(screen.getByLabelText('Passengers'), {
    target: { value: '003' },
  });
  expect((screen.getByLabelText('Passengers') as HTMLInputElement).value).toBe(
    '003'
  );
  fireEvent.change(screen.getByLabelText('Fare class'), {
    target: { value: 'First' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Search flights' }), {
    detail: 0,
  });
  expect(f.sent).toHaveLength(1);
  expect((f.sent[0] as any).action.context).toMatchObject({
    origin: ['SFO'],
    passengers: 3,
    fare_class: ['First'],
  });
  f.dispose();
});
it('blank lexical draft blocks direct command, exposes associated errors and focuses invalid control', () => {
  const f = setup();
  const v = render(<A2uiSurface surface={f.card} active />);
  fireEvent.change(screen.getByLabelText('Passengers'), {
    target: { value: '' },
  });
  const input = screen.getByLabelText('Passengers');
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(
    document
      .getElementById(input.getAttribute('aria-describedby')!)
      ?.getAttribute('role')
  ).toBe('alert');
  expect(f.card.actions.submit()).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Search flights' }));
  expect(document.activeElement).toBe(input);
  expect(f.sent).toHaveLength(0);
  v.unmount();
  expect(f.form.canSubmit()).toBe(false);
  render(<A2uiSurface surface={f.card} active />);
  expect((screen.getByLabelText('Passengers') as HTMLInputElement).value).toBe(
    ''
  );
  f.dispose();
});
it('retains readable disabled historical values and generates unique mounted DOM IDs', () => {
  const f = setup();
  f.form.edit('passengers', '003');
  const a = render(<A2uiSurface surface={f.card} active={false} />);
  const b = render(<A2uiSurface surface={f.card} active={false} />);
  const controls = screen.getAllByLabelText('Passengers') as HTMLInputElement[];
  expect(controls.map((c) => c.value)).toEqual(['003', '003']);
  expect(controls.every((c) => c.disabled)).toBe(true);
  expect(new Set(controls.map((c) => c.id)).size).toBe(2);
  expect(controls.every((c) => c.id !== 'passengers')).toBe(true);
  expect(a.container.querySelector('button')?.disabled).toBe(true);
  b.unmount();
  a.unmount();
  expect(f.form.canSubmit()).toBe(true);
  f.dispose();
});
it('StrictMode and abandoned suspended render issue no edit/action/disposal commands', async () => {
  const f = setup();
  const edit = vi.spyOn(f.card.edits, 'origin');
  const click = vi.spyOn(f.card.actions, 'submit');
  render(
    <StrictMode>
      <A2uiSurface surface={f.card} active />
    </StrictMode>
  );
  expect(edit).not.toHaveBeenCalled();
  expect(click).not.toHaveBeenCalled();
  cleanup();
  const host = document.createElement('div'),
    root = createRoot(host);
  const never = new Promise<void>(() => undefined);
  function Suspend(): never {
    throw never;
  }
  await act(async () => {
    startTransition(() =>
      root.render(
        <Suspense fallback={null}>
          <A2uiSurface surface={f.card} active />
          <Suspend />
        </Suspense>
      )
    );
  });
  await act(async () => root.unmount());
  expect(edit).not.toHaveBeenCalled();
  expect(click).not.toHaveBeenCalled();
  expect(f.form.canSubmit()).toBe(true);
  f.dispose();
});
it('retired callback contracts stay inert after replacement and latest borrowed callbacks are used', () => {
  const f = setup(),
    fresh = setup();
  const oldClick = f.card.actions.submit;
  const v = render(<A2uiSurface surface={f.card} active />);
  f.prepared.retireComponent('submit');
  v.rerender(<A2uiSurface surface={fresh.card} active />);
  expect(oldClick()).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Search flights' }));
  expect(f.sent).toHaveLength(0);
  expect(fresh.sent).toHaveLength(1);
  f.dispose();
  fresh.dispose();
});
it('supports prototype-like component IDs and treats authored text as inert text', () => {
  const lines = wire[3].split('\n'),
    update = JSON.parse(lines[2]);
  for (const c of update.updateComponents.components) {
    if (c.id === 'title') {
      c.id = 'toString';
      c.text = '<img src=x onerror=alert(1)>';
    }
    if (c.id === 'card_col')
      c.children = c.children.map((id: string) =>
        id === 'title' ? 'toString' : id
      );
  }
  lines[2] = JSON.stringify(update);
  const f = setup(lines.join('\n'));
  const v = render(<A2uiSurface surface={f.card} active />);
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
  expect(v.container.querySelector('img')).toBeNull();
  f.dispose();
});
it('creates unique control and error IDs even when wire IDs collide with an error suffix', () => {
  const lines = wire[0].split('\n'),
    update = JSON.parse(lines[2]);
  for (const c of update.updateComponents.components) {
    if (c.id === 'date') c.id = 'x';
    else if (c.id === 'passengers') c.id = 'x-error';
    if (c.id === 'card_col')
      c.children = c.children.map((id: string) =>
        id === 'date' ? 'x' : id === 'passengers' ? 'x-error' : id
      );
  }
  lines[2] = JSON.stringify(update);
  const f = setup(lines.join('\n'));
  const v = render(<A2uiSurface surface={f.card} active />);
  fireEvent.change(screen.getByLabelText('Passengers'), {
    target: { value: '' },
  });
  const ids = Array.from(v.container.querySelectorAll('[id]')).map((n) => n.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const label of ['Departure date (YYYY-MM-DD)', 'Passengers']) {
    const control = screen.getByLabelText(label);
    expect(document.getElementById(control.id)).toBe(control);
    const error = document.getElementById(
      control.getAttribute('aria-describedby')!
    );
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toBeTruthy();
  }
  f.dispose();
});
it('renders supported Row, List and both Divider orientations with semantic text defaults', () => {
  const lines = wire[3].split('\n'),
    update = JSON.parse(lines[2]);
  update.updateComponents.components.find(
    (c: any) => c.id === 'root'
  ).children = ['row', 'list', 'divider', 'vertical'];
  update.updateComponents.components.push(
    { id: 'row', component: 'Row', children: ['card'] },
    { id: 'list', component: 'List', children: ['extra'] },
    { id: 'extra', component: 'Text', text: 'List text' },
    { id: 'divider', component: 'Divider' },
    { id: 'vertical', component: 'Divider', axis: 'vertical' }
  );
  lines[2] = JSON.stringify(update);
  const f = setup(lines.join('\n'));
  const v = render(<A2uiSurface surface={f.card} active />);
  expect(screen.getByRole('listitem').textContent).toBe('List text');
  expect(
    screen
      .getAllByRole('separator')
      .map((n) => n.getAttribute('aria-orientation'))
  ).toEqual(['horizontal', 'vertical']);
  expect(v.container.querySelector('.a2ui-row')).toBeTruthy();
  f.dispose();
});
