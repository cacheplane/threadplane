import type { PlainValue } from '@threadplane/core';
import { ownState } from './state';

export type ApplicationState = Readonly<Record<string, PlainValue>>;
export type SubmitInput =
  | string
  | { readonly message: string; readonly state?: ApplicationState };
export interface CapturedSubmit {
  readonly message: string;
  readonly state?: ApplicationState;
}

function isRecord(value: unknown): value is ApplicationState {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Read only the selected input fields and own their data before deferral. */
export function captureSubmit(input: SubmitInput): CapturedSubmit {
  if (typeof input === 'string') return Object.freeze({ message: input });
  const message = input.message;
  if (typeof message !== 'string')
    throw new TypeError('A string message is required');
  const state = input.state;
  if (state === undefined) return Object.freeze({ message });
  if (!isRecord(state))
    throw new TypeError('Application state must be a plain record');
  return Object.freeze({ message, state: ownState(state) as ApplicationState });
}

/** Merge an already captured patch with the latest owned state at admission. */
export function mergeSubmitState(
  previous: PlainValue,
  patch?: ApplicationState
): PlainValue {
  if (patch === undefined) return previous;
  if (!isRecord(previous))
    throw new TypeError(
      'Current state must be a plain record to apply a patch'
    );
  if (
    Object.keys(patch).every(
      (key) =>
        Object.hasOwn(previous, key) && Object.is(previous[key], patch[key])
    )
  )
    return previous;
  return Object.freeze({ ...previous, ...patch });
}
