import type { A2uiSurfaceSnapshot, A2uiValue } from './types.js';

export const record = (
  value: A2uiValue | undefined
): value is { readonly [key: string]: A2uiValue } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A path as written inside a template item, as a path from the root. A path
 * with a leading slash already is one; an empty path or `.` is the item itself.
 */
export const absolute = (basePath: string, path: string): string =>
  path.startsWith('/')
    ? path
    : basePath !== '' && (path === '' || path === '.')
    ? basePath
    : `${basePath}/${path}`;

/** Reads one JSON Pointer; a path without a leading slash is read from the root. */
export function read(model: A2uiValue, path: string): A2uiValue {
  let value: A2uiValue = model;
  for (const part of path.split('/').slice(path.startsWith('/') ? 1 : 0)) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(value))
      value = /^\d+$/.test(key) ? (value[Number(key)] as A2uiValue) : undefined;
    else if (record(value) && Object.hasOwn(value, key)) value = value[key];
    else return undefined;
  }
  return value;
}

const number = (value: A2uiValue): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

type Resolve = (value: A2uiValue) => A2uiValue;
type Args = { readonly [key: string]: A2uiValue };
type Fn = (args: Args, resolve: Resolve, depth: number) => A2uiValue;

// Authored values nest a few calls; a deeper one is treated as not evaluable.
const MAX_DEPTH = 32;

// --- formatDate: a Unicode TR35 pattern subset, longest token first ---

const DATE_TOKENS = [
  'yyyy', 'yy', 'MMMM', 'MMM', 'MM', 'M', 'dd', 'd', 'EEEE', 'E',
  'HH', 'H', 'hh', 'h', 'mm', 'm', 'ss', 's', 'a',
] as const;
const pad = (value: number) => String(value).padStart(2, '0');
const named = (date: Date, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', options).format(date);

function dateToken(token: (typeof DATE_TOKENS)[number], date: Date): string {
  const hour = ((date.getHours() + 11) % 12) + 1;
  switch (token) {
    case 'yyyy': return String(date.getFullYear());
    case 'yy': return pad(date.getFullYear() % 100);
    case 'MMMM': return named(date, { month: 'long' });
    case 'MMM': return named(date, { month: 'short' });
    case 'MM': return pad(date.getMonth() + 1);
    case 'M': return String(date.getMonth() + 1);
    case 'dd': return pad(date.getDate());
    case 'd': return String(date.getDate());
    case 'EEEE': return named(date, { weekday: 'long' });
    case 'E': return named(date, { weekday: 'short' });
    case 'HH': return pad(date.getHours());
    case 'H': return String(date.getHours());
    case 'hh': return pad(hour);
    case 'h': return String(hour);
    case 'mm': return pad(date.getMinutes());
    case 'm': return String(date.getMinutes());
    case 'ss': return pad(date.getSeconds());
    case 's': return String(date.getSeconds());
    case 'a': return date.getHours() < 12 ? 'AM' : 'PM';
  }
}

function formatDate(date: Date, pattern: string): string {
  let out = '';
  for (let index = 0; index < pattern.length; ) {
    const token = DATE_TOKENS.find((item) => pattern.startsWith(item, index));
    out += token === undefined ? pattern[index] : dateToken(token, date);
    index += token === undefined ? 1 : token.length;
  }
  return out;
}

// --- formatString: `${expression}` interpolation ---
// An expression is a JSON Pointer, a call with named arguments
// `fn(name:value, ...)`, a 'quoted string', a number or a boolean. `\${` is a
// literal `${`. Every scan is a single pass: no backtracking patterns.

/** Index of the `}` closing the `${` at `start`; -1 when it never closes. */
function closingBrace(text: string, start: number): number {
  let depth = 0;
  let quoted = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === "'") quoted = !quoted;
    else if (quoted) continue;
    else if (char === '$' && text[index + 1] === '{') {
      depth += 1;
      index += 1;
    } else if (char === '}' && (depth -= 1) === 0) return index;
  }
  return -1;
}

