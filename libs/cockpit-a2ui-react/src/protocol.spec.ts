// Canonical assistant bytes from accepted Task 1 compiled-graph four-turn receipt.
const wire = [
  '---a2ui_JSON---\n{"version": "v0.9", "createSurface": {"surfaceId": "booking", "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}\n{"version": "v0.9", "updateComponents": {"surfaceId": "booking", "components": [{"id": "root", "component": "Column", "children": ["card"]}, {"id": "card", "component": "Card", "child": "card_col"}, {"id": "card_col", "component": "Column", "children": ["title", "origin", "dest", "date", "passengers", "fare", "submit"]}, {"id": "title", "component": "Text", "text": "Book a flight", "variant": "h2"}, {"id": "origin", "component": "ChoicePicker", "label": "Origin", "options": [{"label": "LAX", "value": "LAX"}, {"label": "JFK", "value": "JFK"}, {"label": "SFO", "value": "SFO"}, {"label": "ORD", "value": "ORD"}, {"label": "BOS", "value": "BOS"}, {"label": "ATL", "value": "ATL"}, {"label": "DFW", "value": "DFW"}, {"label": "SEA", "value": "SEA"}, {"label": "MIA", "value": "MIA"}, {"label": "DEN", "value": "DEN"}], "value": {"path": "/origin"}, "variant": "mutuallyExclusive"}, {"id": "dest", "component": "ChoicePicker", "label": "Destination", "options": [{"label": "LAX", "value": "LAX"}, {"label": "JFK", "value": "JFK"}, {"label": "SFO", "value": "SFO"}, {"label": "ORD", "value": "ORD"}, {"label": "BOS", "value": "BOS"}, {"label": "ATL", "value": "ATL"}, {"label": "DFW", "value": "DFW"}, {"label": "SEA", "value": "SEA"}, {"label": "MIA", "value": "MIA"}, {"label": "DEN", "value": "DEN"}], "value": {"path": "/dest"}, "variant": "mutuallyExclusive"}, {"id": "fare", "component": "ChoicePicker", "label": "Fare class", "options": [{"label": "Economy", "value": "Economy"}, {"label": "Premium", "value": "Premium"}, {"label": "Business", "value": "Business"}, {"label": "First", "value": "First"}], "value": {"path": "/fare_class"}, "variant": "mutuallyExclusive"}, {"id": "date", "component": "DateTimeInput", "label": "Departure date (YYYY-MM-DD)", "value": {"path": "/date"}, "enableDate": true}, {"id": "passengers", "component": "TextField", "label": "Passengers", "value": {"path": "/passengers"}, "variant": "number"}, {"id": "submit", "component": "Button", "child": "submit_label", "variant": "primary", "action": {"event": {"name": "bookingSubmit", "context": {"formId": "booking", "origin": {"path": "/origin"}, "dest": {"path": "/dest"}, "date": {"path": "/date"}, "passengers": {"path": "/passengers"}, "fare_class": {"path": "/fare_class"}}}}}, {"id": "submit_label", "component": "Text", "text": "Search flights"}]}}\n{"version": "v0.9", "updateDataModel": {"surfaceId": "booking", "path": "/", "value": {"origin": ["LAX"], "dest": ["JFK"], "date": "", "passengers": 1, "fare_class": ["Economy"]}}}\n',
  '---a2ui_JSON---\n{"version": "v0.9", "createSurface": {"surfaceId": "results", "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}\n{"version": "v0.9", "updateComponents": {"surfaceId": "results", "components": [{"id": "root", "component": "Column", "children": ["card_0"]}, {"id": "card_0", "component": "Card", "child": "col_0"}, {"id": "col_0", "component": "Column", "children": ["title_0", "route_0", "time_0", "btn_0"]}, {"id": "title_0", "component": "Text", "text": "UA flight UA123", "variant": "h3"}, {"id": "route_0", "component": "Text", "text": "LAX \\u2192 JFK  \\u2022  330 min  \\u2022  Boeing 787", "variant": "body"}, {"id": "time_0", "component": "Text", "text": "Depart 08:00  \\u2022  Arrive 16:30  \\u2022  Gate B14", "variant": "caption"}, {"id": "btn_0", "component": "Button", "child": "btn_label_0", "variant": "primary", "action": {"event": {"name": "flightSelect", "context": {"flightId": "UA123"}}}}, {"id": "btn_label_0", "component": "Text", "text": "Select"}]}}\n',
  '---a2ui_JSON---\n{"version": "v0.9", "createSurface": {"surfaceId": "confirmation", "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}\n{"version": "v0.9", "updateComponents": {"surfaceId": "confirmation", "components": [{"id": "root", "component": "Column", "children": ["card"]}, {"id": "card", "component": "Card", "child": "card_col"}, {"id": "card_col", "component": "Column", "children": ["title", "party_text", "modify"]}, {"id": "title", "component": "Text", "text": "UA flight UA123", "variant": "h2"}, {"id": "party_text", "component": "Text", "text": "2 passengers  \\u2022  Business", "variant": "body"}, {"id": "modify", "component": "Button", "child": "modify_label", "variant": "primary", "action": {"event": {"name": "modifySearch", "context": {"formId": "booking"}}}}, {"id": "modify_label", "component": "Text", "text": "Modify search"}]}}\n',
  '---a2ui_JSON---\n{"version": "v0.9", "createSurface": {"surfaceId": "booking", "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}\n{"version": "v0.9", "updateComponents": {"surfaceId": "booking", "components": [{"id": "root", "component": "Column", "children": ["card"]}, {"id": "card", "component": "Card", "child": "card_col"}, {"id": "card_col", "component": "Column", "children": ["title", "origin", "dest", "date", "passengers", "fare", "submit"]}, {"id": "title", "component": "Text", "text": "Book a flight", "variant": "h2"}, {"id": "origin", "component": "ChoicePicker", "label": "Origin", "options": [{"label": "LAX", "value": "LAX"}, {"label": "JFK", "value": "JFK"}, {"label": "SFO", "value": "SFO"}, {"label": "ORD", "value": "ORD"}, {"label": "BOS", "value": "BOS"}, {"label": "ATL", "value": "ATL"}, {"label": "DFW", "value": "DFW"}, {"label": "SEA", "value": "SEA"}, {"label": "MIA", "value": "MIA"}, {"label": "DEN", "value": "DEN"}], "value": {"path": "/origin"}, "variant": "mutuallyExclusive"}, {"id": "dest", "component": "ChoicePicker", "label": "Destination", "options": [{"label": "LAX", "value": "LAX"}, {"label": "JFK", "value": "JFK"}, {"label": "SFO", "value": "SFO"}, {"label": "ORD", "value": "ORD"}, {"label": "BOS", "value": "BOS"}, {"label": "ATL", "value": "ATL"}, {"label": "DFW", "value": "DFW"}, {"label": "SEA", "value": "SEA"}, {"label": "MIA", "value": "MIA"}, {"label": "DEN", "value": "DEN"}], "value": {"path": "/dest"}, "variant": "mutuallyExclusive"}, {"id": "fare", "component": "ChoicePicker", "label": "Fare class", "options": [{"label": "Economy", "value": "Economy"}, {"label": "Premium", "value": "Premium"}, {"label": "Business", "value": "Business"}, {"label": "First", "value": "First"}], "value": {"path": "/fare_class"}, "variant": "mutuallyExclusive"}, {"id": "date", "component": "DateTimeInput", "label": "Departure date (YYYY-MM-DD)", "value": {"path": "/date"}, "enableDate": true}, {"id": "passengers", "component": "TextField", "label": "Passengers", "value": {"path": "/passengers"}, "variant": "number"}, {"id": "submit", "component": "Button", "child": "submit_label", "variant": "primary", "action": {"event": {"name": "bookingSubmit", "context": {"formId": "booking", "origin": {"path": "/origin"}, "dest": {"path": "/dest"}, "date": {"path": "/date"}, "passengers": {"path": "/passengers"}, "fare_class": {"path": "/fare_class"}}}}}, {"id": "submit_label", "component": "Text", "text": "Search flights"}]}}\n{"version": "v0.9", "updateDataModel": {"surfaceId": "booking", "path": "/", "value": {"origin": ["LAX"], "dest": ["JFK"], "date": "2026-11-03", "passengers": 2, "fare_class": ["Business"]}}}\n',
];
import { describe, expect, it } from 'vitest';
import { prepareSurface } from './protocol.js';
const parse = (text = wire[0]) =>
  text
    .split('\n')
    .slice(1)
    .filter(Boolean)
    .map((s) => JSON.parse(s));
