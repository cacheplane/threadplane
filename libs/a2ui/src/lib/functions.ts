// A2UI v0.9 client-side functions (basic catalog `functions` map).
// Arg shapes follow the official catalog schema at
// https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json.

/** Execution context handed to every function implementation. */
export interface A2uiFunctionContext {
  /** Resolve a (possibly dynamic) argument value — bare literal, `{ path }`
   * binding, or nested `{ call }` — against the current data model/scope. */
  resolveArg(value: unknown): unknown;
  /** BCP 47 locale for Intl-based formatting; host default when undefined. */
  locale?: string;
}

/** Client-side function implementation receiving named arguments and a context for resolving dynamic values. */
export type A2uiFunctionImpl = (
  args: Record<string, unknown>,
  ctx: A2uiFunctionContext,
) => unknown;

/** Read-only lookup of client-side function implementations by their A2UI call names. */
export type A2uiFunctionRegistry = ReadonlyMap<string, A2uiFunctionImpl>;

function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function toDate(v: unknown): Date | undefined {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v;
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v);
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

// --- formatDate: Unicode TR35 pattern subset ---

const DATE_TOKENS = [
  'yyyy', 'yy', 'MMMM', 'MMM', 'MM', 'M', 'dd', 'd', 'EEEE', 'E',
  'HH', 'H', 'hh', 'h', 'mm', 'm', 'ss', 's', 'a',
] as const;

function dateToken(token: string, d: Date, locale?: string): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  switch (token) {
    case 'yyyy': return String(d.getFullYear());
    case 'yy': return pad(d.getFullYear() % 100);
    case 'MMMM': return new Intl.DateTimeFormat(locale ?? 'en-US', { month: 'long' }).format(d);
    case 'MMM': return new Intl.DateTimeFormat(locale ?? 'en-US', { month: 'short' }).format(d);
    case 'MM': return pad(d.getMonth() + 1);
    case 'M': return String(d.getMonth() + 1);
    case 'dd': return pad(d.getDate());
    case 'd': return String(d.getDate());
    case 'EEEE': return new Intl.DateTimeFormat(locale ?? 'en-US', { weekday: 'long' }).format(d);
    case 'E': return new Intl.DateTimeFormat(locale ?? 'en-US', { weekday: 'short' }).format(d);
    case 'HH': return pad(d.getHours());
    case 'H': return String(d.getHours());
    case 'hh': return pad(((d.getHours() + 11) % 12) + 1);
    case 'h': return String(((d.getHours() + 11) % 12) + 1);
    case 'mm': return pad(d.getMinutes());
    case 'm': return String(d.getMinutes());
    case 'ss': return pad(d.getSeconds());
    case 's': return String(d.getSeconds());
    case 'a': return d.getHours() < 12 ? 'AM' : 'PM';
    default: return token;
  }
}

function formatDatePattern(d: Date, pattern: string, locale?: string): string {
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const token = DATE_TOKENS.find((t) => pattern.startsWith(t, i));
    if (token) {
      out += dateToken(token, d, locale);
      i += token.length;
    } else {
      out += pattern[i];
      i += 1;
    }
  }
  return out;
}

// --- formatString: `${expression}` interpolation ---
// Expressions: JSON-pointer paths (absolute `/a/b` or relative `a/b`),
// nested named-arg function calls `fn(name:value, ...)`, quoted strings,
// numbers, booleans. `\${` escapes a literal `${`. The scanner is a
// single-pass state machine — no backtracking regexes (CodeQL ReDoS).

interface ExprEnv {
  ctx: A2uiFunctionContext;
  registry: A2uiFunctionRegistry;
  resolvePath(path: string): unknown;
}

/** Find the `}` closing the `${` that starts at `start` (index of `$`),
 * honoring nested `${...}` and single-quoted strings. Returns -1 if
 * unterminated. */
