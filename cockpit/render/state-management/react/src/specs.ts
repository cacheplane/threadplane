export const STATE_SAMPLES: readonly {
  readonly label: string;
  readonly json: string;
}[] = [
  {
    label: 'User Profile',
    json: JSON.stringify(
      {
        root: 'root',
        elements: {
          root: {
            type: 'Heading',
            props: { content: 'User Profile' },
            children: ['name', 'age'],
          },
          name: {
            type: 'Text',
            props: { content: { $state: '/user/name' } },
          },
          age: {
            type: 'Text',
            props: { content: { $state: '/user/age' } },
          },
        },
      },
      null,
      2
    ),
  },
  {
    label: 'Nested Paths',
    json: JSON.stringify(
      {
        root: 'root',
        elements: {
          root: {
            type: 'Heading',
            props: { content: 'Nested State Paths' },
            children: ['userName', 'userAge', 'theme'],
          },
          userName: {
            type: 'Label',
            props: { label: 'Name', value: { $state: '/user/name' } },
          },
          userAge: {
            type: 'Label',
            props: { label: 'Age', value: { $state: '/user/age' } },
          },
          theme: {
            type: 'Label',
            props: { label: 'Theme', value: { $state: '/settings/theme' } },
          },
        },
      },
      null,
      2
    ),
  },
  {
    label: 'Form Display',
    json: JSON.stringify(
      {
        root: 'root',
        elements: {
          root: {
            type: 'Card',
            props: { title: 'State-Driven Form' },
            children: ['nameField', 'themeField'],
          },
          nameField: {
            type: 'Label',
            props: { label: 'User', value: { $state: '/user/name' } },
          },
          themeField: {
            type: 'Label',
            props: {
              label: 'Preference',
              value: { $state: '/settings/theme' },
            },
          },
        },
      },
      null,
      2
    ),
  },
];