/** Splits on `separator` outside quotes, parentheses and braces; `once` stops at the first. */
function splitTop(text: string, separator: string, once = false): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let from = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "'") quoted = !quoted;
    else if (quoted) continue;
    else if (char === '(' || char === '{') depth += 1;
    else if (char === ')' || char === '}') depth -= 1;
    else if (char === separator && depth === 0) {
      parts.push(text.slice(from, index));
      from = index + 1;
      if (once) break;
    }
  }
  parts.push(text.slice(from));
  return parts;
}

const CALL_HEAD = /^([A-Za-z_][A-Za-z0-9_]*)\(/;

function expression(raw: string, resolve: Resolve, depth: number): A2uiValue {
  const text = raw.trim();
  if (text === '' || depth >= MAX_DEPTH) return undefined;
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'"))
    return text.slice(1, -1);
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?[\d.]+$/.test(text) && number(text) !== undefined) return number(text);
  if (text.startsWith('${') && text.endsWith('}'))
    return expression(text.slice(2, -1), resolve, depth + 1);
  const head = CALL_HEAD.exec(text);
  if (head !== null && text.endsWith(')')) {
    const args: Record<string, A2uiValue> = {};
    for (const part of splitTop(text.slice(head[0].length, -1), ',')) {
      const [key, value] = splitTop(part, ':', true);
      if (value !== undefined && key.trim() !== '')
        args[key.trim()] = expression(value, resolve, depth + 1);
    }
    // The arguments are plain values by now, so nothing is left to resolve.
    return invoke(head[1], args, (value) => value, depth + 1);
  }
  return resolve({ path: text });
}

function interpolate(template: string, resolve: Resolve, depth: number): string {
  let out = '';
  for (let index = 0; index < template.length; ) {
    if (template[index] === '\\' && template.startsWith('${', index + 1)) {
      out += '${';
      index += 3;
    } else if (template.startsWith('${', index)) {
      const close = closingBrace(template, index);
      if (close === -1) return out + template.slice(index);
      const value = expression(template.slice(index + 2, close), resolve, depth);
      out += value === null || value === undefined ? '' : String(value);
      index = close + 1;
    } else {
      out += template[index];
      index += 1;
    }
  }
  return out;
}

