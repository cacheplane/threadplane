import { InjectionToken } from '@angular/core';

import type { RuntimeOperationFailureReporter } from '../runtime/operation-errors';
export {
  createLangGraphRuntimeFetch,
  projectLangGraphOperationFailure,
  sanitizeLangGraphClientOperationFailure,
  createSafeRequestError,
  type RuntimeOperationFailureReporter,
} from '../runtime/operation-errors';

/** @internal Cockpit-only, generation-bound operation failure reporter. */
export const ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER =
  new InjectionToken<RuntimeOperationFailureReporter>(
    'ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER'
  );
