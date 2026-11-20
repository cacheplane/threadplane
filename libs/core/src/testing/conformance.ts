import type { AgentSession } from '../contracts/agent-session.js';

/**
 * The two functions a conformance suite needs from a test runner. Vitest,
 * Jest, Mocha and `node:test` all supply them under these names, so a suite
 * is registered by passing `{ describe, it }`.
 */
export interface ConformanceRunner {
  describe(name: string, body: () => void): void;
  it(name: string, body: () => void | Promise<void>): void;
}

/** Named checks. Each resolves when the session conforms and rejects with the reason when it does not. */
export type ConformanceScenarios = ReadonlyMap<string, () => Promise<void>>;

/** Registers every scenario as one test under one group. */
export function registerScenarios(
  group: string,
  scenarios: ConformanceScenarios,
  runner: ConformanceRunner
): void {
  runner.describe(group, () => {
    for (const [name, scenario] of scenarios) runner.it(name, scenario);
  });
}

/** Rejects a scenario with a sentence naming what the session got wrong. */
export function check(condition: unknown, problem: string): asserts condition {
  if (!condition) throw new Error(`Conformance: ${problem}`);
}

/** Structural equality for the plain data a snapshot holds; `undefined` fields count as absent. */
export function same(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (
    left === null ||
    right === null ||
    typeof left !== 'object' ||
    typeof right !== 'object' ||
    Array.isArray(left) !== Array.isArray(right)
  )
    return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = new Set(
    [...Object.keys(a), ...Object.keys(b)].filter(
      (key) => a[key] !== undefined || b[key] !== undefined
    )
  );
  for (const key of keys) if (!same(a[key], b[key])) return false;
  return true;
}

const STATUSES = ['idle', 'running', 'error'];
const OUTCOMES = ['success', 'error', 'aborted', 'interrupted', 'paused'];
const LISTS = [
  'plan',
  'interrupts',
  'subagents',
  'streamingToolCalls',
  'pendingClientTools',
  'checkpoints',
] as const;
const COMMANDS = [
  'runWithoutMessage',
  'regenerate',
  'resume',
  'retry',
  'checkStatus',
  'onCustomEvent',
] as const;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function thenable(value: unknown): value is PromiseLike<unknown> {
  return record(value) && typeof value['then'] === 'function';
}

/**
 * The checks every {@link AgentSession} must pass, as named scenarios. Each
 * scenario takes a fresh session from `factory` and disposes it afterwards.
 * The scenarios call `submit` and `stop` and observe what they return; they
 * do not wait for a submission to settle, so a session over a fake or absent
 * backend can be checked.
 */
