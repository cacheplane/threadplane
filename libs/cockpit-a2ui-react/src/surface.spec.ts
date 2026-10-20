import { afterEach, expect, it, vi } from 'vitest';
import { createFlightSurface, type FlightSurface } from './surface';
import * as protocol from './protocol';
import * as renderState from '@threadplane/content/render-state';
import * as forms from './form';
import * as actions from './actions';
afterEach(() => vi.restoreAllMocks());
// Canonical assistant bytes from accepted Task 1 compiled-graph four-turn receipt.
const wire = [
  '---a2ui_JSON---\n{"version": "v0.9", "createSurface": {"surfaceId": "booking", "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}\n{"version": "v0.9", "updateComponents": {"surfaceId": "booking", "components": [{"id": "root", "component": "Column", "children": ["card"]}, {"id": "card", "component": "Card", "child": "card_col"}, {"id": "card_col", "component": "Column", "children": ["title", "origin", "dest", "date", "passengers", "fare", "submit"]}, {"id": "title", "component": "Text", "text": "Book a flight", "variant": "h2"}, {"id": "origin", "component": "ChoicePicker", "label": "Origin", "options": [{"label": "LAX", "value": "LAX"}, {"label": "JFK", "value": "JFK"}, {"label": "SFO", "value": "SFO"}, {"label": "ORD", "value": "ORD"}, {"label": "BOS", "value": "BOS"}, {"label": "ATL", "value": "ATL"}, {"label": "DFW", "value": "DFW"}, {"label": "SEA", "value": "SEA"}, {"label": "MIA", "value": "MIA"}, {"label": "DEN", "value": "DEN"}], "value": {"path": "/origin"}, "variant": "mutuallyExclusive"}, {"id": "dest", "component": "ChoicePicker", "label": "Destination", "options": [{"label": "LAX", "value": "LAX"}, {"label": "JFK", "value": "JFK"}, {"label": "SFO", "value": "SFO"}, {"label": "ORD", "value": "ORD"}, {"label": "BOS", "value": "BOS"}, {"label": "ATL", "value": "ATL"}, {"label": "DFW", "value": "DFW"}, {"label": "SEA", "value": "SEA"}, {"label": "MIA", "value": "MIA"}, {"label": "DEN", "value": "DEN"}], "value": {"path": "/dest"}, "variant": "mutuallyExclusive"}, {"id": "fare", "component": "ChoicePicker", "label": "Fare class", "options": [{"label": "Economy", "value": "Economy"}, {"label": "Premium", "value": "Premium"}, {"label": "Business", "value": "Business"}, {"label": "First", "value": "First"}], "value": {"path": "/fare_class"}, "variant": "mutuallyExclusive"}, {"id": "date", "component": "DateTimeInput", "label": "Departure date (YYYY-MM-DD)", "value": {"path": "/date"}, "enableDate": true}, {"id": "passengers", "component": "TextField", "label": "Passengers", "value": {"path": "/passengers"}, "variant": "number"}, {"id": "submit", "component": "Button", "child": "submit_label", "variant": "primary", "action": {"event": {"name": "bookingSubmit", "context": {"formId": "booking", "origin": {"path": "/origin"}, "dest": {"path": "/dest"}, "date": {"path": "/date"}, "passengers": {"path": "/passengers"}, "fare_class": {"path": "/fare_class"}}}}}, {"id": "submit_label", "component": "Text", "text": "Search flights"}]}}\n{"version": "v0.9", "updateDataModel": {"surfaceId": "booking", "path": "/", "value": {"origin": ["LAX"], "dest": ["JFK"], "date": "", "passengers": 1, "fare_class": ["Economy"]}}}\n',
  '---a2ui_JSON---\n{"version": "v0.9", "createSurface": {"surfaceId": "results", "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}\n{"version": "v0.9", "updateComponents": {"surfaceId": "results", "components": [{"id": "root", "component": "Column", "children": ["card_0"]}, {"id": "card_0", "component": "Card", "child": "col_0"}, {"id": "col_0", "component": "Column", "children": ["title_0", "route_0", "time_0", "btn_0"]}, {"id": "title_0", "component": "Text", "text": "UA flight UA123", "variant": "h3"}, {"id": "route_0", "component": "Text", "text": "LAX \\u2192 JFK  \\u2022  330 min  \\u2022  Boeing 787", "variant": "body"}, {"id": "time_0", "component": "Text", "text": "Depart 08:00  \\u2022  Arrive 16:30  \\u2022  Gate B14", "variant": "caption"}, {"id": "btn_0", "component": "Button", "child": "btn_label_0", "variant": "primary", "action": {"event": {"name": "flightSelect", "context": {"flightId": "UA123"}}}}, {"id": "btn_label_0", "component": "Text", "text": "Select"}]}}\n',
  '---a2ui_JSON---\n{"version": "v0.9", "createSurface": {"surfaceId": "confirmation", "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}\n{"version": "v0.9", "updateComponents": {"surfaceId": "confirmation", "components": [{"id": "root", "component": "Column", "children": ["card"]}, {"id": "card", "component": "Card", "child": "card_col"}, {"id": "card_col", "component": "Column", "children": ["title", "party_text", "modify"]}, {"id": "title", "component": "Text", "text": "UA flight UA123", "variant": "h2"}, {"id": "party_text", "component": "Text", "text": "2 passengers  \\u2022  Business", "variant": "body"}, {"id": "modify", "component": "Button", "child": "modify_label", "variant": "primary", "action": {"event": {"name": "modifySearch", "context": {"formId": "booking"}}}}, {"id": "modify_label", "component": "Text", "text": "Modify search"}]}}\n',
  '---a2ui_JSON---\n{"version": "v0.9", "createSurface": {"surfaceId": "booking", "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}\n{"version": "v0.9", "updateComponents": {"surfaceId": "booking", "components": [{"id": "root", "component": "Column", "children": ["card"]}, {"id": "card", "component": "Card", "child": "card_col"}, {"id": "card_col", "component": "Column", "children": ["title", "origin", "dest", "date", "passengers", "fare", "submit"]}, {"id": "title", "component": "Text", "text": "Book a flight", "variant": "h2"}, {"id": "origin", "component": "ChoicePicker", "label": "Origin", "options": [{"label": "LAX", "value": "LAX"}, {"label": "JFK", "value": "JFK"}, {"label": "SFO", "value": "SFO"}, {"label": "ORD", "value": "ORD"}, {"label": "BOS", "value": "BOS"}, {"label": "ATL", "value": "ATL"}, {"label": "DFW", "value": "DFW"}, {"label": "SEA", "value": "SEA"}, {"label": "MIA", "value": "MIA"}, {"label": "DEN", "value": "DEN"}], "value": {"path": "/origin"}, "variant": "mutuallyExclusive"}, {"id": "dest", "component": "ChoicePicker", "label": "Destination", "options": [{"label": "LAX", "value": "LAX"}, {"label": "JFK", "value": "JFK"}, {"label": "SFO", "value": "SFO"}, {"label": "ORD", "value": "ORD"}, {"label": "BOS", "value": "BOS"}, {"label": "ATL", "value": "ATL"}, {"label": "DFW", "value": "DFW"}, {"label": "SEA", "value": "SEA"}, {"label": "MIA", "value": "MIA"}, {"label": "DEN", "value": "DEN"}], "value": {"path": "/dest"}, "variant": "mutuallyExclusive"}, {"id": "fare", "component": "ChoicePicker", "label": "Fare class", "options": [{"label": "Economy", "value": "Economy"}, {"label": "Premium", "value": "Premium"}, {"label": "Business", "value": "Business"}, {"label": "First", "value": "First"}], "value": {"path": "/fare_class"}, "variant": "mutuallyExclusive"}, {"id": "date", "component": "DateTimeInput", "label": "Departure date (YYYY-MM-DD)", "value": {"path": "/date"}, "enableDate": true}, {"id": "passengers", "component": "TextField", "label": "Passengers", "value": {"path": "/passengers"}, "variant": "number"}, {"id": "submit", "component": "Button", "child": "submit_label", "variant": "primary", "action": {"event": {"name": "bookingSubmit", "context": {"formId": "booking", "origin": {"path": "/origin"}, "dest": {"path": "/dest"}, "date": {"path": "/date"}, "passengers": {"path": "/passengers"}, "fare_class": {"path": "/fare_class"}}}}}, {"id": "submit_label", "component": "Text", "text": "Search flights"}]}}\n{"version": "v0.9", "updateDataModel": {"surfaceId": "booking", "path": "/", "value": {"origin": ["LAX"], "dest": ["JFK"], "date": "2026-11-03", "passengers": 2, "fare_class": ["Business"]}}}\n',
];