const wrap = (messages: any[]) =>
  '---a2ui_JSON---\n' +
  messages.map((m) => JSON.stringify(m)).join('\n') +
  '\n';
function change(edit: (messages: any[]) => void, index = 0) {
  const messages = parse(wire[index]);
  edit(messages);
  return wrap(messages);
}
function component(edit: (c: any, all: any[]) => void, id = 'origin') {
  return change((m) => {
    const all = m[1].updateComponents.components;
    edit(
      all.find((c: any) => c.id === id),
      all
    );
  });
}
describe('closed actual graph protocol admission', () => {
  describe.each([
    ['origin', 'LAX', 'SEA'],
    ['dest', 'JFK', 'SEA'],
    ['fare', 'Economy', 'First'],
  ])('%s picker complete supported value domain', (picker, selected, other) => {
    it.each([['selected', selected], ['unselected', other]])(
      'rejects an omitted %s value before creating a surface',
      (_state, omitted) => {
        const content = component((c) => {
          c.options = c.options.filter((o: any) => o.value !== omitted);
        }, picker);
        expect(() => prepareSurface(content, 'booking')).toThrow();
      }
    );
    it('rejects a duplicate field control with an incomplete option domain', () => {
      const content = component((c, all) => {
        all.find((x) => x.id === 'root').children.push('duplicate_picker');
        all.push({
          ...c,
          id: 'duplicate_picker',
          options: c.options.filter((o: any) => o.value !== other),
        });
      }, picker);
      expect(() => prepareSurface(content, 'booking')).toThrow();
    });
    it('admits reordered complete domains and complete duplicate field controls', () => {
      const content = component((c, all) => {
        c.options.reverse();
        all.find((x) => x.id === 'root').children.push('duplicate_picker');
        all.push({
          ...c,
          id: 'duplicate_picker',
          options: [...c.options].reverse(),
        });
      }, picker);
      const surface = prepareSurface(content, 'booking');
      expect(surface.components[picker].options).toEqual(
        [...(surface.components.duplicate_picker.options as any[])].reverse()
      );
      surface.dispose();
    });
  });
  it('rejects delete/recreate and repeated create sequences without exposing a resurrected surface', () => {
    const messages = parse();
    messages.splice(
      1,
      0,
      { version: 'v0.9', deleteSurface: { surfaceId: 'booking' } },
      messages[0]
    );
    expect(() => prepareSurface(wrap(messages), 'booking')).toThrow();
  });
  it.each([
    ['booking', 0],
    ['results', 1],
    ['confirmation', 2],
    ['booking', 3],
  ] as const)('admits complete canonical %s turn %i', (id, i) => {
    expect(wire[i].endsWith('\n')).toBe(true);
    const owner = prepareSurface(wire[i], id);
    expect(owner.surfaceId).toBe(id);
    expect(owner.spec.root).toBe('root');
    expect(owner.rawSnapshot.surfaces).toHaveLength(1);
    expect(Object.isFrozen(owner.spec.elements)).toBe(true);
    expect(JSON.stringify(owner.spec)).not.toMatch(/"(?:on|watch|action)":/);
    const snapshot = owner.rawSnapshot;
    owner.dispose();
    expect(owner.rawSnapshot).toBe(snapshot);
  });
  it('preserves prose at a complete line boundary', () =>
    expect(prepareSurface('Explanation\n' + wire[0], 'booking').prose).toBe(
      'Explanation\n'
    ));
  it.each([
    ['inline delimiter', () => 'Explanation ' + wire[0]],
    ['duplicate delimiter', () => wire[0] + wire[0]],
    ['missing final newline', () => wire[0].slice(0, -1)],
    ['trailing prose', () => wire[0] + 'done\n'],
    ['malformed middle', () => wire[0] + '{bad}\n'],
    ['missing version', () => change((m) => delete m[0].version)],
    ['wrong version', () => change((m) => (m[0].version = 'v1'))],
    [
      'two commands',
      () => change((m) => (m[0].deleteSurface = { surfaceId: 'booking' })),
    ],
    [
      'unknown command',
      () => change((m) => m.push({ version: 'v0.9', future: {} })),
    ],
    [
      'foreign surface',
      () => change((m) => (m[1].updateComponents.surfaceId = 'results')),
    ],
    [
      'unsupported catalog',
      () => change((m) => (m[0].createSurface.catalogId = 'other')),
    ],
    ['theme', () => change((m) => (m[0].createSurface.theme = {}))],
    ['unknown component', () => component((c) => (c.component = 'Image'))],
    ['unknown prop', () => component((c) => (c.weight = 1))],
    [
      'nonempty checks',
      () => component((c) => (c.checks = [{ condition: true, message: 'x' }])),
    ],
    [
      'function label',
      () => component((c) => (c.label = { call: 'formatString' })),
    ],
    ['picker scalar', () => component((c) => (c.value = 'LAX'))],
    [
      'picker unknown path',
      () => component((c) => (c.value = { path: '/other' })),
    ],
    ['duplicate option', () => component((c) => c.options.push(c.options[0]))],
    ['unknown option', () => component((c) => (c.options[0].value = 'XXX'))],
    [
      'multiple selection',
      () => component((c) => (c.variant = 'multipleSelection')),
    ],
    ['filterable', () => component((c) => (c.filterable = false))],
    ['display style', () => component((c) => (c.displayStyle = 'chips'))],
    ['date min', () => component((c) => (c.min = '2020-01-01'), 'date')],
    ['time enabled', () => component((c) => (c.enableTime = true), 'date')],
    [
      'missing date enabled',
      () => component((c) => delete c.enableDate, 'date'),
    ],
    [
      'regex',
      () => component((c) => (c.validationRegexp = '.*'), 'passengers'),
    ],
    [
      'text array coercion',
      () => component((c) => (c.text = { path: '/origin' }), 'title'),
    ],
    ['layout prop', () => component((c) => (c.justify = 'start'), 'root')],
    [
      'template',
      () =>
        component(
          (c) => (c.children = { path: '/origin', componentId: 'title' }),
          'root'
        ),
    ],
    [
      'missing child',
      () => component((c) => (c.children = ['missing']), 'root'),
    ],
    ['cycle', () => component((c) => (c.children = ['root']), 'root')],
    [
      'unreachable node',
      () =>
        component((c, all) =>
          all.push({ id: 'orphan', component: 'Text', text: 'x' })
        ),
    ],
    ['duplicate id', () => component((c, all) => all.push({ ...c }))],
    ['empty id', () => component((c) => (c.id = ''))],
    ['long id', () => component((c) => (c.id = 'x'.repeat(129)))],
    [
      'unknown event',
      () => component((c) => (c.action.event.name = 'purchase'), 'submit'),
    ],
    [
      'wrong action path',
      () =>
        component(
          (c) => (c.action.event.context.origin = { path: '/dest' }),
          'submit'
        ),
    ],
    [
      'local action',
      () =>
        component(
          (c) => (c.action = { functionCall: { call: 'openUrl' } }),
          'submit'
        ),
    ],
    [
      'extra context',
      () => component((c) => (c.action.event.context.unknown = 'x'), 'submit'),
    ],
    ['unexpected identity', () => wire[1]],
    [
      'nonfinite model',
      // eslint-disable-next-line no-loss-of-precision -- Intentional nonfinite-number negative fixture.
      () => change((m) => (m[2].updateDataModel.value.passengers = 1e309)),
    ],
  ] as const)('rejects %s without a partial owner', (_name, make) =>
    expect(() => prepareSurface(make(), 'booking')).toThrow()
  );
  it('accepts blank lines without completing truncated data', () =>
    expect(prepareSurface(wire[0] + ' \t\n', 'booking').surfaceId).toBe(
      'booking'
    ));
  it('pins admitted optional defaults and orientation as plain data', () => {
    const text = component((c, all) => {
      delete c.variant;
      c.catalogId =
        'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';
      c.checks = [];
      const date = all.find((x) => x.id === 'date');
      date.enableTime = false;
      all.find((x) => x.id === 'root').children.push('divider');
      all.push({ id: 'divider', component: 'Divider', axis: 'vertical' });
    });
    const p = prepareSurface(text, 'booking');
    expect(p.spec.elements.divider.props.axis).toBe('vertical');
    expect(p.spec.elements.origin.props.variant).toBe('mutuallyExclusive');
  });
  it('rejects payload byte overflow, component count overflow and deep trees', () => {
    expect(() =>
      prepareSurface(wire[0] + ' '.repeat(1048576) + '\n', 'booking')
    ).toThrow();
    for (const count of [513, 66])
      expect(() =>
        prepareSurface(
          change((m) => {
            const a = [];
            for (let i = 0; i < count; i++)
              a.push({
                id: i ? 'n' + i : 'root',
                component: 'Column',
                children: i === count - 1 ? [] : ['n' + (i + 1)],
              });
            m[1].updateComponents.components = a;
          }),
          'booking'
        )
      ).toThrow();
  });
  it('supports safe opaque prototype-like component IDs without inheriting maps', () => {
    const p = prepareSurface(
      component((c, all) => {
        const root = all.find((x) => x.id === 'root');
        root.children.push('toString');
        all.push({ id: 'toString', component: 'Text', text: 'safe' });
      }),
      'booking'
    );
    expect(p.spec.elements['toString'].type).toBe('Text');
    expect(p.token('absent')).toBeUndefined();
  });
  it('uses distinct application epochs for same-ID recreation and retires component contracts', () => {
    const a = prepareSurface(wire[0], 'booking'),
      b = prepareSurface(wire[0], 'booking');
    const token = a.token('submit');
    expect(a.current('submit', token)).toBe(true);
    expect(b.current('submit', token)).toBe(false);
    a.retireComponent('submit');
    expect(a.current('submit', token)).toBe(false);
    expect(a.current('origin', a.token('origin'))).toBe(true);
    b.dispose();
    expect(b.current('submit', b.token('submit'))).toBe(false);
  });
  it('pins blank and fallback booking defaults from _BLANK_FORM_DEFAULTS/_build_sentinel_booking_form', () => {
    const defaults = {
      origin: [],
      dest: [],
      date: '',
      passengers: 1,
      fare_class: ['Economy'],
    };
    const text = change((m) => {
      m[2].updateDataModel.value = defaults;
      m[1].updateComponents.components.find((c: any) => c.id === 'title').text =
        'Book a flight (fallback)';
    });
    const p = prepareSurface(text, 'booking');
    expect(p.model).toEqual(defaults);
    expect(p.spec.elements.title.props.text).toBe('Book a flight (fallback)');
    expect(p.spec.elements.date.props.enableDate).toBe(true);
  });
  it('pins production _SENTINEL_RESULTS default Button shape', () => {
    const components = [
      { id: 'root', component: 'Column', children: ['msg'] },
      { id: 'msg', component: 'Card', child: 'msg_col' },
      { id: 'msg_col', component: 'Column', children: ['msg_text', 'modify'] },
      {
        id: 'msg_text',
        component: 'Text',
        text: 'Results unavailable',
        variant: 'h3',
      },
      {
        id: 'modify',
        component: 'Button',
        child: 'modify_label',
        action: {
          event: { name: 'modifySearch', context: { formId: 'booking' } },
        },
      },
      { id: 'modify_label', component: 'Text', text: 'Modify search' },
    ];
    const messages = parse(wire[1]);
    messages[1].updateComponents.components = components;
    const p = prepareSurface(wrap(messages), 'results');
    expect(p.spec.elements.modify.props.variant).toBe('default');
    expect(p.model).toEqual({});
  });
  it('admits the source-backed empty-results Card/Column/Modify tree', () => {
    const components = [
      { id: 'root', component: 'Column', children: ['no_flights'] },
      { id: 'no_flights', component: 'Card', child: 'empty_col' },
      {
        id: 'empty_col',
        component: 'Column',
        children: ['empty_msg', 'modify_btn'],
      },
      {
        id: 'empty_msg',
        component: 'Text',
        text: 'No flights found',
        variant: 'h3',
      },
      {
        id: 'modify_btn',
        component: 'Button',
        child: 'modify_label',
        action: {
          event: { name: 'modifySearch', context: { formId: 'booking' } },
        },
      },
      { id: 'modify_label', component: 'Text', text: 'Modify search' },
    ];
    const messages = parse(wire[1]);
    messages[1].updateComponents.components = components;
    expect(
      prepareSurface(wrap(messages), 'results').spec.elements.modify_btn.props
        .variant
    ).toBe('default');
  });
  it.each(['Column', 'Row', 'List'])(
    'projects static %s with the approved default direction',
    (kind) => {
      const p = prepareSurface(
        component((c) => (c.component = kind), 'card_col'),
        'booking'
      );
      expect(p.spec.elements.card_col.props.direction).toBe(
        kind === 'Row' ? 'horizontal' : 'vertical'
      );
    }
  );
  it.each(['h1', 'h2', 'h3', 'h4', 'h5', 'body', 'caption'])(
    'admits only explicit Text variant %s',
    (value) =>
      expect(
        prepareSurface(
          component((c) => (c.variant = value), 'title'),
          'booking'
        ).spec.elements.title.props.variant
      ).toBe(value)
  );
  it.each(['default', 'primary', 'borderless'])(
    'admits Button variant %s',
    (value) =>
      expect(
        prepareSurface(
          component((c) => (c.variant = value), 'submit'),
          'booking'
        ).spec.elements.submit.props.variant
      ).toBe(value)
  );
  it.each(['horizontal', 'vertical', undefined])(
    'preserves Divider orientation %s',
    (axis) => {
      const p = prepareSurface(
        component((c, all) => {
          all.find((x) => x.id === 'root').children.push('divider');
          all.push({
            id: 'divider',
            component: 'Divider',
            ...(axis ? { axis } : {}),
          });
        }),
        'booking'
      );
      expect(p.spec.elements.divider.props.axis).toBe(axis ?? 'horizontal');
    }
  );
  it('resolves Text only through a present string absolute path and prepares a data binding', () => {
    const p = prepareSurface(
      component((c) => (c.text = { path: '/date' }), 'title'),
      'booking'
    );
    expect(p.spec.elements.title.props.text).toEqual({ $bindState: '/date' });
    expect(() =>
      prepareSurface(
        component((c) => (c.text = { path: '/missing' }), 'title'),
        'booking'
      )
    ).toThrow();
  });
  it('admits maximum component count and rejects overflow independently of depth', () => {
    for (const count of [512, 513]) {
      const text = change((m) => {
        m[1].updateComponents.components = [
          {
            id: 'root',
            component: 'Column',
            children: Array.from({ length: count - 1 }, (_, i) => 'n' + i),
          },
          ...Array.from({ length: count - 1 }, (_, i) => ({
            id: 'n' + i,
            component: 'Text',
            text: 'value',
          })),
        ];
      });
      if (count === 512)
        expect(
          Object.keys(prepareSurface(text, 'booking').spec.elements)
        ).toHaveLength(512);
      else expect(() => prepareSurface(text, 'booking')).toThrow();
    }
  });
  it('retains confirmed rows through late projection capture overflow below the wire cap', () => {
    const previous = prepareSurface(wire[0], 'booking'),
      rows = [previous];
    const snapshot = previous.rawSnapshot;
    const oversized = component((c) => (c.text = 'a'.repeat(400000)), 'title');
    expect(new TextEncoder().encode(oversized).length).toBeLessThan(1048576);
    expect(() => {
      const next = prepareSurface(oversized, 'booking');
      rows.push(next);
    }).toThrow();
    expect(rows).toEqual([previous]);
    expect(previous.rawSnapshot).toBe(snapshot);
    expect(previous.current('submit', previous.token('submit'))).toBe(true);
  });
  it.each([
    ['Column', 'align'],
    ['Row', 'justify'],
    ['List', 'direction'],
    ['Card', 'weight'],
    ['Text', 'accessibility'],
    ['Divider', 'weight'],
    ['Button', 'text'],
    ['ChoicePicker', 'displayStyle'],
    ['DateTimeInput', 'max'],
    ['TextField', 'validationRegexp'],
  ] as const)('rejects unapproved %s prop %s', (kind, key) => {
    const identity = {
      Column: 'card_col',
      Row: 'card_col',
      List: 'card_col',
      Card: 'card',
      Text: 'title',
      Divider: 'title',
      Button: 'submit',
      ChoicePicker: 'origin',
      DateTimeInput: 'date',
      TextField: 'passengers',
    }[kind];
    expect(() =>
      prepareSurface(
        component((c) => {
          c.component = kind;
          c[key] = 'unsupported';
        }, identity),
        'booking'
      )
    ).toThrow();
  });
});
