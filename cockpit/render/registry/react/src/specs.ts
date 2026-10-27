export const REGISTRY_SAMPLES: readonly {
  readonly label: string;
  readonly json: string;
}[] = [
  {
    label: 'Basic Types',
    json: JSON.stringify(
      {
        root: 'root',
        elements: {
          root: {
            type: 'Heading',
            props: { content: 'Basic Component Types' },
            children: ['desc', 'badge'],
          },
          desc: {
            type: 'Text',
            props: {
              content:
                'Each type string resolves to a registered React view at render time.',
            },
          },
          badge: {
            type: 'Badge',
            props: { label: 'Registered' },
          },
        },
      },
      null,
      2
    ),
  },
  {
    label: 'Card Layout',
    json: JSON.stringify(
      {
        root: 'root',
        elements: {
          root: {
            type: 'Card',
            props: { title: 'Card Layout Demo' },
            children: ['heading', 'body', 'tag'],
          },
          heading: {
            type: 'Heading',
            props: { content: 'Inside a Card' },
          },
          body: {
            type: 'Text',
            props: {
              content:
                'Cards display the children supplied by the native renderer.',
            },
          },
          tag: {
            type: 'Badge',
            props: { label: 'Nested' },
          },
        },
      },
      null,
      2
    ),
  },
  {
    label: 'Mixed Components',
    json: JSON.stringify(
      {
        root: 'root',
        elements: {
          root: {
            type: 'Heading',
            props: { content: 'All Registered Types' },
            children: ['card1', 'card2'],
          },
          card1: {
            type: 'Card',
            props: { title: 'First Section' },
            children: ['text1', 'badge1'],
          },
          text1: {
            type: 'Text',
            props: { content: 'Text inside the first card section.' },
          },
          badge1: {
            type: 'Badge',
            props: { label: 'Section 1' },
          },
          card2: {
            type: 'Card',
            props: { title: 'Second Section' },
            children: ['text2', 'badge2'],
          },
          text2: {
            type: 'Text',
            props: { content: 'Text inside the second card section.' },
          },
          badge2: {
            type: 'Badge',
            props: { label: 'Section 2' },
          },
        },
      },
      null,
      2
    ),
  },
];
