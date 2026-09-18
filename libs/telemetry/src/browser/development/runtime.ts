import { InjectionToken, isDevMode } from '@angular/core';
import { DevelopmentCollector } from './collector';
import {
  MILESTONES,
  UUID,
  type DevelopmentRuntime,
  type DevelopmentRuntimeOptions,
  type RuntimeOwner,
} from './types';

let enabled = true;
let collector: DevelopmentCollector | undefined;
const policies = new WeakMap<object, () => boolean>();

/** Optional subtree policy, evaluated at use time. App-owned render trees may provide this token. */
export const DEVELOPMENT_COLLECTION_POLICY = new InjectionToken<() => boolean>(
  'DEVELOPMENT_COLLECTION_POLICY'
);

/** Immediately stops automatic development collection and clears pending work in this page. */
export function setDevelopmentCollectionEnabled(value: boolean): void {
  enabled = value === true;
  if (!enabled) collector?.clear();
}
/** Aggregate local counters only; never returns identities or event content. */
export function getDevelopmentCollectionDiagnostics() {
  return (
    collector?.diagnostics() ?? {
      discarded: 0,
      failures: 0,
      acknowledged: 0,
      pending: 0,
    }
  );
}
/** @internal Carries adapter destination policy to nested supported renderers. */
export function registerDevelopmentRuntimePolicy<T extends object>(
  agent: T,
  policy: () => boolean
): T {
  policies.set(agent, policy);
  return agent;
}
/** @internal Unknown app-owned agents do not opt nested renderers into a second destination. */
export function isDevelopmentRuntimeEnabled(agent: object): boolean {
  try {
    return policies.get(agent)?.() === true;
  } catch {
    return false;
  }
}
function browserAllowed(): boolean {
  if (
    !enabled ||
    !isDevMode() ||
    typeof window === 'undefined' ||
    typeof document === 'undefined'
  )
    return false;
  // Automated browsers do not represent a developer using the runtime.
  if (typeof navigator !== 'undefined' && navigator.webdriver === true)
    return false;
  if (
    (window as Window & { __THREADPLANE_TELEMETRY_DISABLED__?: boolean })
      .__THREADPLANE_TELEMETRY_DISABLED__ === true
  )
    return false;
  try {
    if (window.localStorage.getItem('THREADPLANE_TELEMETRY_DISABLED') === '1')
      return false;
  } catch {
    /* Identity storage will fall back to memory. */
  }
  return (
    typeof window.crypto?.randomUUID === 'function' &&
    typeof fetch === 'function'
  );
}
/** Inert until an integration calls touch() or reports a milestone; never initialize this at module import. */
export function createDevelopmentRuntime(
  options: DevelopmentRuntimeOptions
): DevelopmentRuntime {
  let disposed = false;
  const owner: RuntimeOwner = {
    options: {
      ...options,
      installationToken:
        typeof options.installationToken === 'string' &&
        UUID.test(options.installationToken)
          ? options.installationToken
          : undefined,
    },
    allowed: () => {
      try {
        return (
          !disposed &&
          (options.enabled?.() ?? true) &&
          ['langgraph', 'ag-ui', 'render'].includes(options.integration) &&
          options.packageName === `@threadplane/${options.integration}` &&
          /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(options.packageVersion) &&
          options.packageVersion.length <= 64 &&
          browserAllowed()
        );
      } catch {
        return false;
      }
    },
  };
  const use = (
    kind?: Parameters<DevelopmentRuntime['milestone']>[0],
    durationMs?: number
  ) => {
    try {
      if (!owner.allowed()) {
        collector?.prune();
        return;
      }
      collector ??= new DevelopmentCollector();
      collector.touch(owner, kind, durationMs);
    } catch {
      /* Optional collection must never affect application behavior. */
    }
  };
  return {
    touch: () => use(),
    milestone: (kind, durationMs) => {
      if (MILESTONES.includes(kind)) use(kind, durationMs);
    },
    dispose: () => {
      disposed = true;
      collector?.prune();
    },
  };
}
