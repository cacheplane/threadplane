import { InjectionToken } from '@angular/core';

/** Current repeated row's item, zero-based index, and absolute state path for item-relative prop and action resolution. */
export interface RepeatScope {
  item: unknown;
  index: number;
  basePath: string;
}

/** Injection token providing the current row scope to a repeated element's descendants. */
export const REPEAT_SCOPE = new InjectionToken<RepeatScope>('REPEAT_SCOPE');
