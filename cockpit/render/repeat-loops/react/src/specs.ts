export const REPEAT_SAMPLES: readonly {
  readonly label: string;
  readonly json: string;
}[] = [
  {
    label: 'Simple List',
    json: JSON.stringify(
      {
        root: 'root',
        elements: {
          root: {
            type: 'Heading',
            props: { content: 'Simple List' },
            children: ['items'],
          },
          items: {
            type: 'Card',
            props: { title: 'Items' },
            repeat: { statePath: '/items', key: 'id' },
            children: ['row'],
          },
          row: {
            type: 'Text',
            props: {
              content: { $item: 'label' },
              itemId: { $item: 'id' },
              index: { $index: true },
            },
          },
        },
      },
      null,
      2
    ),
  },
  {
    label: 'Task List',
    json: JSON.stringify(
      {
        root: 'root',
        elements: {
          root: {
            type: 'Card',
            props: { title: 'Task List' },
            children: ['task1', 'task2', 'task3'],
          },
          task1: {
            type: 'Text',
            props: { content: 'Review pull request' },
          },
          task2: {
            type: 'Text',
            props: { content: 'Update documentation' },
          },
          task3: {
            type: 'Text',
            props: { content: 'Deploy to staging' },
          },
        },
      },
      null,
      2
    ),
  },
  {
    label: 'Sections',
    json: JSON.stringify(
      {
        root: 'root',
        elements: {
          root: {
            type: 'Heading',
            props: { content: 'Multiple Sections' },
            children: ['sectionA', 'sectionB'],
          },
          sectionA: {
            type: 'Card',
            props: { title: 'Frontend Tasks' },
            children: ['feTask1', 'feTask2'],
          },
          feTask1: {
            type: 'Text',
            props: { content: 'Build component library' },
          },
          feTask2: {
            type: 'Text',
            props: { content: 'Add accessibility tests' },
          },
          sectionB: {
            type: 'Card',
            props: { title: 'Backend Tasks' },
            children: ['beTask1', 'beTask2'],
          },
          beTask1: {
            type: 'Text',
            props: { content: 'Optimize database queries' },
          },
          beTask2: {
            type: 'Text',
            props: { content: 'Add rate limiting' },
          },
        },
      },
      null,
      2
    ),
  },
];