it('prepares a borrowed flight view with captured validated action authority', () => {
  const sent: unknown[] = [];
  const owner = createFlightSurface({
    content: wire[3],
    expected: 'booking',
    messageId: 'assistant-1',
    id: 'surface-1',
    isCurrent: () => true,
    onAction: (payload) => sent.push(payload),
  });
  expect(owner).toBeDefined();
  expect(owner.view.actions.submit()).toBe(true);
  expect(sent).toMatchObject([{ action: { name: 'bookingSubmit' } }]);
  owner.dispose();
});

function setup(isCurrent: () => boolean = () => true) {
  const sent: unknown[] = [];
  const owner = createFlightSurface({
    content: wire[3],
    expected: 'booking',
    id: 's1',
    messageId: 'a1',
    isCurrent,
    onAction: (p) => sent.push(p),
  });
  expect(owner).toBeDefined();
  return { owner: owner, sent };
}
it('rejects invalid lexical drafts without dispatching captured actions', () => {
  const { owner, sent } = setup();
  const click = owner.view.actions.submit;
  owner.view.edits.passengers('3e2');
  expect(booking(owner).getSnapshot().drafts.passengers).toBe('3e2');
  expect(click()).toBe(false);
  expect(sent).toEqual([]);
  owner.dispose();
});
it('revokes captured edits and actions synchronously', () => {
  const { owner, sent } = setup();
  const edit = owner.view.edits.passengers,
    click = owner.view.actions.submit;
  const old = booking(owner).getSnapshot();
  owner.revoke();
  edit('7');
  expect(booking(owner).getSnapshot()).toBe(old);
  expect(click()).toBe(false);
  expect(sent).toEqual([]);
  owner.dispose();
});
it('keeps the last historical lexical snapshot through dispose and remount subscription', () => {
  const { owner } = setup();
  owner.view.edits.passengers('003');
  const old = booking(owner).getSnapshot();
  owner.dispose();
  const notify = vi.fn();
  const release = booking(owner).subscribe(notify);
  expect(booking(owner).getSnapshot()).toBe(old);
  expect(old.drafts.passengers).toBe('003');
  owner.view.edits.passengers('8');
  expect(notify).not.toHaveBeenCalled();
  release();
  expect(booking(owner).getSnapshot()).toBe(old);
});
it('disposes every acquired resource exactly once even when disposed twice', () => {
  const originalSurface = protocol.prepareSurface,
    originalState = renderState.createRenderState,
    originalForm = forms.createBookingForm,
    originalActions = actions.createActions;
  const disposals: ReturnType<typeof vi.fn>[] = [];
  const wrap = <T extends { dispose(): void }>(resource: T): T => {
    const dispose = vi.fn(() => resource.dispose());
    disposals.push(dispose);
    return { ...resource, dispose };
  };
  vi.spyOn(protocol, 'prepareSurface').mockImplementation((...args) =>
    wrap(originalSurface(...args))
  );
  vi.spyOn(renderState, 'createRenderState').mockImplementation((...args) =>
    wrap(originalState(...args))
  );
  vi.spyOn(forms, 'createBookingForm').mockImplementation((...args) =>
    wrap(originalForm(...args))
  );
  vi.spyOn(actions, 'createActions').mockImplementation((...args) =>
    wrap(originalActions(...args))
  );
  const { owner } = setup();
  owner.dispose();
  owner.dispose();
  expect(disposals).toHaveLength(4);
  for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
});
it('closes every acquired resource once when later factory preparation fails', () => {
  const originalSurface = protocol.prepareSurface,
    originalState = renderState.createRenderState,
    originalForm = forms.createBookingForm,
    originalActions = actions.createActions;
  const disposals: ReturnType<typeof vi.fn>[] = [];
  const wrap = <T extends { dispose(): void }>(resource: T): T => {
    const dispose = vi.fn(() => resource.dispose());
    disposals.push(dispose);
    return { ...resource, dispose };
  };
  vi.spyOn(protocol, 'prepareSurface').mockImplementation((...args) =>
    wrap(originalSurface(...args))
  );
  vi.spyOn(renderState, 'createRenderState').mockImplementation((...args) =>
    wrap(originalState(...args))
  );
  vi.spyOn(forms, 'createBookingForm').mockImplementation((...args) =>
    wrap(originalForm(...args))
  );
  vi.spyOn(actions, 'createActions').mockImplementation((...args) => ({
    ...wrap(originalActions(...args)),
    capability() {
      throw Error('capture failed');
    },
  }));
  expect(() =>
    createFlightSurface({
      content: wire[3],
      expected: 'booking',
      messageId: 'a',
      id: 's',
      isCurrent: () => true,
      onAction: () => undefined,
    })
  ).toThrow('capture failed');
  expect(disposals).toHaveLength(4);
  for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
});
it('rejects actions if the action clock reentrantly closes the epoch', () => {
  const { owner, sent } = setup();
  vi.spyOn(Date.prototype, 'toISOString').mockImplementation(() => {
    owner.revoke();
    return '2026-10-17T00:00:00.000Z';
  });
  expect(owner.view.actions.submit()).toBe(false);
  expect(sent).toEqual([]);
  owner.dispose();
});
it('rejects edits and actions if an authority read reentrantly revokes this surface', () => {
  let close: () => void = () => undefined;
  const { owner, sent } = setup(() => {
    close();
    return true;
  });
  close = () => owner.revoke();
  const old = booking(owner).getSnapshot();
  owner.view.edits.passengers('9');
  expect(booking(owner).getSnapshot()).toBe(old);
  expect(owner.view.actions.submit()).toBe(false);
  expect(sent).toEqual([]);
  owner.dispose();
});

function booking(owner: FlightSurface) {
  const form = owner.view.form;
  if (!form) throw Error('Expected a booking form');
  return form;
}
