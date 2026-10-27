import { describe, expect, it } from 'vitest';
import { compileMDX } from 'next-mdx-remote/rsc';
import { renderToStaticMarkup } from 'react-dom/server';
import { mdxCompileOptions } from './mdx-options';
import { MdxRenderer } from './MdxRenderer';
import { classifyColumn, shapeOf, statusOf } from './rehype-readable-tables';

type MdxComponents = NonNullable<Parameters<typeof compileMDX>[0]['components']>;

/** The component map MdxRenderer hands to MDXRemote. */
function rendererComponents(): MdxComponents {
  const outer = MdxRenderer({ source: '' }) as { props: { children: { props: { components: MdxComponents } } } };
  return outer.props.children.props.components;
}

async function render(source: string): Promise<Document> {
  const { content } = await compileMDX({
    source,
    options: mdxCompileOptions,
    components: rendererComponents(),
  });
  return new DOMParser().parseFromString(renderToStaticMarkup(content), 'text/html');
}

describe('classifyColumn', () => {
  it('always treats the first column as the row key', () => {
    expect(classifyColumn(0, ['Yes', 'No'])).toBe('key');
  });

  it('marks a column of status words as status, ignoring case and dashes', () => {
    expect(classifyColumn(1, ['Yes', 'partial', '—', 'No'])).toBe('status');
  });

  it('does not call an all-dash column status', () => {
    expect(classifyColumn(1, ['—', '—'])).toBe('short');
  });

  it('separates short values from prose', () => {
    expect(classifyColumn(2, ['string', 'boolean'])).toBe('short');
    expect(classifyColumn(2, ['string', 'The URL of the deployment'])).toBe('prose');
  });

  it('allows a code-only column a longer short limit', () => {
    const code = (text: string) => ({ text, codeOnly: true });
    expect(classifyColumn(1, [code('rgb(255, 255, 255)'), code('rgb(17, 17, 17)')])).toBe('short');
    expect(classifyColumn(1, [{ text: 'rgb(255, 255, 255)' }])).toBe('prose');
  });
});

describe('shapeOf', () => {
  it('needs two status columns to be a matrix', () => {
    expect(shapeOf(['key', 'status', 'status', 'prose'])).toBe('matrix');
    expect(shapeOf(['key', 'status', 'prose'])).toBe('stack');
    expect(shapeOf(['key', 'prose'])).toBe('compact');
  });

  it('treats a table with a Type column and a trailing description as a reference', () => {
    expect(shapeOf(['key', 'prose', 'short', 'prose'], ['Input', 'Type', 'Default', 'Description'])).toBe('reference');
    expect(shapeOf(['key', 'short', 'short'], ['Field', 'Type', 'Default'])).toBe('stack');
    expect(shapeOf(['key', 'short', 'short', 'prose'], ['Token', 'Light', 'Dark', 'Purpose'])).toBe('reference');
    expect(shapeOf(['key', 'prose', 'prose', 'prose'], ['Capability', 'A', 'B', 'Cause'])).toBe('stack');
    expect(shapeOf(['key', 'status', 'prose'], ['Surface', 'Status', 'How'])).toBe('stack');
  });
});

describe('statusOf', () => {
  it('maps the status vocabulary', () => {
    expect(statusOf(' Yes ')).toBe('yes');
    expect(statusOf('Partial')).toBe('partial');
    expect(statusOf('n/a')).toBe('none');
    expect(statusOf('Supported (streaming)')).toBe('yes');
    expect(statusOf('Not supported')).toBe('no');
    expect(statusOf('No*')).toBe('no');
    expect(statusOf('Maybe')).toBeUndefined();
    expect(statusOf('Yes, via `clientOptions`')).toBeUndefined();
  });
});

describe('rehypeReadableTables through the real MDX pipeline', () => {
  const matrix = [
    '| Runtime | Messages | State | Notes |',
    '|---|---|---|---|',
    '| **Mastra** (TypeScript) | Yes | Partial | Snapshot only |',
    '| `strands` | Yes | — | See note 1 |',
  ].join('\n');

  it('labels every body cell with its column header', async () => {
    const doc = await render(matrix);
    const labels = [...doc.querySelectorAll('tbody tr:first-child td')].map((td) =>
      td.getAttribute('data-label')
    );
    expect(labels).toEqual(['Runtime', 'Messages', 'State', 'Notes']);
  });

  it('classifies columns and the table shape', async () => {
    const doc = await render(matrix);
    const table = doc.querySelector('table');
    expect(table?.getAttribute('data-shape')).toBe('matrix');
    expect(table?.classList.contains('tp-table')).toBe(true);
    const kinds = [...doc.querySelectorAll('thead th')].map((th) =>
      [...th.classList].find((c) => c.startsWith('tp-col-'))
    );
    expect(kinds).toEqual(['tp-col-key', 'tp-col-status', 'tp-col-status', 'tp-col-short']);
  });

  it('records each status cell value, including dashes', async () => {
    const doc = await render(matrix);
    const states = [...doc.querySelectorAll('td[data-status]')].map((td) =>
      td.getAttribute('data-status')
    );
    expect(states).toEqual(['yes', 'partial', 'yes', 'none']);
  });

  it('restores table roles so the phone card layout keeps its semantics', async () => {
    const doc = await render(matrix);
    expect(doc.querySelector('table')?.getAttribute('role')).toBe('table');
    expect(doc.querySelector('tbody')?.getAttribute('role')).toBe('rowgroup');
    expect(doc.querySelector('tr')?.getAttribute('role')).toBe('row');
    expect(doc.querySelector('th')?.getAttribute('role')).toBe('columnheader');
    expect(doc.querySelector('td')?.getAttribute('role')).toBe('cell');
  });

  it('keeps single-token code spans whole, but not code with spaces', async () => {
    const doc = await render(
      '| Token | Value |\n|---|---|\n| `--tplane-chat-surface-alt` | `rgb(1, 2, 3)` |'
    );
    const [token, value] = [...doc.querySelectorAll('td code')];
    expect(token.classList.contains('tp-token')).toBe(true);
    expect(value.classList.contains('tp-token')).toBe(false);
  });

  it('wraps a scrollable table in a focusable region, but not a reference table', async () => {
    const stack = await render('| A | B | C |\n|---|---|---|\n| a | the long text here | c |');
    expect(stack.querySelector('.docs-table-scroll')?.getAttribute('role')).toBe('region');
    const reference = await render(
      '| Field | Type | Description |\n|---|---|---|\n| `a` | `string` | The value this field holds. |'
    );
    expect(reference.querySelector('table')?.getAttribute('data-shape')).toBe('reference');
    const wrapper = reference.querySelector('.docs-table-scroll');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.hasAttribute('role')).toBe(false);
    expect(wrapper?.hasAttribute('tabindex')).toBe(false);
  });

  it('keeps a two-column table compact', async () => {
    const doc = await render('| Key | Value |\n|---|---|\n| a | b |');
    expect(doc.querySelector('table')?.getAttribute('data-shape')).toBe('compact');
  });
});
