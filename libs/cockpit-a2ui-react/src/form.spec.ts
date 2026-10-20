// Canonical assistant bytes from accepted Task 1 compiled-graph four-turn receipt.
const wire = [
  '---a2ui_JSON---\n{"version": "v0.9", "createSurface": {"surfaceId": "booking", "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}\n{"version": "v0.9", "updateComponents": {"surfaceId": "booking", "components": [{"id": "root", "component": "Column", "children": ["card"]}, {"id": "card", "component": "Card", "child": "card_col"}, {"id": "card_col", "component": "Column", "children": ["title", "origin", "dest", "date", "passengers", "fare", "submit"]}, {"id": "title", "component": "Text", "text": "Book a flight", "variant": "h2"}, {"id": "origin", "component": "ChoicePicker", "label": "Origin", "options": [{"label": "LAX", "value": "LAX"}, {"label": "JFK", "value": "JFK"}, {"label": "SFO", "value": "SFO"}, {"label": "ORD", "value": "ORD"}, {"label": "BOS", "value": "BOS"}, {"label": "ATL", "value": "ATL"}, {"label": "DFW", "value": "DFW"}, {"label": "SEA", "value": "SEA"}, {"label": "MIA", "value": "MIA"}, {"label": "DEN", "value": "DEN"}], "value": {"path": "/origin"}, "variant": "mutuallyExclusive"}, {"id": "dest", "component": "ChoicePicker", "label": "Destination", "options": [{"label": "LAX", "value": "LAX"}, {"label": "JFK", "value": "JFK"}, {"label": "SFO", "value": "SFO"}, {"label": "ORD", "value": "ORD"}, {"label": "BOS", "value": "BOS"}, {"label": "ATL", "value": "ATL"}, {"label": "DFW", "value": "DFW"}, {"label": "SEA", "value": "SEA"}, {"label": "MIA", "value": "MIA"}, {"label": "DEN", "value": "DEN"}], "value": {"path": "/dest"}, "variant": "mutuallyExclusive"}, {"id": "fare", "component": "ChoicePicker", "label": "Fare class", "options": [{"label": "Economy", "value": "Economy"}, {"label": "Premium", "value": "Premium"}, {"label": "Business", "value": "Business"}, {"label": "First", "value": "First"}], "value": {"path": "/fare_class"}, "variant": "mutuallyExclusive"}, {"id": "date", "component": "DateTimeInput", "label": "Departure date (YYYY-MM-DD)", "value": {"path": "/date"}, "enableDate": true}, {"id": "passengers", "component": "TextField", "label": "Passengers", "value": {"path": "/passengers"}, "variant": "number"}, {"id": "submit", "component": "Button", "child": "submit_label", "variant": "primary", "action": {"event": {"name": "bookingSubmit", "context": {"formId": "booking", "origin": {"path": "/origin"}, "dest": {"path": "/dest"}, "date": {"path": "/date"}, "passengers": {"path": "/passengers"}, "fare_class": {"path": "/fare_class"}}}}}, {"id": "submit_label", "component": "Text", "text": "Search flights"}]}}\n{"version": "v0.9", "updateDataModel": {"surfaceId": "booking", "path": "/", "value": {"origin": ["LAX"], "dest": ["JFK"], "date": "", "passengers": 1, "fare_class": ["Economy"]}}}\n',
  '---a2ui_JSON---\n{"version": "v0.9", "createSurface": {"surfaceId": "results", "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}\n{"version": "v0.9", "updateComponents": {"surfaceId": "results", "components": [{"id": "root", "component": "Column", "children": ["card_0"]}, {"id": "card_0", "component": "Card", "child": "col_0"}, {"id": "col_0", "component": "Column", "children": ["title_0", "route_0", "time_0", "btn_0"]}, {"id": "title_0", "component": "Text", "text": "UA flight UA123", "variant": "h3"}, {"id": "route_0", "component": "Text", "text": "LAX \\u2192 JFK  \\u2022  330 min  \\u2022  Boeing 787", "variant": "body"}, {"id": "time_0", "component": "Text", "text": "Depart 08:00  \\u2022  Arrive 16:30  \\u2022  Gate B14", "variant": "caption"}, {"id": "btn_0", "component": "Button", "child": "btn_label_0", "variant": "primary", "action": {"event": {"name": "flightSelect", "context": {"flightId": "UA123"}}}}, {"id": "btn_label_0", "component": "Text", "text": "Select"}]}}\n',
  '---a2ui_JSON---\n{"version": "v0.9", "createSurface": {"surfaceId": "confirmation", "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}\n{"version": "v0.9", "updateComponents": {"surfaceId": "confirmation", "components": [{"id": "root", "component": "Column", "children": ["card"]}, {"id": "card", "component": "Card", "child": "card_col"}, {"id": "card_col", "component": "Column", "children": ["title", "party_text", "modify"]}, {"id": "title", "component": "Text", "text": "UA flight UA123", "variant": "h2"}, {"id": "party_text", "component": "Text", "text": "2 passengers  \\u2022  Business", "variant": "body"}, {"id": "modify", "component": "Button", "child": "modify_label", "variant": "primary", "action": {"event": {"name": "modifySearch", "context": {"formId": "booking"}}}}, {"id": "modify_label", "component": "Text", "text": "Modify search"}]}}\n',
  '---a2ui_JSON---\n{"version": "v0.9", "createSurface": {"surfaceId": "booking", "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}\n{"version": "v0.9", "updateComponents": {"surfaceId": "booking", "components": [{"id": "root", "component": "Column", "children": ["card"]}, {"id": "card", "component": "Card", "child": "card_col"}, {"id": "card_col", "component": "Column", "children": ["title", "origin", "dest", "date", "passengers", "fare", "submit"]}, {"id": "title", "component": "Text", "text": "Book a flight", "variant": "h2"}, {"id": "origin", "component": "ChoicePicker", "label": "Origin", "options": [{"label": "LAX", "value": "LAX"}, {"label": "JFK", "value": "JFK"}, {"label": "SFO", "value": "SFO"}, {"label": "ORD", "value": "ORD"}, {"label": "BOS", "value": "BOS"}, {"label": "ATL", "value": "ATL"}, {"label": "DFW", "value": "DFW"}, {"label": "SEA", "value": "SEA"}, {"label": "MIA", "value": "MIA"}, {"label": "DEN", "value": "DEN"}], "value": {"path": "/origin"}, "variant": "mutuallyExclusive"}, {"id": "dest", "component": "ChoicePicker", "label": "Destination", "options": [{"label": "LAX", "value": "LAX"}, {"label": "JFK", "value": "JFK"}, {"label": "SFO", "value": "SFO"}, {"label": "ORD", "value": "ORD"}, {"label": "BOS", "value": "BOS"}, {"label": "ATL", "value": "ATL"}, {"label": "DFW", "value": "DFW"}, {"label": "SEA", "value": "SEA"}, {"label": "MIA", "value": "MIA"}, {"label": "DEN", "value": "DEN"}], "value": {"path": "/dest"}, "variant": "mutuallyExclusive"}, {"id": "fare", "component": "ChoicePicker", "label": "Fare class", "options": [{"label": "Economy", "value": "Economy"}, {"label": "Premium", "value": "Premium"}, {"label": "Business", "value": "Business"}, {"label": "First", "value": "First"}], "value": {"path": "/fare_class"}, "variant": "mutuallyExclusive"}, {"id": "date", "component": "DateTimeInput", "label": "Departure date (YYYY-MM-DD)", "value": {"path": "/date"}, "enableDate": true}, {"id": "passengers", "component": "TextField", "label": "Passengers", "value": {"path": "/passengers"}, "variant": "number"}, {"id": "submit", "component": "Button", "child": "submit_label", "variant": "primary", "action": {"event": {"name": "bookingSubmit", "context": {"formId": "booking", "origin": {"path": "/origin"}, "dest": {"path": "/dest"}, "date": {"path": "/date"}, "passengers": {"path": "/passengers"}, "fare_class": {"path": "/fare_class"}}}}}, {"id": "submit_label", "component": "Text", "text": "Search flights"}]}}\n{"version": "v0.9", "updateDataModel": {"surfaceId": "booking", "path": "/", "value": {"origin": ["LAX"], "dest": ["JFK"], "date": "2026-11-03", "passengers": 2, "fare_class": ["Business"]}}}\n',
];
import { describe, expect, it, vi } from 'vitest';
import { createRenderState } from '@threadplane/content/render-state';
import { prepareSurface } from './protocol.js';
import { createBookingForm } from './form.js';
function setup(index = 0) {
  const surface = prepareSurface(wire[index], 'booking');
  const state = createRenderState(surface.model);
  const form = createBookingForm(surface, state);
  return { surface, state, form };
}
function valid(s: ReturnType<typeof setup>) {
  for (const [id, value] of [
    ['origin', 'LAX'],
    ['dest', 'JFK'],
    ['date', '2028-02-29'],
  ])
    s.form.edit(id, value);
  return s;
}
describe('owned coherent booking facade', () => {
  it('preserves exact route-derived graph defaults and raw state', () => {
    const s = setup();
    expect(s.form.getSnapshot().model).toEqual(s.surface.model);
    expect(s.form.getSnapshot().model).toEqual({
      origin: ['LAX'],
      dest: ['JFK'],
      date: '',
      passengers: 1,
      fare_class: ['Economy'],
    });
    expect(s.form.getSnapshot().valid).toBe(false);
    s.form.edit('origin', 'SFO');
    expect(s.surface.model.origin).toEqual(['LAX']);
  });
  it('edits fresh picker arrays and retains blank arrays', () => {
    const s = setup();
    const before = s.form.getSnapshot();
    s.form.edit('origin', 'SFO');
    const chosen = s.form.getSnapshot();
    expect(chosen.model.origin).toEqual(['SFO']);
    expect(chosen.model.origin).not.toBe(before.model.origin);
    s.form.edit('origin', '');
    expect(s.form.getSnapshot().model.origin).toEqual([]);
    expect(chosen.model.origin).toEqual(['SFO']);
  });
  it.each([
    '',
    ' ',
    '1e2',
    '1.5',
    '0',
    '-1',
    'NaN',
    'Infinity',
    '9007199254740992',
    '+2',
    '2x',
  ])('retains invalid passenger draft %j with zero model writes', (draft) => {
    const s = valid(setup());
    const old = s.form.getSnapshot();
    const set = vi.spyOn(s.state, 'set');
    s.form.edit('passengers', draft);
    expect(set).not.toHaveBeenCalled();
    expect(s.form.getSnapshot().model).toBe(old.model);
    expect(s.form.getSnapshot().drafts.passengers).toBe(draft);
    expect(s.form.getSnapshot().valid).toBe(false);
    expect(s.form.canSubmit()).toBe(false);
    expect(old.valid).toBe(true);
  });
  it('preserves accepted lexical spelling and scalar no-op identity', () => {
    const s = valid(setup());
    s.form.edit('passengers', '003');
    const a = s.form.getSnapshot();
    expect(a.model.passengers).toBe(3);
    expect(a.drafts.passengers).toBe('003');
    s.form.edit('passengers', '0003');
    expect(s.form.getSnapshot().model).toBe(a.model);
    expect(s.form.getSnapshot().drafts.passengers).toBe('0003');
    expect(a.drafts.passengers).toBe('003');
    expect(Object.isFrozen(a.errors)).toBe(true);
  });
  it.each([
    '2027-02-29',
    '2028-02-30',
    '2028-04-31',
    '2028-00-10',
    '2028-13-01',
    '2028-1-01',
    '2028-01-01T00:00:00Z',
    '0000-01-01',
    '',
  ])('rejects noncalendar date %j without model writes', (draft) => {
    const s = valid(setup());
    const before = s.form.getSnapshot();
    s.form.edit('date', draft);
    expect(s.form.getSnapshot().model).toBe(before.model);
    expect(s.form.getSnapshot().valid).toBe(false);
  });
  it('accepts historical leap dates with no current-day/timezone rule', () => {
    const s = valid(setup());
    s.form.edit('date', '2000-02-29');
    expect(s.form.getSnapshot().model.date).toBe('2000-02-29');
    expect(s.form.canSubmit()).toBe(true);
  });
  it('rejects unknown airport/fare and equal origin/destination', () => {
    const s = valid(setup());
    for (const [field, value] of [
      ['origin', 'XXX'],
      ['fare', 'Luxury'],
    ]) {
      const before = s.form.getSnapshot().model;
      s.form.edit(field, value);
      expect(s.form.getSnapshot().model).toBe(before);
      expect(s.form.canSubmit()).toBe(false);
    }
    s.form.edit('origin', 'JFK');
    s.form.edit('fare', 'Business');
    expect(s.form.getSnapshot().errors.dest).toBeTruthy();
    expect(s.form.canSubmit()).toBe(false);
  });
  it('serializes reentrant facade edits and closes action authority during notifications', () => {
    const s = valid(setup());
    const seen: any[] = [];
    let queued = false;
    s.form.subscribe(() => {
      const snap = s.form.getSnapshot();
      seen.push([
        snap.drafts.passengers,
        snap.model.passengers,
        snap.valid,
        s.form.canSubmit(),
      ]);
      if (!queued) {
        queued = true;
        s.form.edit('passengers', '');
      }
    });
    s.form.edit('passengers', '2');
    expect(seen).toEqual([
      ['2', 2, true, false],
      ['', 2, false, false],
    ]);
    expect(s.form.canSubmit()).toBe(false);
  });
  it('closes authority in synchronous borrowed-owner listeners before facade publication', () => {
    const s = valid(setup());
    const reads: any[] = [];
    s.state.subscribe(() => reads.push(s.form.canSubmit()));
    s.form.edit('passengers', '2');
    expect(reads).toEqual([false]);
    expect(s.form.canSubmit()).toBe(true);
  });
  it('captured edits read latest model and retire with components, form or surface', () => {
    const s = valid(setup());
    const edit = s.form.captureEdit('passengers');
    edit('2');
    s.form.edit('origin', 'SFO');
    edit('3');
    expect(s.form.getSnapshot().model.origin).toEqual(['SFO']);
    expect(s.form.getSnapshot().model.passengers).toBe(3);
    s.surface.retireComponent('passengers');
    edit('4');
    expect(s.form.getSnapshot().model.passengers).toBe(3);
    s.form.dispose();
    s.form.edit('origin', 'BOS');
    expect(s.form.getSnapshot().model.origin).toEqual(['SFO']);
    expect(s.form.canSubmit()).toBe(false);
  });
  it('surface retirement makes every borrowed edit inert and leaves snapshots inspectable', () => {
    const s = valid(setup());
    const before = s.form.getSnapshot();
    s.surface.dispose();
    s.form.edit('passengers', '9');
    expect(s.form.getSnapshot()).toBe(before);
    expect(s.form.canSubmit()).toBe(false);
    s.form.dispose();
    expect(() => s.state.set('/passengers', 5)).not.toThrow();
  });
  it('borrowed model drift invalidates authority instead of submitting an unobserved value', () => {
    const s = valid(setup());
    s.state.set('/date', 'bad');
    expect(s.form.canSubmit()).toBe(false);
    expect(s.form.getSnapshot().valid).toBe(false);
  });
  it('fails closed after an independent reentrant malformed write during its own typed write', () => {
    const s = valid(setup());
    let changed = false;
    s.state.subscribe(() => {
      if (!changed) {
        changed = true;
        s.state.set('/origin', null);
      }
    });
    expect(() => s.form.edit('passengers', '2')).not.toThrow();
    expect(s.form.canSubmit()).toBe(false);
    expect(s.form.getSnapshot().valid).toBe(false);
    expect(s.form.getSnapshot().model.origin).toEqual(['LAX']);
  });
  it('closes authority even before its owner subscription sees an external write', () => {
    const surface = prepareSurface(wire[3], 'booking'),
      state = createRenderState(surface.model);
    const seen: boolean[] = [];
    state.subscribe(() => seen.push(form.canSubmit()));
    const form = createBookingForm(surface, state);
    expect(form.canSubmit()).toBe(true);
    state.set('/origin', null);
    expect(seen).toEqual([false]);
  });
  it('uses exact source blank defaults without scalarizing picker arrays', () => {
    const lines = wire[0].split('\n'),
      model = JSON.parse(lines[3]);
    model.updateDataModel.value = {
      origin: [],
      dest: [],
      date: '',
      passengers: 1,
      fare_class: ['Economy'],
    };
    lines[3] = JSON.stringify(model);
    const surface = prepareSurface(lines.join('\n'), 'booking'),
      form = createBookingForm(surface, createRenderState(surface.model));
    expect(form.getSnapshot().model.origin).toEqual([]);
    expect(form.getSnapshot().model.dest).toEqual([]);
    expect(form.getSnapshot().drafts).toEqual({
      origin: '',
      dest: '',
      date: '',
      passengers: '1',
      fare_class: 'Economy',
    });
    expect(form.canSubmit()).toBe(false);
  });
  it('reentrant repeated identical drafts are observational no-ops', () => {
    const s = valid(setup());
    let notifications = 0;
    s.form.subscribe(() => {
      notifications++;
      if (notifications < 3) s.form.edit('passengers', '');
    });
    s.form.edit('passengers', '');
    expect(notifications).toBe(1);
    const snapshot = s.form.getSnapshot();
    s.form.edit('passengers', '');
    expect(s.form.getSnapshot()).toBe(snapshot);
    expect(notifications).toBe(1);
  });
});
