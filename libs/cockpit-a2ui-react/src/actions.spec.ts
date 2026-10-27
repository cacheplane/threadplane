// Canonical assistant bytes from accepted Task 1 compiled-graph four-turn receipt.
const wire = [
  '---a2ui_JSON---\n{"version": "v0.9", "createSurface": {"surfaceId": "booking", "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}\n{"version": "v0.9", "updateComponents": {"surfaceId": "booking", "components": [{"id": "root", "component": "Column", "children": ["card"]}, {"id": "card", "component": "Card", "child": "card_col"}, {"id": "card_col", "component": "Column", "children": ["title", "origin", "dest", "date", "passengers", "fare", "submit"]}, {"id": "title", "component": "Text", "text": "Book a flight", "variant": "h2"}, {"id": "origin", "component": "ChoicePicker", "label": "Origin", "options": [{"label": "LAX", "value": "LAX"}, {"label": "JFK", "value": "JFK"}, {"label": "SFO", "value": "SFO"}, {"label": "ORD", "value": "ORD"}, {"label": "BOS", "value": "BOS"}, {"label": "ATL", "value": "ATL"}, {"label": "DFW", "value": "DFW"}, {"label": "SEA", "value": "SEA"}, {"label": "MIA", "value": "MIA"}, {"label": "DEN", "value": "DEN"}], "value": {"path": "/origin"}, "variant": "mutuallyExclusive"}, {"id": "dest", "component": "ChoicePicker", "label": "Destination", "options": [{"label": "LAX", "value": "LAX"}, {"label": "JFK", "value": "JFK"}, {"label": "SFO", "value": "SFO"}, {"label": "ORD", "value": "ORD"}, {"label": "BOS", "value": "BOS"}, {"label": "ATL", "value": "ATL"}, {"label": "DFW", "value": "DFW"}, {"label": "SEA", "value": "SEA"}, {"label": "MIA", "value": "MIA"}, {"label": "DEN", "value": "DEN"}], "value": {"path": "/dest"}, "variant": "mutuallyExclusive"}, {"id": "fare", "component": "ChoicePicker", "label": "Fare class", "options": [{"label": "Economy", "value": "Economy"}, {"label": "Premium", "value": "Premium"}, {"label": "Business", "value": "Business"}, {"label": "First", "value": "First"}], "value": {"path": "/fare_class"}, "variant": "mutuallyExclusive"}, {"id": "date", "component": "DateTimeInput", "label": "Departure date (YYYY-MM-DD)", "value": {"path": "/date"}, "enableDate": true}, {"id": "passengers", "component": "TextField", "label": "Passengers", "value": {"path": "/passengers"}, "variant": "number"}, {"id": "submit", "component": "Button", "child": "submit_label", "variant": "primary", "action": {"event": {"name": "bookingSubmit", "context": {"formId": "booking", "origin": {"path": "/origin"}, "dest": {"path": "/dest"}, "date": {"path": "/date"}, "passengers": {"path": "/passengers"}, "fare_class": {"path": "/fare_class"}}}}}, {"id": "submit_label", "component": "Text", "text": "Search flights"}]}}\n{"version": "v0.9", "updateDataModel": {"surfaceId": "booking", "path": "/", "value": {"origin": ["LAX"], "dest": ["JFK"], "date": "", "passengers": 1, "fare_class": ["Economy"]}}}\n',
  '---a2ui_JSON---\n{"version": "v0.9", "createSurface": {"surfaceId": "results", "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}\n{"version": "v0.9", "updateComponents": {"surfaceId": "results", "components": [{"id": "root", "component": "Column", "children": ["card_0"]}, {"id": "card_0", "component": "Card", "child": "col_0"}, {"id": "col_0", "component": "Column", "children": ["title_0", "route_0", "time_0", "btn_0"]}, {"id": "title_0", "component": "Text", "text": "UA flight UA123", "variant": "h3"}, {"id": "route_0", "component": "Text", "text": "LAX \\u2192 JFK  \\u2022  330 min  \\u2022  Boeing 787", "variant": "body"}, {"id": "time_0", "component": "Text", "text": "Depart 08:00  \\u2022  Arrive 16:30  \\u2022  Gate B14", "variant": "caption"}, {"id": "btn_0", "component": "Button", "child": "btn_label_0", "variant": "primary", "action": {"event": {"name": "flightSelect", "context": {"flightId": "UA123"}}}}, {"id": "btn_label_0", "component": "Text", "text": "Select"}]}}\n',
  '---a2ui_JSON---\n{"version": "v0.9", "createSurface": {"surfaceId": "confirmation", "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}\n{"version": "v0.9", "updateComponents": {"surfaceId": "confirmation", "components": [{"id": "root", "component": "Column", "children": ["card"]}, {"id": "card", "component": "Card", "child": "card_col"}, {"id": "card_col", "component": "Column", "children": ["title", "party_text", "modify"]}, {"id": "title", "component": "Text", "text": "UA flight UA123", "variant": "h2"}, {"id": "party_text", "component": "Text", "text": "2 passengers  \\u2022  Business", "variant": "body"}, {"id": "modify", "component": "Button", "child": "modify_label", "variant": "primary", "action": {"event": {"name": "modifySearch", "context": {"formId": "booking"}}}}, {"id": "modify_label", "component": "Text", "text": "Modify search"}]}}\n',
  '---a2ui_JSON---\n{"version": "v0.9", "createSurface": {"surfaceId": "booking", "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}\n{"version": "v0.9", "updateComponents": {"surfaceId": "booking", "components": [{"id": "root", "component": "Column", "children": ["card"]}, {"id": "card", "component": "Card", "child": "card_col"}, {"id": "card_col", "component": "Column", "children": ["title", "origin", "dest", "date", "passengers", "fare", "submit"]}, {"id": "title", "component": "Text", "text": "Book a flight", "variant": "h2"}, {"id": "origin", "component": "ChoicePicker", "label": "Origin", "options": [{"label": "LAX", "value": "LAX"}, {"label": "JFK", "value": "JFK"}, {"label": "SFO", "value": "SFO"}, {"label": "ORD", "value": "ORD"}, {"label": "BOS", "value": "BOS"}, {"label": "ATL", "value": "ATL"}, {"label": "DFW", "value": "DFW"}, {"label": "SEA", "value": "SEA"}, {"label": "MIA", "value": "MIA"}, {"label": "DEN", "value": "DEN"}], "value": {"path": "/origin"}, "variant": "mutuallyExclusive"}, {"id": "dest", "component": "ChoicePicker", "label": "Destination", "options": [{"label": "LAX", "value": "LAX"}, {"label": "JFK", "value": "JFK"}, {"label": "SFO", "value": "SFO"}, {"label": "ORD", "value": "ORD"}, {"label": "BOS", "value": "BOS"}, {"label": "ATL", "value": "ATL"}, {"label": "DFW", "value": "DFW"}, {"label": "SEA", "value": "SEA"}, {"label": "MIA", "value": "MIA"}, {"label": "DEN", "value": "DEN"}], "value": {"path": "/dest"}, "variant": "mutuallyExclusive"}, {"id": "fare", "component": "ChoicePicker", "label": "Fare class", "options": [{"label": "Economy", "value": "Economy"}, {"label": "Premium", "value": "Premium"}, {"label": "Business", "value": "Business"}, {"label": "First", "value": "First"}], "value": {"path": "/fare_class"}, "variant": "mutuallyExclusive"}, {"id": "date", "component": "DateTimeInput", "label": "Departure date (YYYY-MM-DD)", "value": {"path": "/date"}, "enableDate": true}, {"id": "passengers", "component": "TextField", "label": "Passengers", "value": {"path": "/passengers"}, "variant": "number"}, {"id": "submit", "component": "Button", "child": "submit_label", "variant": "primary", "action": {"event": {"name": "bookingSubmit", "context": {"formId": "booking", "origin": {"path": "/origin"}, "dest": {"path": "/dest"}, "date": {"path": "/date"}, "passengers": {"path": "/passengers"}, "fare_class": {"path": "/fare_class"}}}}}, {"id": "submit_label", "component": "Text", "text": "Search flights"}]}}\n{"version": "v0.9", "updateDataModel": {"surfaceId": "booking", "path": "/", "value": {"origin": ["LAX"], "dest": ["JFK"], "date": "2026-11-03", "passengers": 2, "fare_class": ["Business"]}}}\n',
];
import { describe, expect, it } from 'vitest';
import { createRenderState } from '@threadplane/content/render-state';
import { prepareSurface } from './protocol.js';
import { createBookingForm } from './form.js';
import { createActions } from './actions.js';
const timestamp = () => '2026-10-17T00:00:00.000Z';
function setup(index = 3, metadata = false) {
  let text = wire[index];
  if (metadata) {
    const lines = text.split('\n');
    const first = JSON.parse(lines[1]);
    first.createSurface.sendDataModel = true;
    lines[1] = JSON.stringify(first);
    text = lines.join('\n');
  }
  const surface = prepareSurface(
    text,
    index === 1 ? 'results' : index === 2 ? 'confirmation' : 'booking'
  );
  const state = createRenderState(surface.model),
    form =
      index === 0 || index === 3
        ? createBookingForm(surface, state)
        : undefined;
  const sent: any[] = [];
  const actions = createActions(surface, {
    form,
    timestamp,
    dispatch: (payload: any) => sent.push(payload),
  });
  return { surface, state, form, actions, sent };
}
describe('transport-free captured action capabilities', () => {
  it('resolves supported flightId and authored label paths from captured result data', () => {
    const lines = wire[1].split('\n'),
      message = JSON.parse(lines[2]);
    message.updateComponents.components.find(
      (c: any) => c.id === 'btn_0'
    ).action.event.context.flightId = { path: '/flightId' };
    message.updateComponents.components.find(
      (c: any) => c.id === 'btn_label_0'
    ).text = { path: '/caption' };
    lines[2] = JSON.stringify(message);
    lines.splice(
      3,
      0,
      JSON.stringify({
        version: 'v0.9',
        updateDataModel: {
          surfaceId: 'results',
          path: '/',
          value: { flightId: 'UA123', caption: 'Select demo' },
        },
      })
    );
    const surface = prepareSurface(lines.join('\n'), 'results'),
      sent: any[] = [];
    const actions = createActions(surface, {
      timestamp,
      dispatch: (p) => sent.push(p),
    });
    expect(actions.capability('btn_0')()).toBe(true);
    expect(sent[0].action.context).toEqual({ flightId: 'UA123' });
    expect(sent[0].action.label).toBe('Select demo');
  });
  it('captures latest arrays, identifiers, authored label and injected time', () => {
    const s = setup();
    s.form!.edit('origin', 'SFO');
    s.form!.edit('dest', 'SEA');
    s.form!.edit('passengers', '003');
    const click = s.actions.capability('submit');
    s.form!.edit('fare', 'Business');
    expect(click()).toBe(true);
    expect(s.sent).toEqual([
      {
        version: 'v0.9',
        action: {
          name: 'bookingSubmit',
          surfaceId: 'booking',
          sourceComponentId: 'submit',
          timestamp: timestamp(),
          label: 'Search flights',
          context: {
            formId: 'booking',
            origin: ['SFO'],
            dest: ['SEA'],
            date: s.form!.getSnapshot().model.date,
            passengers: 3,
            fare_class: ['Business'],
          },
        },
      },
    ]);
    s.form!.edit('passengers', '5');
    expect(s.sent[0].action.context.passengers).toBe(3);
    expect(Object.isFrozen(s.sent[0].action.context.origin)).toBe(true);
  });
  it.each(['', '1e3', '1.1', '9007199254740992'])(
    'direct Search while visible invalid draft %j dispatches zero',
    (draft) => {
      const s = setup();
      const click = s.actions.capability('submit');
      expect(s.form!.canSubmit()).toBe(true);
      const old = s.form!.getSnapshot().model;
      s.form!.edit('passengers', draft);
      expect(s.form!.getSnapshot().model).toBe(old);
      expect(click()).toBe(false);
      expect(s.sent).toEqual([]);
    }
  );
  it('prevents direct activation from borrowed-owner and facade listeners', () => {
    const s = setup();
    const click = s.actions.capability('submit');
    s.state.subscribe(() => click());
    s.form!.subscribe(() => click());
    s.form!.edit('passengers', '4');
    expect(s.sent).toEqual([]);
    expect(click()).toBe(true);
    expect(s.sent).toHaveLength(1);
  });
  it('emits only the clean current model in exact sendDataModel metadata', () => {
    const s = setup(3, true);
    s.form!.edit('passengers', '003');
    s.actions.capability('submit')();
    expect(s.sent[0].metadata).toEqual({
      a2uiClientDataModel: {
        surfaces: { booking: s.form!.getSnapshot().model },
      },
    });
    expect(JSON.stringify(s.sent[0].metadata)).not.toMatch(
      /draft|errors|valid/
    );
  });
  it.each([
    [1, 'btn_0', 'flightSelect', { flightId: 'UA123' }],
    [2, 'modify', 'modifySearch', { formId: 'booking' }],
  ] as const)(
    'captures supported event on turn %i',
    (index, id, name, context) => {
      const s = setup(index);
      expect(s.actions.capability(id)()).toBe(true);
      expect(s.sent[0].action).toMatchObject({ name, context });
    }
  );
  it('retired component callbacks and same-ID recreated surfaces stay inert', () => {
    const old = setup(),
      fresh = setup();
    const click = old.actions.capability('submit');
    old.surface.dispose();
    expect(click()).toBe(false);
    expect(fresh.actions.capability('submit')()).toBe(true);
    expect(old.sent).toEqual([]);
    const retained = fresh.actions.capability('submit');
    fresh.surface.retireComponent('submit');
    expect(retained()).toBe(false);
  });
  it('rejects nonbutton IDs and disposed actions, retaining captured data', () => {
    const s = setup();
    expect(s.actions.capability('origin')()).toBe(false);
    const click = s.actions.capability('submit');
    s.actions.dispose();
    expect(click()).toBe(false);
    expect(s.sent).toEqual([]);
  });
  it('rejects a form facade from another opaque surface epoch', () => {
    const a = setup();
    const b = setup();
    expect(() =>
      createActions(a.surface, { form: b.form, timestamp, dispatch: () => undefined })
    ).toThrow();
  });
  it('accepts matching literal booking context but refuses stale literals after edits', () => {
    const lines = wire[3].split('\n'),
      message = JSON.parse(lines[2]),
      model = JSON.parse(lines[3]).updateDataModel.value;
    const context = message.updateComponents.components.find(
      (c: any) => c.id === 'submit'
    ).action.event.context;
    Object.assign(context, model);
    lines[2] = JSON.stringify(message);
    const surface = prepareSurface(lines.join('\n'), 'booking'),
      state = createRenderState(surface.model),
      form = createBookingForm(surface, state),
      sent: any[] = [];
    const actions = createActions(surface, {
        form,
        timestamp,
        dispatch: (p) => sent.push(p),
      }),
      click = actions.capability('submit');
    expect(click()).toBe(true);
    form.edit('origin', 'SFO');
    expect(form.canSubmit()).toBe(true);
    expect(click()).toBe(false);
    expect(sent).toHaveLength(1);
  });
  it('retiring an authored button label also retires its captured action contract', () => {
    const s = setup();
    const click = s.actions.capability('submit');
    s.surface.retireComponent('submit_label');
    expect(click()).toBe(false);
    expect(s.sent).toEqual([]);
  });
  it('independent malformed reentrant store writes cannot revive prior valid Search authority', () => {
    const s = setup();
    const click = s.actions.capability('submit');
    let changed = false;
    s.state.subscribe(() => {
      if (!changed) {
        changed = true;
        s.state.set('/origin', null);
      }
      click();
    });
    expect(() => s.form!.edit('passengers', '4')).not.toThrow();
    expect(changed).toBe(true);
    expect(click()).toBe(false);
    expect(s.sent).toEqual([]);
  });
  it('captures option capability references so caller mutation cannot swap the epoch', () => {
    const s = setup(),
      other = setup();
    const sent: any[] = [];
    const options = {
      form: s.form,
      timestamp,
      dispatch: (p: any) => sent.push(p),
    };
    const actions = createActions(s.surface, options),
      click = actions.capability('submit');
    s.form!.edit('passengers', '');
    options.form = other.form;
    options.dispatch = () => {
      throw Error('replaced');
    };
    expect(click()).toBe(false);
    expect(sent).toEqual([]);
  });
});
