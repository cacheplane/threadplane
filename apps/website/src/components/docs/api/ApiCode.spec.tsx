import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ApiCode } from './ApiCode';

afterEach(cleanup);

it('preserves exact excerpt text while splitting highlighted type links across tokens', async () => {
  const code = await ApiCode({
    tokens: [
      { kind: 'Content', text: 'export type Result = ' },
      { kind: 'Reference', text: 'Message', href: '/docs/api/core/Message' },
      { kind: 'Content', text: ' | undefined;\n' },
    ],
  });
  const { container } = render(code);
  expect(container.querySelector('code')?.textContent).toBe(
    'export type Result = Message | undefined;\n'
  );
  expect(
    screen.getByRole('link', { name: 'Message' }).getAttribute('href')
  ).toBe('/docs/api/core/Message');
  expect(container.querySelector('span[style]')).toBeTruthy();
});