function numberText(
  args: Args,
  resolve: Resolve,
  options: Intl.NumberFormatOptions
): A2uiValue {
  const value = number(resolve(args['value']));
  if (value === undefined) return undefined;
  const decimals = number(resolve(args['decimals']));
  const grouping = resolve(args['grouping']);
  try {
    return new Intl.NumberFormat(undefined, {
      ...options,
      ...(decimals === undefined
        ? {}
        : { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
      ...(typeof grouping === 'boolean' ? { useGrouping: grouping } : {}),
    }).format(value);
  } catch {
    return undefined;
  }
}

/** The basic catalog's functions, with the protocol package's semantics. */
const FUNCTIONS: Readonly<Record<string, Fn>> = Object.freeze({
  formatString: (args, resolve, depth) => {
    const template = resolve(args['value']);
    return typeof template === 'string'
      ? interpolate(template, resolve, depth)
      : undefined;
  },
  formatNumber: (args, resolve) => numberText(args, resolve, {}),
  formatCurrency: (args, resolve) => {
    const currency = resolve(args['currency']);
    return typeof currency === 'string' && currency !== ''
      ? numberText(args, resolve, { style: 'currency', currency })
      : undefined;
  },
  formatDate: (args, resolve) => {
    const value = resolve(args['value']);
    const format = resolve(args['format']);
    if (typeof format !== 'string') return undefined;
    if (typeof value !== 'string' && number(value) === undefined) return undefined;
    const date = new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? undefined : formatDate(date, format);
  },
  pluralize: (args, resolve) => {
    const value = number(resolve(args['value']));
    if (value === undefined) return undefined;
    const category =
      value === 0 && args['zero'] !== undefined
        ? 'zero'
        : new Intl.PluralRules().select(value);
    const chosen = resolve(
      args[category] !== undefined ? args[category] : args['other']
    );
    return chosen === undefined ? undefined : String(chosen);
  },
  and: (args, resolve) =>
    Array.isArray(args['values'])
      ? args['values'].every((item) => resolve(item) === true)
      : undefined,
  or: (args, resolve) =>
    Array.isArray(args['values'])
      ? args['values'].some((item) => resolve(item) === true)
      : undefined,
  not: (args, resolve) => resolve(args['value']) !== true,
  required: (args, resolve) => {
    const value = resolve(args['value']);
    if (value === null || value === undefined) return false;
    return typeof value === 'string' || Array.isArray(value)
      ? value.length > 0
      : true;
  },
  regex: (args, resolve) => {
    const value = resolve(args['value']);
    const pattern = resolve(args['pattern']);
    if (typeof value !== 'string' || typeof pattern !== 'string') return false;
    try {
      return new RegExp(pattern).test(value);
    } catch {
      return false;
    }
  },
  length: (args, resolve) => {
    const value = resolve(args['value']);
    if (typeof value !== 'string') return false;
    const min = number(resolve(args['min']));
    const max = number(resolve(args['max']));
    return !(
      (min !== undefined && value.length < min) ||
      (max !== undefined && value.length > max)
    );
  },
  numeric: (args, resolve) => {
    const value = number(resolve(args['value']));
    if (value === undefined) return false;
    const min = number(resolve(args['min']));
    const max = number(resolve(args['max']));
    return !(
      (min !== undefined && value < min) || (max !== undefined && value > max)
    );
  },
  email: (args, resolve) => {
    const value = resolve(args['value']);
    if (typeof value !== 'string' || /\s/.test(value)) return false;
    const at = value.indexOf('@');
    if (at <= 0 || at !== value.lastIndexOf('@')) return false;
    const dot = value.lastIndexOf('.');
    return dot > at + 1 && dot < value.length - 1;
  },
});

function invoke(
  name: string,
  args: Args,
  resolve: Resolve,
  depth: number
): A2uiValue {
  return Object.hasOwn(FUNCTIONS, name) && depth < MAX_DEPTH
    ? FUNCTIONS[name](args, resolve, depth)
    : undefined;
}

/** A literal, a `{ path }` read from the model, a `{ call }`, or a list of those. */
export function resolve(
  value: A2uiValue,
  model: A2uiValue,
  depth = 0,
  basePath = ''
): A2uiValue {
  if (Array.isArray(value))
    return Object.freeze(
      value.map((item) => resolve(item, model, depth + 1, basePath))
    );
  if (!record(value)) return value;
  if (typeof value['call'] === 'string')
    return invoke(
      value['call'],
      record(value['args']) ? value['args'] : {},
      (item) => resolve(item, model, depth + 1, basePath),
      depth
    );
  return typeof value['path'] === 'string'
    ? read(model, absolute(basePath, value['path']))
    : value;
}

/**
 * Resolves one authored value against a surface's current data model. A
 * literal is returned as it is, a `{ path }` is read from the data model, a
 * list is resolved item by item, and a `{ call, args }` runs one of the basic
 * catalog's functions: `formatString`, `formatNumber`, `formatCurrency`,
 * `formatDate`, `pluralize`, `and`, `or`, `not`, `required`, `regex`,
 * `length`, `numeric` and `email`. Numbers and plurals use the viewer's
 * locale. An unknown function, or one whose arguments it cannot use, gives
 * undefined. For a value inside a child template, `basePath` is its list
 * item's path (for example `/items/0`): paths without a leading slash are then
 * read from that item.
 */
export function resolveA2uiValue(
  surface: A2uiSurfaceSnapshot,
  value: A2uiValue,
  basePath = ''
): A2uiValue {
  return resolve(
    value,
    record(surface.dataModel) ? surface.dataModel : {},
    0,
    basePath
  );
}
