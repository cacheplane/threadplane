import { cleanup, render } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { StateDiff } from './index';
afterEach(cleanup);
it('renders a semantic labelled literal JSON section with root and array guidance', () => {
  const v = render(
    <StateDiff
      before={null}
      after="<img src=x onerror=alert(1)>"
      label="Observed change"
      className="custom"
    />
  );
  const section = v.getByRole('region', { name: 'Observed change' });
  expect(section.classList.contains('custom')).toBe(true);
  expect(JSON.parse(String(section.querySelector('pre')?.textContent))).toEqual(
    [
      {
        kind: 'changed',
        path: '',
        before: null,
        after: '<img src=x onerror=alert(1)>',
      },
    ]
  );
  expect(section.querySelector('img')).toBeNull();
  expect(section.textContent).toContain('JSON Pointer');
  expect(section.textContent).toContain('whole arrays');
  expect(section.textContent).toContain('empty string');
  expect(section.querySelector('button')).toBeNull();
});
it('uses exact no-change wording only for complete equal states and distinct refusal notices', () => {
  const v = render(<StateDiff before={{ a: 1 }} after={{ a: 1 }} />);
  expect(v.getByRole('region', { name: 'State changes' })).toBeTruthy();
  expect(v.getByText('No changes in the supplied states.')).toBeTruthy();
  const notices: string[] = [];
  const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [i, 1]));
  for (const [before, after] of [
    [NaN, NaN],
    ['x'.repeat(2001), 'x'.repeat(2001)],
    [many, {}],
  ] as const) {
    v.rerender(<StateDiff before={before} after={after} />);
    expect(v.queryByText('No changes in the supplied states.')).toBeNull();
    expect(v.container.querySelector('pre')).toBeNull();
    notices.push(v.getByRole('status').textContent ?? '');
  }
  expect(new Set(notices).size).toBe(3);
});
it('supports server rendering without browser work or effects', () => {
  const storage = vi.spyOn(Storage.prototype, 'getItem');
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  const markup = renderToString(
    <StateDiff before={{ count: 1 }} after={{ count: 2 }} />
  );
  expect(markup).toContain('State changes');
  expect(markup).toContain('&quot;changed&quot;');
  expect(storage).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});
