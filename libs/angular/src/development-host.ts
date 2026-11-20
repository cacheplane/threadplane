/**
 * The seam between agents and the development-install collector. This package
 * may not import the telemetry package, and a session knows nothing of
 * Angular, so a host that has the collector (the chat package) registers it
 * here once. Nothing in this module collects, stores or sends anything.
 */

/** What a session tells the host about its package, for the collector. */
export interface AgentDevelopmentInstall {
  readonly integration: string;
  readonly packageName: string;
  readonly packageVersion: string;
  /** The package-local token of a development install, or null. */
  readonly installationToken: string | null;
  /** Whether the session allows collection, asked each time. */
  readonly enabled: () => boolean;
}

/** The collector handle a session calls. It has the telemetry package's shape. */
export interface AgentDevelopmentRuntime {
  touch(): void;
  milestone(kind: string, durationMs?: number): void;
  dispose(): void;
}

/** Builds one session's collector. A session factory receives it as `context.developmentRuntime`. */
export type AgentDevelopmentRuntimeFactory = (
  install: AgentDevelopmentInstall
) => AgentDevelopmentRuntime;

/** @internal The collector a host registers: the telemetry package's two functions. */
export interface ɵAgentDevelopmentHost {
  /** `createDevelopmentRuntime` of the telemetry package. */
  createRuntime(install: AgentDevelopmentInstall): AgentDevelopmentRuntime;
  /** `registerDevelopmentRuntimePolicy` of the telemetry package. */
  registerPolicy(agent: object, policy: () => boolean): unknown;
}

/** Calls a collector can make before a host exists; later ones are dropped. */
const MAX_WAITING_CALLS = 16;

let host: ɵAgentDevelopmentHost | undefined;
const waiting = new Set<(host: ɵAgentDevelopmentHost) => void>();

/**
 * @internal Registers the page's collector. The first registration wins.
 * Agents built before it are connected now, so a host loaded late (a lazy
 * route) still sees them.
 */
export function ɵsetAgentDevelopmentHost(next: ɵAgentDevelopmentHost): void {
  if (host) return;
  host = next;
  for (const run of [...waiting]) {
    waiting.delete(run);
    try {
      run(next);
    } catch {
      /* Optional collection never affects an agent. */
    }
  }
}

/** @internal Runs with the host now, or when one registers. Returns a cancel. */
export function ɵwhenAgentDevelopmentHost(
  run: (host: ɵAgentDevelopmentHost) => void
): () => void {
  if (host) {
    try {
      run(host);
    } catch {
      /* Optional collection never affects an agent. */
    }
    return () => undefined;
  }
  waiting.add(run);
  return () => {
    waiting.delete(run);
  };
}

/**
 * @internal The collector handle a session is given. It forwards to the
 * host's collector once a host exists and is inert until then, so a session
 * never waits on, or fails because of, collection.
 */
export function ɵrelayDevelopmentRuntime(
  install: AgentDevelopmentInstall
): AgentDevelopmentRuntime {
  let runtime: AgentDevelopmentRuntime | undefined;
  let disposed = false;
  const queued: ((runtime: AgentDevelopmentRuntime) => void)[] = [];
  const cancel = ɵwhenAgentDevelopmentHost((registered) => {
    if (disposed) return;
    runtime = registered.createRuntime(install);
    for (const call of queued.splice(0)) call(runtime);
  });
  const call = (use: (runtime: AgentDevelopmentRuntime) => void) => {
    if (disposed) return;
    try {
      if (runtime) use(runtime);
      else if (queued.length < MAX_WAITING_CALLS) queued.push(use);
    } catch {
      /* Optional collection never affects a session. */
    }
  };
  return {
    touch: () => call((target) => target.touch()),
    milestone: (kind, durationMs) =>
      call((target) => target.milestone(kind, durationMs)),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancel();
      queued.length = 0;
      try {
        runtime?.dispose();
      } catch {
        /* Optional collection never affects a session. */
      }
    },
  };
}

/** @internal For specs: forgets the host and everything waiting for one. */
export function ɵresetAgentDevelopmentHost(): void {
  host = undefined;
  waiting.clear();
}
