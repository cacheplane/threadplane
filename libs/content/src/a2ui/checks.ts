import { record, resolve } from './functions.js';
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

/**
 * Evaluates every component's `checks` against the surface's current data
 * model and returns the first failing rule of each component, in component
 * order. A rule passes only when its condition resolves to `true`, as
 * `resolveA2uiValue` resolves it. A TextField's `validationRegexp` on a bound
 * value counts as one more rule with the message "Invalid format". Nothing is
 * stored or sent.
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
