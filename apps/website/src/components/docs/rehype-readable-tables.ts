/**
 * rehypeReadableTables — annotates every markdown table so `docs.css` can lay
 * it out by content instead of leaving column widths to the browser.
 *
 * Unannotated, a table full of short "Yes" cells beside one long prose column
 * let auto layout starve the short columns, and the prose's inherited
 * `word-break` split "Yes" into "Ye/s" (tables audit, 2026-10). The plugin
 * runs at compile time, so the layout ships in the prerendered HTML with no
 * client script and no shift.
 *
 * Per table it adds:
 * - `data-label` on every body cell: its column header, which the phone card
 *   layout prints beside the value.
 * - a column kind class on every cell (`tp-col-key`, `tp-col-status`,
 *   `tp-col-short`, `tp-col-prose`) and, on status cells, `data-status`.
 * - `data-shape` on the table: `compact` (two columns), `matrix` (two or more
 *   status columns), `reference` (an API table with a Type column), or
 *   `stack`; and `data-prose-cols`, the number of prose columns.
 * - explicit ARIA table roles, because the phone layout sets `display: block`
 *   and some browsers drop table semantics when it does.
 */

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

export type ColumnKind = 'key' | 'status' | 'short' | 'prose';
export type TableShape = 'compact' | 'matrix' | 'reference' | 'stack';
export type StatusValue = 'yes' | 'partial' | 'no' | 'none';

const STATUS_WORDS: Record<string, StatusValue> = {
  yes: 'yes',
  supported: 'yes',
  partial: 'partial',
  no: 'no',
  'not supported': 'no',
  unsupported: 'no',
  '—': 'none',
  '–': 'none',
  '-': 'none',
  'n/a': 'none',
};

/** Longest cell, in characters, that still counts as a short column. */
const SHORT_MAX_CHARS = 14;
/** The same limit for a cell that is a single inline code span. */
const SHORT_CODE_MAX_CHARS = 24;
/** Longest single-token code span kept on one line (see `tp-token`). */
const TOKEN_MAX_CHARS = 40;

function isElement(node: HastNode, tagName?: string): boolean {
  return node.type === 'element' && (tagName === undefined || node.tagName === tagName);
}

function elementChildren(node: HastNode, ...tagNames: string[]): HastNode[] {
  return (node.children ?? []).filter(
    (child) => isElement(child) && tagNames.includes(child.tagName as string)
  );
}

export function textOf(node: HastNode): string {
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(textOf).join('');
}

/**
 * A status word may carry a footnote mark or a short parenthetical
 * qualifier — "No*", "Supported (streaming)" — and still read as a status.
 */
const STATUS_QUALIFIER = /\s*(\*+|\([^)]{1,24}\))$/;

export function statusOf(text: string): StatusValue | undefined {
  const word = text.trim().toLowerCase().replace(STATUS_QUALIFIER, '');
  return STATUS_WORDS[word];
}

function addClass(node: HastNode, className: string): void {
  node.properties ??= {};
  const existing = node.properties['className'];
  const list = Array.isArray(existing)
    ? (existing as string[])
    : typeof existing === 'string'
      ? existing.split(/\s+/).filter(Boolean)
      : [];
  if (!list.includes(className)) list.push(className);
  node.properties['className'] = list;
}

/**
 * The first column is the row's name, whatever it holds. Any other column is
 * `status` when every cell is a status word (and at least one is not a dash),
 * `short` when every cell fits SHORT_MAX_CHARS, and `prose` otherwise.
 */
export interface ColumnCell {
  text: string;
  /** The cell holds one inline code span and nothing else. */
  codeOnly?: boolean;
}

export function classifyColumn(index: number, column: Array<string | ColumnCell>): ColumnKind {
  if (index === 0) return 'key';
  const cells = column.map((cell) => (typeof cell === 'string' ? { text: cell } : cell));
  const filled = cells.map((cell) => cell.text.trim());
  if (
    filled.length > 0 &&
    filled.every((cell) => statusOf(cell) !== undefined) &&
    filled.some((cell) => statusOf(cell) !== 'none')
  ) {
    return 'status';
  }
  if (
    cells.every(
      (cell) =>
        cell.text.trim().length <= (cell.codeOnly ? SHORT_CODE_MAX_CHARS : SHORT_MAX_CHARS)
    )
  ) {
    return 'short';
  }
  return 'prose';
}