export function agentSessionConformanceScenarios(
  factory: () => AgentSession | Promise<AgentSession>
): ConformanceScenarios {
  const scenarios = new Map<string, () => Promise<void>>();
  const register = (
    name: string,
    scenario: (session: AgentSession) => void | Promise<void>
  ) =>
    scenarios.set(name, async () => {
      const session = await factory();
      try {
        await scenario(session);
      } finally {
        await session.dispose();
      }
    });

  register('exposes the required members', (session) => {
    for (const member of [
      'getSnapshot',
      'subscribe',
      'submit',
      'stop',
      'dispose',
    ] as const)
      check(
        typeof session[member] === 'function',
        `${member} must be a function.`
      );
  });

  register(
    'leaves an optional command undefined or makes it a function',
    (session) => {
      for (const command of COMMANDS)
        check(
          session[command] === undefined ||
            typeof session[command] === 'function',
          `${command} must be a function when present.`
        );
      const tools = session.clientTools;
      if (tools === undefined) return;
      check(
        typeof tools.setCatalog === 'function' &&
          typeof tools.resolve === 'function',
        'clientTools must have setCatalog and resolve.'
      );
      for (const optional of ['settle', 'flush'] as const)
        check(
          tools[optional] === undefined ||
            typeof tools[optional] === 'function',
          `clientTools.${optional} must be a function when present.`
        );
    }
  );

  register(
    'publishes a snapshot with a status, messages and tool calls',
    (session) => {
      const snapshot = session.getSnapshot();
      check(record(snapshot), 'getSnapshot must return an object.');
      check(
        STATUSES.includes(snapshot.status),
        `status must be one of ${STATUSES.join(', ')}.`
      );
      check(Array.isArray(snapshot.messages), 'messages must be an array.');
      check(Array.isArray(snapshot.toolCalls), 'toolCalls must be an array.');
      for (const message of snapshot.messages) {
        check(typeof message.id === 'string', 'a message needs an id.');
        check(
          typeof message.content === 'string',
          'message content must be text; structured content goes in blocks.'
        );
        check(record(message.delivery), 'a message needs a delivery.');
      }
    }
  );

  register('holds an error only with the error status', (session) => {
    const snapshot = session.getSnapshot();
    if (snapshot.status === 'error')
      check(record(snapshot.error), 'the error status needs an error.');
    if (snapshot.error !== undefined) {
      check(
        typeof snapshot.error.message === 'string' &&
          typeof snapshot.error.kind === 'string' &&
          typeof snapshot.error.retryable === 'boolean',
        'an error needs a kind, a message and a retryable flag.'
      );
      check(
        !(snapshot.error instanceof Error),
        'an error must be plain data, not an Error instance.'
      );
    }
    if (snapshot.errorDiagnostic !== undefined) {
      check(
        snapshot.error !== undefined,
        'errorDiagnostic is published only with an error.'
      );
      check(
        typeof snapshot.errorDiagnostic.message === 'string' &&
          !(snapshot.errorDiagnostic instanceof Error),
        'errorDiagnostic must be a plain description with a message.'
      );
    }
  });

  register('shapes every optional snapshot field it publishes', (session) => {
    const snapshot = session.getSnapshot();
    for (const list of LISTS)
      check(
        snapshot[list] === undefined || Array.isArray(snapshot[list]),
        `${list} must be an array when present.`
      );
    check(
      snapshot.state === undefined || record(snapshot.state),
      'state must be an object when present.'
    );
    check(
      snapshot.usage === undefined || Array.isArray(snapshot.usage.entries),
      'usage must list its entries.'
    );
    check(
      snapshot.messageCheckpoints === undefined ||
        record(snapshot.messageCheckpoints),
      'messageCheckpoints must be an object when present.'
    );
    check(
      snapshot.inputBlocked === undefined ||
        typeof snapshot.inputBlocked.reason === 'string',
      'inputBlocked needs a reason.'
    );
    for (const child of snapshot.subagents ?? []) {
      check(typeof child.id === 'string', 'a child agent needs an id.');
      check(
        Array.isArray(child.messages) && Array.isArray(child.toolCalls),
        'a child agent needs messages and toolCalls.'
      );
    }
    for (const checkpoint of snapshot.checkpoints ?? [])
      check(record(checkpoint.values), 'a checkpoint needs its values.');
  });

  register('keeps the snapshot stable between changes', (session) => {
    check(
      session.getSnapshot() === session.getSnapshot(),
      'getSnapshot must return the same object until something changes.'
    );
  });

  register('publishes frozen data', (session) => {
    const snapshot = session.getSnapshot();
    check(Object.isFrozen(snapshot), 'the snapshot must be frozen.');
    check(Object.isFrozen(snapshot.messages), 'messages must be frozen.');
    check(Object.isFrozen(snapshot.toolCalls), 'toolCalls must be frozen.');
  });

  register(
    'subscribes without notifying and releases idempotently',
    (session) => {
      let notified = 0;
      const release = session.subscribe(() => notified++);
      check(typeof release === 'function', 'subscribe must return a release.');
      check(notified === 0, 'subscribe must not notify for the initial state.');
      release();
      release();
    }
  );

  register('returns a promise from submit', async (session) => {
    const result = session.submit('test');
    check(thenable(result), 'submit must return a promise.');
    // Not awaited: a session without a backend may never settle it.
    result.then(undefined, () => undefined);
    await session.stop();
  });

  register('returns a promise from stop', async (session) => {
    const result = session.stop();
    check(thenable(result), 'stop must return a promise.');
    await result;
  });

  register('adds and releases a custom event listener', (session) => {
    if (!session.onCustomEvent) return;
    const release = session.onCustomEvent(() => undefined);
    check(
      typeof release === 'function',
      'onCustomEvent must return a release.'
    );
    release();
    release();
  });

  scenarios.set('stops notifying after disposal', async () => {
    const session = await factory();
    let notified = 0;
    session.subscribe(() => notified++);
    const disposal = session.dispose();
    check(thenable(disposal), 'dispose must return a promise.');
    await disposal;
    const before = notified;
    session.submit('after disposal').then(undefined, () => undefined);
    await Promise.resolve();
    check(
      notified === before,
      'a disposed session must not notify subscribers.'
    );
    await session.dispose();
  });

  scenarios.set('resolves a settled submission with an outcome', async () => {
    const session = await factory();
    try {
      const settled = await Promise.race([
        session.submit('test').then(
          (outcome) => ({ outcome }),
          () => undefined
        ),
        new Promise<undefined>((resolve) => setTimeout(resolve, 50)),
      ]);
      // A rejection or a run still in flight says nothing about the outcome.
      if (settled)
        check(
          OUTCOMES.includes(settled.outcome),
          `submit must resolve with one of ${OUTCOMES.join(', ')}.`
        );
      await session.stop();
    } finally {
      await session.dispose();
    }
  });

  return scenarios;
}

/**
 * Registers the session conformance checks with a test runner. Runtime
 * packages call this in their own suites, with a factory that returns a fresh
 * session each time.
 *
 * @example
 * ```ts
 * import { describe, it } from 'vitest';
 * runAgentSessionConformance('my runtime', () => createSession(options), {
 *   describe,
 *   it,
 * });
 * ```
 */
export function runAgentSessionConformance(
  label: string,
  factory: () => AgentSession | Promise<AgentSession>,
  runner: ConformanceRunner
): void {
  registerScenarios(
    `${label}: session conformance`,
    agentSessionConformanceScenarios(factory),
    runner
  );
}
