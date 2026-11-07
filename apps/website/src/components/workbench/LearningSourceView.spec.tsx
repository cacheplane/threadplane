import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LearningSourceView } from './LearningSourceView';
import type { LearningSource } from './learning-lesson';

afterEach(cleanup);
const source: LearningSource = {
  revision: 'b'.repeat(40),
  files: [
    {
      path: 'cockpit/app.tsx',
      source: 'const first = 1;\nconst snapshot = useAgent(application);',
      highlights: [{ start: 2, end: 2 }],
    },
    {
      path: 'cockpit/connection.ts',
      source: 'const value = "<script>";',
      highlights: [],
    },
  ],
  snippet: {
    path: 'cockpit/app.tsx',
    start: 2,
    end: 2,
    code: 'const snapshot = useAgent(application);',
  },
};

it('shows real source with accessible highlights and exact revision links', () => {
  const view = render(
    <LearningSourceView
      source={source}
      filesWidth={190}
      onFilesWidth={vi.fn()}
    />
  );
  expect(screen.getByLabelText('Lesson source code').textContent).toContain(
    source.snippet.code
  );
  expect(screen.getByLabelText('Highlighted lesson line 2')).toBeTruthy();
  expect(
    screen
      .getByRole('link', { name: 'View file on GitHub' })
      .getAttribute('href')
  ).toContain(`/blob/${source.revision}/cockpit/app.tsx#L2-L2`);
  fireEvent.click(screen.getByRole('button', { name: 'connection.ts' }));
  expect(screen.getByLabelText('Lesson source code').textContent).toContain(
    '<script>'
  );
  expect(
    screen.getByLabelText('Lesson source code').querySelector('script')
  ).toBeNull();
  expect(
    screen
      .getByRole('link', { name: 'View file on GitHub' })
      .getAttribute('href')
  ).toContain('/cockpit/connection.ts');
  expect(
    screen.getByRole('separator', { name: 'Resize source file list' })
  ).toBeTruthy();
  view.rerender(
    <LearningSourceView
      source={source}
      filesWidth={190}
      onFilesWidth={vi.fn()}
      focusRequest={1}
    />
  );
  expect(
    screen.getByRole('button', { name: 'app.tsx' }).getAttribute('aria-pressed')
  ).toBe('true');
});