function findClosingBrace(s: string, start: number): number {
  let depth = 0;
  let i = start;
  let inQuote = false;
  while (i < s.length) {
    const c = s[i];
    if (inQuote) {
      if (c === "'") inQuote = false;
      i += 1;
      continue;
    }
    if (c === "'") { inQuote = true; i += 1; continue; }
    if (c === '$' && s[i + 1] === '{') { depth += 1; i += 2; continue; }
    if (c === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

/** Split a call's argument list on top-level commas (nesting + quote aware). */
function splitArgs(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuote = false;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuote) {
      cur += c;
      if (c === "'") inQuote = false;
      continue;
    }
    if (c === "'") { inQuote = true; cur += c; continue; }
    if (c === '(' || c === '{') depth += 1;
    else if (c === ')' || c === '}') depth -= 1;
    else if (c === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim().length > 0) parts.push(cur);
  return parts;
}

const CALL_HEAD = /^([A-Za-z_][A-Za-z0-9_]*)\(/;

/** Evaluate one expression (the text inside `${...}`). */
function evalExpr(raw: string, env: ExprEnv): unknown {
  const s = raw.trim();
  if (s.length === 0) return undefined;
  // Quoted string
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
    return s.slice(1, -1);
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  const asNumber = toNumber(s);
  if (asNumber !== undefined && /^-?[\d.]+$/.test(s)) return asNumber;
  // Nested `${...}` wrapper
  if (s.startsWith('${') && s.endsWith('}')) {
    return evalExpr(s.slice(2, -1), env);
  }
  // Function call with named args
  const head = CALL_HEAD.exec(s);
  if (head && s.endsWith(')')) {
    const name = head[1];
    const argsText = s.slice(head[0].length, -1);
    const args: Record<string, unknown> = {};
    for (const part of splitArgs(argsText)) {
      const colon = topLevelColonIndex(part);
      if (colon === -1) continue;
      const key = part.slice(0, colon).trim();
      const valueText = part.slice(colon + 1).trim();
      if (key) args[key] = evalExpr(valueText, env);
    }
    const impl = env.registry.get(name);
    if (!impl) {
      warnUnknownFunction(name);
      return undefined;
    }
    // Args are already evaluated to plain values here.
    return impl(args, { ...env.ctx, resolveArg: (v) => v });
  }
  // JSON-pointer path (absolute or relative)
  return env.resolvePath(s);
}

/** Index of the first top-level `:` (outside quotes/parens/braces). */
function topLevelColonIndex(s: string): number {
  let depth = 0;
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuote) {
      if (c === "'") inQuote = false;
      continue;
    }
    if (c === "'") inQuote = true;
    else if (c === '(' || c === '{') depth += 1;
    else if (c === ')' || c === '}') depth -= 1;
    else if (c === ':' && depth === 0) return i;
  }
  return -1;
}

function interpolate(template: string, env: ExprEnv): string {
  let out = '';
  let i = 0;
  while (i < template.length) {
    if (template[i] === '\\' && template.startsWith('${', i + 1)) {
      out += '${';
      i += 3;
      continue;
    }
    if (template[i] === '$' && template[i + 1] === '{') {
      const close = findClosingBrace(template, i);
      if (close === -1) {
        out += template.slice(i);
        break;
      }
      const value = evalExpr(template.slice(i + 2, close), env);
      out += value == null ? '' : String(value);
      i = close + 1;
      continue;
    }
    out += template[i];
    i += 1;
  }
  return out;
}

// --- Standard function implementations ---

const warnedFunctions = new Set<string>();
function warnUnknownFunction(name: string): void {
  if (warnedFunctions.has(name)) return;
  warnedFunctions.add(name);
  console.warn(`[a2ui] unknown client-side function "${name}" — resolving to undefined`);
}

function numberFormatOptions(
  args: Record<string, unknown>,
  ctx: A2uiFunctionContext,
  extra?: Intl.NumberFormatOptions,
): Intl.NumberFormatOptions {
  const options: Intl.NumberFormatOptions = { ...extra };
  const decimals = toNumber(ctx.resolveArg(args['decimals']));
  if (decimals !== undefined) {
    options.minimumFractionDigits = decimals;
    options.maximumFractionDigits = decimals;
  }
  const grouping = ctx.resolveArg(args['grouping']);
  if (typeof grouping === 'boolean') options.useGrouping = grouping;
  return options;
}

const STANDARD_FUNCTIONS: Record<string, A2uiFunctionImpl> = {
  formatString(args, ctx) {
    const template = ctx.resolveArg(args['value']);
    if (typeof template !== 'string') return undefined;
    const env: ExprEnv = {
      ctx,
      registry: currentRegistry ?? new Map(),
      resolvePath: (p) => ctx.resolveArg({ path: p }),
    };
    return interpolate(template, env);
  },
  formatNumber(args, ctx) {
    const value = toNumber(ctx.resolveArg(args['value']));
    if (value === undefined) return undefined;
    return new Intl.NumberFormat(ctx.locale, numberFormatOptions(args, ctx)).format(value);
  },
  formatCurrency(args, ctx) {
    const value = toNumber(ctx.resolveArg(args['value']));
    const currency = ctx.resolveArg(args['currency']);
    if (value === undefined || typeof currency !== 'string' || currency.length === 0) return undefined;
    try {
      return new Intl.NumberFormat(
        ctx.locale,
        numberFormatOptions(args, ctx, { style: 'currency', currency }),
      ).format(value);
    } catch {
      return undefined;
    }
  },
  formatDate(args, ctx) {
    const date = toDate(ctx.resolveArg(args['value']));
    const format = ctx.resolveArg(args['format']);
    if (!date || typeof format !== 'string') return undefined;
    return formatDatePattern(date, format, ctx.locale);
  },
  pluralize(args, ctx) {
    const value = toNumber(ctx.resolveArg(args['value']));
    if (value === undefined) return undefined;
    const category = new Intl.PluralRules(ctx.locale).select(value);
    const explicitZero = value === 0 && args['zero'] !== undefined ? 'zero' : undefined;
    const pick = explicitZero ?? category;
    const chosen = args[pick] !== undefined ? args[pick] : args['other'];
    const resolved = ctx.resolveArg(chosen);
    return resolved === undefined ? undefined : String(resolved);
  },
  and(args, ctx) {
    const values = args['values'];
    if (!Array.isArray(values)) return undefined;
    return values.every((v) => ctx.resolveArg(v) === true);
  },
  or(args, ctx) {
    const values = args['values'];
    if (!Array.isArray(values)) return undefined;
    return values.some((v) => ctx.resolveArg(v) === true);
  },
  not(args, ctx) {
    return ctx.resolveArg(args['value']) !== true;
  },
  // --- Validators (check-rule conditions) ---
  required(args, ctx) {
    const value = ctx.resolveArg(args['value']);
    if (value == null) return false;
    if (typeof value === 'string') return value.length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  },
  regex(args, ctx) {
    const value = ctx.resolveArg(args['value']);
    const pattern = ctx.resolveArg(args['pattern']);
    if (typeof value !== 'string' || typeof pattern !== 'string') return false;
    try {
      return new RegExp(pattern).test(value);
    } catch {
      return false;
    }
  },
  length(args, ctx) {
    const value = ctx.resolveArg(args['value']);
    if (typeof value !== 'string') return false;
    const min = toNumber(ctx.resolveArg(args['min']));
    const max = toNumber(ctx.resolveArg(args['max']));
    if (min !== undefined && value.length < min) return false;
    if (max !== undefined && value.length > max) return false;
    return true;
  },
  numeric(args, ctx) {
    const value = toNumber(ctx.resolveArg(args['value']));
    if (value === undefined) return false;
    const min = toNumber(ctx.resolveArg(args['min']));
    const max = toNumber(ctx.resolveArg(args['max']));
    if (min !== undefined && value < min) return false;
    if (max !== undefined && value > max) return false;
    return true;
  },
  email(args, ctx) {
    const value = ctx.resolveArg(args['value']);
    if (typeof value !== 'string') return false;
    // Linear-time shape check: local@domain.tld with a dotted domain.
    const at = value.indexOf('@');
    if (at <= 0 || at !== value.lastIndexOf('@') || at === value.length - 1) return false;
    const domain = value.slice(at + 1);
    const dot = domain.lastIndexOf('.');
    if (dot <= 0 || dot === domain.length - 1) return false;
    return !/\s/.test(value);
  },
};

// formatString needs the registry that owns it to evaluate nested calls;
// tracked per-invocation via resolveDynamic's wiring (see resolve.ts),
// with a module fallback for direct registry use.
let currentRegistry: A2uiFunctionRegistry | null = null;

/** @internal Used by resolveDynamic to make nested `${fn(...)}` calls inside
 * formatString dispatch through the same registry. */
export function withActiveRegistry<T>(registry: A2uiFunctionRegistry, fn: () => T): T {
  const prev = currentRegistry;
  currentRegistry = registry;
  try {
    return fn();
  } finally {
    currentRegistry = prev;
  }
}

/** @internal One-time warning helper shared with resolveDynamic. */
export function warnUnknownA2uiFunction(name: string): void {
  warnUnknownFunction(name);
}

/**
 * Creates an A2UI client-side function registry containing the standard
 * basic-catalog functions — `formatString`, `formatNumber`, `formatCurrency`,
 * `formatDate`, `pluralize`, `and`, `or`, `not`, plus the check-rule validators
 * `required`, `regex`, `length`, `numeric`, and `email` — optionally extended or
 * overridden with custom implementations.
 *
 * @example
 * ```ts
 * const registry = createA2uiFunctionRegistry();
 * resolveDynamic({ call: 'formatCurrency', args: { value: 42, currency: 'USD' } }, {}, undefined, registry);
 * ```
 */
export function createA2uiFunctionRegistry(
  overrides?: Record<string, A2uiFunctionImpl>,
): A2uiFunctionRegistry {
  const map = new Map<string, A2uiFunctionImpl>(Object.entries(STANDARD_FUNCTIONS));
  if (overrides) {
    for (const [name, impl] of Object.entries(overrides)) map.set(name, impl);
  }
  return map;
}
