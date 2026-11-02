let disabled = false;

/** Disable subsequent explicit Node client captures for this module instance; does not abort requests already in flight. */
export function disableTelemetry(): void {
  disabled = true;
}

export function isProgrammaticallyDisabled(): boolean {
  return disabled;
}

// @internal — tests only
export function _resetDisableForTesting(): void {
  disabled = false;
}
