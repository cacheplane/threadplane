export const ELEMENT_RENDERING_SAMPLES: readonly {
  readonly label: string;
  readonly json: string;
}[] = [
  {
    label: 'Parent + Children',
    json: JSON.stringify(
      {
        root: 'root',
        elements: {
          root: {
            type: 'Heading',
            props: { content: 'Parent Heading' },
            children: ['child1', 'child2'],
          },
          child1: {
            type: 'Text',
            props: {
              content:
                'First child text element rendered beneath the parent heading.',
            },
          },
          child2: {
            type: 'Text',
            props: {
              content:
                'Second child text element demonstrating sibling rendering.',
            },
          },
        },
      },
      null,
      2
    ),
  },
  {
    label: 'Deep Nesting',
    json: JSON.stringify(
      {
        root: 'root',
        elements: {
          root: {
            type: 'Card',
            props: { title: 'Outer Card' },
            children: ['inner'],
          },
          inner: {
            type: 'Card',
            props: { title: 'Inner Card' },
            children: ['leaf'],
          },
          leaf: {
            type: 'Text',
            props: {
              content: 'Deeply nested text inside two levels of card wrappers.',
            },
          },
        },
      },
      null,
      2
    ),
  },
  {
    label: 'Visibility',
    json: JSON.stringify(
      {
        root: 'root',
        elements: {
          root: {
            type: 'Heading',
            props: { content: 'Visibility Demo' },
            children: ['always', 'conditional'],
          },
          always: {
            type: 'Text',
            props: { content: 'This element is always visible.' },
          },
          conditional: {
            type: 'Text',
            props: {
              content:
                'This element is conditionally visible based on /showDetail.',
            },
            visible: { $state: '/showDetail' },
          },
        },
      },
      null,
      2
    ),
  },
];