/**
 * `reference` is an API-shaped table — a name, a trailing description, and
 * either a `Type` column or (four columns or more) only short values between. A long name, a long type and a sentence cannot share a 70ch
 * row, so it renders as entries (name and type on one line, the description
 * beneath) at every width.
 */
export function shapeOf(kinds: ColumnKind[], labels: string[] = []): TableShape {
  if (kinds.filter((kind) => kind === 'status').length >= 2) return 'matrix';
  if (kinds.length <= 2) return 'compact';
  const middle = kinds.slice(1, -1);
  if (
    kinds[kinds.length - 1] === 'prose' &&
    (labels.some((label) => label.toLowerCase() === 'type') ||
      (kinds.length >= 4 && middle.every((kind) => kind === 'short' || kind === 'status')))
  ) {
    return 'reference';
  }
  return 'stack';
}

function isCodeOnly(cell: HastNode): boolean {
  const content = (cell.children ?? []).filter(
    (child) => !(child.type === 'text' && !(child.value ?? '').trim())
  );
  return content.length === 1 && isElement(content[0], 'code');
}

/**
 * A code span with no whitespace is one identifier — `--tplane-chat-bg`,
 * `@threadplane/chat`. Breaking it at a hyphen or slash misreads as two
 * tokens, so a short one is kept whole; a longer one may still break.
 */
function markTokens(node: HastNode): void {
  for (const child of node.children ?? []) {
    if (isElement(child, 'code')) {
      const text = textOf(child);
      if (!/\s/.test(text) && text.length <= TOKEN_MAX_CHARS) addClass(child, 'tp-token');
    } else {
      markTokens(child);
    }
  }
}

function annotateTable(table: HastNode): void {
  const sections = elementChildren(table, 'thead', 'tbody');
  const headRows = sections
    .filter((section) => section.tagName === 'thead')
    .flatMap((section) => elementChildren(section, 'tr'));
  const bodyRows = sections
    .filter((section) => section.tagName === 'tbody')
    .flatMap((section) => elementChildren(section, 'tr'));
  const headerCells = headRows[0] ? elementChildren(headRows[0], 'th', 'td') : [];
  const labels = headerCells.map((cell) => textOf(cell).trim());

  const bodyCells = bodyRows.map((row) => elementChildren(row, 'td', 'th'));
  const columnCount = Math.max(labels.length, ...bodyCells.map((row) => row.length));
  const kinds = Array.from({ length: columnCount }, (_, index) =>
    classifyColumn(
      index,
      bodyCells.map((row) =>
        row[index] ? { text: textOf(row[index]), codeOnly: isCodeOnly(row[index]) } : { text: '' }
      )
    )
  );

  table.properties ??= {};
  table.properties['role'] = 'table';
  table.properties['dataShape'] = shapeOf(kinds, labels);
  table.properties['dataCols'] = String(columnCount);
  table.properties['dataProseCols'] = String(kinds.filter((kind) => kind === 'prose').length);
  addClass(table, 'tp-table');
  for (const section of sections) {
    section.properties ??= {};
    section.properties['role'] = 'rowgroup';
  }

  headerCells.forEach((cell, index) => {
    cell.properties ??= {};
    cell.properties['role'] = 'columnheader';
    addClass(cell, `tp-col-${kinds[index]}`);
  });
  for (const row of [...headRows, ...bodyRows]) {
    row.properties ??= {};
    row.properties['role'] = 'row';
  }
  bodyCells.forEach((row) =>
    row.forEach((cell, index) => {
      cell.properties ??= {};
      cell.properties['role'] = cell.tagName === 'th' ? 'rowheader' : 'cell';
      addClass(cell, `tp-col-${kinds[index]}`);
      markTokens(cell);
      if (labels[index]) cell.properties['dataLabel'] = labels[index];
      if (kinds[index] === 'status') {
        cell.properties['dataStatus'] = statusOf(textOf(cell));
      }
    })
  );
}

function visit(node: HastNode): void {
  if (isElement(node, 'table')) {
    annotateTable(node);
    return;
  }
  for (const child of node.children ?? []) visit(child);
}

export function rehypeReadableTables() {
  return (tree: HastNode) => {
    visit(tree);
  };
}
