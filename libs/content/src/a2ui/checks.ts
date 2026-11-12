import type { A2uiSurfaceSnapshot, A2uiValue } from './types.js';

/** One component whose validation did not pass, with the message its failing rule carries. */
export interface A2uiCheckFailure {
  readonly componentId: string;
  readonly message: string;
  /** The data model path the component's `value` is bound to, when it has one. */
  readonly path?: string;
}

/** The v0.9 client error an application may send when a press was blocked by validation. */
export interface A2uiValidationErrorMessage {
  readonly version: 'v0.9';
  readonly error: {
    readonly code: 'VALIDATION_FAILED';
    readonly surfaceId: string;
    readonly path?: string;
    readonly message: string;
  };
}

const record = (
  value: A2uiValue | undefined
): value is { readonly [key: string]: A2uiValue } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function read(model: A2uiValue, path: string): A2uiValue {
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

/** The standard validator and logic functions, with the protocol package's semantics. */
const FUNCTIONS: Readonly<
  Record<string, (args: Args, resolve: Resolve) => A2uiValue>
> = Object.freeze({
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

/** A literal, a `{ path }` read from the model, or a call to one of the functions above. */
function resolve(value: A2uiValue, model: A2uiValue, depth = 0): A2uiValue {
  if (!record(value)) return value;
  if (typeof value['call'] === 'string') {
    const run = Object.hasOwn(FUNCTIONS, value['call'])
      ? FUNCTIONS[value['call']]
      : undefined;
    // Authored conditions nest a few calls; a deeper one is treated as not evaluable.
    if (run === undefined || depth >= 32) return undefined;
    return run(record(value['args']) ? value['args'] : {}, (item) =>
      resolve(item, model, depth + 1)
    );
  }
  return typeof value['path'] === 'string' ? read(model, value['path']) : value;
}

/**
 * Evaluates every component's `checks` against the surface's current data
 * model and returns the first failing rule of each component, in component
 * order. A rule passes only when its condition resolves to `true`. Conditions
 * may use `required`, `regex`, `length`, `numeric`, `email`, `and`, `or` and
 * `not`; any other function call does not pass. A TextField's `validationRegexp` on a bound value counts
 * as one more rule with the message "Invalid format". Nothing is stored or sent.
 */
export function evaluateA2uiChecks(
  surface: A2uiSurfaceSnapshot
): readonly A2uiCheckFailure[] {
  const model: A2uiValue = record(surface.dataModel) ? surface.dataModel : {};
  const failures: A2uiCheckFailure[] = [];
  for (const component of surface.components) {
    const bound = component['value'];
    const path =
      record(bound) && typeof bound['path'] === 'string'
        ? bound['path']
        : undefined;
    const authored = component['checks'];
    const rules: A2uiValue[] = Array.isArray(authored) ? [...authored] : [];
    const pattern = component['validationRegexp'];
    if (typeof pattern === 'string' && pattern !== '' && path !== undefined)
      rules.push({
        condition: { call: 'regex', args: { value: { path }, pattern } },
        message: 'Invalid format',
      });
    for (const rule of rules) {
      if (!record(rule) || typeof rule['message'] !== 'string') continue;
      if (resolve(rule['condition'], model) === true) continue;
      failures.push(
        Object.freeze({
          componentId: component.id,
          message: rule['message'],
          ...(path === undefined ? {} : { path }),
        })
      );
      break;
    }
  }
  return Object.freeze(failures);
}
