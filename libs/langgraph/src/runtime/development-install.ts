// The install step rewrites this module in the installed package, so it is
// imported by path and never compiled into this one.
import { installationToken } from '../../.install-collector/development-install.mjs';
import { THREADPLANE_PACKAGE_VERSION } from './package-version.js';
import type {
  LangGraphDevelopmentRuntime,
  LangGraphDevelopmentRuntimeFactory,
} from './session-hooks.js';

// Angular's build constant, read without importing Angular. An Angular
// production build defines it false, which folds the token out of the bundle.
// Any other build leaves it undefined, and the token is never read.
declare const ngDevMode: unknown;

/**
 * Asks the host's factory for this session's development collector. The
 * session never builds one itself and sends nothing; a factory that throws or
 * returns nothing leaves the session without a collector.
 */
export function buildDevelopmentRuntime(
  factory: LangGraphDevelopmentRuntimeFactory,
  enabled: () => boolean
): LangGraphDevelopmentRuntime | undefined {
  try {
    return (
      factory({
        integration: 'langgraph',
        packageName: '@threadplane/langgraph',
        packageVersion: THREADPLANE_PACKAGE_VERSION,
        installationToken:
          typeof ngDevMode !== 'undefined' && ngDevMode
            ? installationToken
            : null,
        enabled,
      }) ?? undefined
    );
  } catch {
    return undefined;
  }
}
