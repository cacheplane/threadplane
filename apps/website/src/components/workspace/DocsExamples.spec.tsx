import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { DocsExamples } from './DocsExamples';

afterEach(cleanup);
it('combines framework, library and name filters and recovers from an empty result', () => {
  render(
    <DocsExamples
      examples={[
        {
          href: '/angular',
          title: 'Angular streaming',
          description: 'Stream messages',
          framework: 'angular',
          library: 'chat',
          libraryLabel: 'Chat',
        },
        {
          href: '/react',
          title: 'React streaming',
          description: 'Stream messages',
          framework: 'react',
          library: 'chat',
          libraryLabel: 'Chat',
        },
        {
          href: '/tools',
          title: 'React tools',
          description: 'Run tools',
          framework: 'react',
          library: 'ag-ui',
          libraryLabel: 'AG-UI',
        },
      ]}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Framework' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'React' }));
  expect(screen.getByRole('status').textContent).toBe('2 examples');
  fireEvent.click(screen.getByRole('button', { name: 'Library' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Chat' }));
  expect(screen.getByRole('status').textContent).toBe('1 example');
  expect(screen.getByRole('link', { name: /React streaming/ })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Find an example'), {
    target: { value: 'missing' },
  });
  expect(
    screen.getByRole('heading', { name: 'No examples match.' })
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Show all examples' }));
  expect(screen.getByRole('status').textContent).toBe('3 examples');
  expect(
    screen.getByRole('button', { name: 'Framework' }).textContent
  ).toContain('All frameworks');
});
