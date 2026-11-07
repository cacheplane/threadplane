import {
  parseRuntimeChildReadyMessage,
  parseRuntimeCheckMessage,
  parseRuntimeConfigureMessage,
  RUNTIME_BRIDGE_VERSION,
  RUNTIME_CONFIGURATION_VERSION,
  type RuntimeConfigurationTarget,
  type RuntimeOperationFailureCode,
  type RuntimeResponseMessage,
} from './protocol';
import {
  isAllowedRuntimeParentOrigin,
  validateRuntimeParentOrigins,
} from './runtime-parent-origins';
import {
  parseInspectionFrame,
  RUNTIME_INSPECTION_VERSION,
  type InspectionFrame,
} from './inspection';

export type RuntimeBridgeEnvironment = {
  window: Pick<Window, 'parent' | 'addEventListener' | 'removeEventListener'>;
  document: Pick<Document, 'referrer'>;
  crypto?: Pick<Crypto, 'randomUUID'>;
};

export type RuntimeBridgeInstallOptions = {
  readonly allowedParentOrigins?: readonly string[];
  readonly childReadyRetryMs?: number;
  readonly configurationTimeoutMs?: number;
};

export type RuntimeBridgeDefaultConfiguration = {
  readonly status: 'default';
};

export type RuntimeBridgeConfiguredConfiguration = {
  readonly status: 'configured';
  readonly generation: number;
  readonly target: RuntimeConfigurationTarget;
  readonly reportOperationFailure: (code: RuntimeOperationFailureCode) => void;
};

export type RuntimeBridgeConfigurationError = {
  readonly status: 'error';
  readonly code: 'incompatible_bridge';
};

export type RuntimeBridgeConfiguration =
  | RuntimeBridgeDefaultConfiguration
  | RuntimeBridgeConfiguredConfiguration
  | RuntimeBridgeConfigurationError;

export type InstalledRuntimeBridge = {
  awaitConfiguration(): Promise<RuntimeBridgeConfiguration>;
  publishInspection(frame: InspectionFrame): void;
  markReady(): void;
  markError(code: 'bootstrap_failed'): void;
  dispose(): void;
};

type PendingCheck = {
  nonce: string;
  origin: string;
  source: Window;
};

type RuntimeTerminalState =
  | { phase: 'ready' }
  | { phase: 'error'; code: 'bootstrap_failed' };

type RuntimeHealthState =
  | {
      phase: 'initializing';
      pendingCheck: PendingCheck | null;
    }
  | RuntimeTerminalState;

type ConfigurationState =
  | { phase: 'default' }
  | { phase: 'awaiting'; nonce: string; parentOrigin: string; parent: Window }
  | {
      phase: 'configured';
      nonce: string;
      parentOrigin: string;
      parent: Window;
      generation: number;
      target: RuntimeConfigurationTarget;
    }
  | { phase: 'error'; code: 'incompatible_bridge' };

type RuntimeBridgeState =
  | {
      phase: 'active';
      configuration: ConfigurationState;
      health: RuntimeHealthState;
    }
  | { phase: 'disposed' };

const DEFAULT_CHILD_READY_RETRY_MS = 250;
const DEFAULT_CONFIGURATION_TIMEOUT_MS = 5_000;
const DEFAULT_CONFIGURATION_RESULT: RuntimeBridgeDefaultConfiguration =
  Object.freeze({ status: 'default' });
const INCOMPATIBLE_CONFIGURATION_RESULT: RuntimeBridgeConfigurationError =
  Object.freeze({ status: 'error', code: 'incompatible_bridge' });

function createRuntimeResponse(
  terminalState: RuntimeTerminalState,
  nonce: string
): RuntimeResponseMessage {
  switch (terminalState.phase) {
    case 'ready':
      return {
        type: 'tplane:runtime-ready',
        version: RUNTIME_BRIDGE_VERSION,
        nonce,
      };
    case 'error':
      return {
        type: 'tplane:runtime-error',
        version: RUNTIME_BRIDGE_VERSION,
        nonce,
        code: terminalState.code,
      };
  }
}

function parseReferrerOrigin(referrer: string | undefined): string | null {
  if (!referrer) return null;

  try {
    const url = new URL(referrer);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

function targetsEqual(
  left: RuntimeConfigurationTarget,
  right: RuntimeConfigurationTarget
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'shared' || right.kind === 'shared') return true;
  if (left.kind === 'ag-ui' && right.kind === 'ag-ui') {
    return left.endpoint === right.endpoint;
  }
  return (
    left.kind === 'langsmith' &&
    right.kind === 'langsmith' &&
    left.apiUrl === right.apiUrl &&
    left.apiKey === right.apiKey
  );
}

function safePositiveDuration(
  value: number | undefined,
  fallback: number
): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function getDefaultEnvironment(): RuntimeBridgeEnvironment {
  return { window, document, crypto: globalThis.crypto };
}

export function installRuntimeBridge(
  environment: RuntimeBridgeEnvironment = getDefaultEnvironment(),
  options: RuntimeBridgeInstallOptions = {}
): InstalledRuntimeBridge {
  const expectedReferrerOrigin = parseReferrerOrigin(
    environment.document.referrer
  );
  const allowedParentOrigins =
    validateRuntimeParentOrigins(options.allowedParentOrigins ?? []) ?? [];
  const isEmbedded = environment.window.parent !== environment.window;
  const recognizedParentOrigin =
    isEmbedded &&
    expectedReferrerOrigin !== null &&
    isAllowedRuntimeParentOrigin(expectedReferrerOrigin, allowedParentOrigins)
      ? expectedReferrerOrigin
      : null;
  const recognizedParent = environment.window.parent as Window;
  const childReadyRetryMs = safePositiveDuration(
    options.childReadyRetryMs,
    DEFAULT_CHILD_READY_RETRY_MS
  );
  const configurationTimeoutMs = safePositiveDuration(
    options.configurationTimeoutMs,
    DEFAULT_CONFIGURATION_TIMEOUT_MS
  );

  let state: RuntimeBridgeState = {
    phase: 'active',
    configuration: { phase: 'default' },
    health: { phase: 'initializing', pendingCheck: null },
  };
  let childReadyTimer: ReturnType<typeof setTimeout> | null = null;
  let configurationTimeout: ReturnType<typeof setTimeout> | null = null;
  let configurationAwaited = false;
  let configurationWaiter:
    | ((result: RuntimeBridgeConfiguration) => void)
    | null = null;

  const clearConfigurationTimers = () => {
    if (childReadyTimer !== null) {
      clearTimeout(childReadyTimer);
      childReadyTimer = null;
    }
    if (configurationTimeout !== null) {
      clearTimeout(configurationTimeout);
      configurationTimeout = null;
    }
  };

  const post = (target: Window, message: unknown, origin: string) => {
    try {
      target.postMessage(message, origin);
    } catch {
      // Delivery can fail if the embedding document disappeared. The bounded
      // retry/deadline state remains authoritative.
    }
  };

  const replyToCheck = (
    terminalState: RuntimeTerminalState,
    check: PendingCheck
  ) => {
    post(
      check.source,
      createRuntimeResponse(terminalState, check.nonce),
      check.origin
    );
  };

  const acknowledgeConfiguration = (
    configuration: Extract<ConfigurationState, { phase: 'configured' }>
  ) => {
    post(
      configuration.parent,
      {
        type: 'tplane:runtime-configured',
        version: RUNTIME_CONFIGURATION_VERSION,
        nonce: configuration.nonce,
        generation: configuration.generation,
      },
      configuration.parentOrigin
    );
  };

  const failConflictingConfiguration = (
    configuration: Extract<ConfigurationState, { phase: 'configured' }>,
    generation: number
  ) => {
    post(
      configuration.parent,
      {
        type: 'tplane:runtime-configuration-failed',
        version: RUNTIME_CONFIGURATION_VERSION,
        nonce: configuration.nonce,
        generation,
        code: 'incompatible_bridge',
      },
      configuration.parentOrigin
    );
  };

  const createOperationFailureReporter = (
    nonce: string,
    generation: number,
    parent: Window,
    parentOrigin: string
  ) => {
    return (code: RuntimeOperationFailureCode) => {
      if (code !== 'unauthorized' && code !== 'network_blocked') return;
      if (
        state.phase !== 'active' ||
        state.configuration.phase !== 'configured' ||
        state.configuration.nonce !== nonce ||
        state.configuration.generation !== generation
      ) {
        return;
      }
      post(
        parent,
        {
          type: 'tplane:runtime-operation-failed',
          version: RUNTIME_CONFIGURATION_VERSION,
          nonce,
          generation,
          code,
        },
        parentOrigin
      );
    };
  };

  const createConfiguredResult = (
    configuration: Extract<ConfigurationState, { phase: 'configured' }>
  ): RuntimeBridgeConfiguredConfiguration => {
    const reportOperationFailure = createOperationFailureReporter(
      configuration.nonce,
      configuration.generation,
      configuration.parent,
      configuration.parentOrigin
    );

    return Object.freeze({
      status: 'configured',
      generation: configuration.generation,
      target: configuration.target,
      reportOperationFailure,
    });
  };

  const getConfigurationResult = (): RuntimeBridgeConfiguration | null => {
    if (state.phase === 'disposed') return INCOMPATIBLE_CONFIGURATION_RESULT;
    switch (state.configuration.phase) {
      case 'default':
        return DEFAULT_CONFIGURATION_RESULT;
      case 'configured':
        return createConfiguredResult(state.configuration);
      case 'error':
        return INCOMPATIBLE_CONFIGURATION_RESULT;
      case 'awaiting':
        return null;
    }
  };

  const settleConfigurationWaiter = () => {
    if (configurationWaiter === null) return;
    const result = getConfigurationResult();
    if (result === null) return;
    const waiter = configurationWaiter;
    configurationWaiter = null;
    waiter(result);
  };

  const onMessage = (event: MessageEvent<unknown>) => {
    if (state.phase === 'disposed') return;

    const check = parseRuntimeCheckMessage(event.data);
    if (
      check !== null &&
      expectedReferrerOrigin !== null &&
      event.source === environment.window.parent &&
      event.origin === expectedReferrerOrigin
    ) {
      const pendingCheck: PendingCheck = {
        nonce: check.nonce,
        origin: event.origin,
        source: event.source as Window,
      };
      if (state.health.phase === 'initializing') {
        state = {
          ...state,
          health: { phase: 'initializing', pendingCheck },
        };
      } else {
        replyToCheck(state.health, pendingCheck);
      }
      return;
    }

    const configure = parseRuntimeConfigureMessage(event.data);
    const configuration = state.configuration;
    if (
      configure === null ||
      (configuration.phase !== 'awaiting' &&
        configuration.phase !== 'configured') ||
      event.source !== configuration.parent ||
      event.origin !== configuration.parentOrigin ||
      configure.nonce !== configuration.nonce
    ) {
      return;
    }

    if (configuration.phase === 'awaiting') {
      clearConfigurationTimers();
      const configuredState: Extract<
        ConfigurationState,
        { phase: 'configured' }
      > = {
        phase: 'configured',
        nonce: configuration.nonce,
        parentOrigin: configuration.parentOrigin,
        parent: configuration.parent,
        generation: configure.generation,
        target: configure.target,
      };
      state = { ...state, configuration: configuredState };
      settleConfigurationWaiter();
      acknowledgeConfiguration(configuredState);
      return;
    }

    if (configure.generation < configuration.generation) return;
    if (
      configure.generation === configuration.generation &&
      targetsEqual(configure.target, configuration.target)
    ) {
      acknowledgeConfiguration(configuration);
      return;
    }
    failConflictingConfiguration(configuration, configure.generation);
  };

  environment.window.addEventListener('message', onMessage);

  if (recognizedParentOrigin !== null) {
    let nonce: string;
    try {
      nonce = (environment.crypto ?? globalThis.crypto).randomUUID();
    } catch {
      nonce = '';
    }

    const childReadyMessage = parseRuntimeChildReadyMessage({
      type: 'tplane:runtime-child-ready',
      version: RUNTIME_CONFIGURATION_VERSION,
      nonce,
    });
    if (childReadyMessage === null) {
      state = {
        ...state,
        configuration: { phase: 'error', code: 'incompatible_bridge' },
      };
      settleConfigurationWaiter();
    } else {
      state = {
        ...state,
        configuration: {
          phase: 'awaiting',
          nonce,
          parentOrigin: recognizedParentOrigin,
          parent: recognizedParent,
        },
      };

      const announceChildReady = () => {
        if (
          state.phase !== 'active' ||
          state.configuration.phase !== 'awaiting'
        ) {
          return;
        }
        post(recognizedParent, childReadyMessage, recognizedParentOrigin);
        childReadyTimer = setTimeout(announceChildReady, childReadyRetryMs);
      };

      announceChildReady();
      configurationTimeout = setTimeout(() => {
        if (
          state.phase !== 'active' ||
          state.configuration.phase !== 'awaiting'
        ) {
          return;
        }
        clearConfigurationTimers();
        state = {
          ...state,
          configuration: { phase: 'error', code: 'incompatible_bridge' },
        };
        settleConfigurationWaiter();
      }, configurationTimeoutMs);
    }
  }

  const markTerminal = (nextHealth: RuntimeTerminalState) => {
    if (state.phase !== 'active' || state.health.phase !== 'initializing') {
      return;
    }

    const pendingCheck = state.health.pendingCheck;
    state = { ...state, health: nextHealth };
    if (pendingCheck) replyToCheck(nextHealth, pendingCheck);
  };

  return {
    publishInspection(frame) {
      if (
        state.phase !== 'active' ||
        state.configuration.phase !== 'configured'
      )
        return;
      const detached = parseInspectionFrame(frame);
      if (detached === null) return;
      const configuration = state.configuration;
      post(
        configuration.parent,
        {
          type: 'tplane:runtime-inspection',
          version: RUNTIME_INSPECTION_VERSION,
          nonce: configuration.nonce,
          generation: configuration.generation,
          frame: detached,
        },
        configuration.parentOrigin
      );
    },
    awaitConfiguration() {
      if (configurationAwaited || state.phase === 'disposed') {
        return Promise.resolve(INCOMPATIBLE_CONFIGURATION_RESULT);
      }
      configurationAwaited = true;
      const result = getConfigurationResult();
      if (result !== null) return Promise.resolve(result);
      return new Promise<RuntimeBridgeConfiguration>((resolve) => {
        configurationWaiter = resolve;
      });
    },
    markReady() {
      markTerminal({ phase: 'ready' });
    },
    markError(code) {
      if (code === 'bootstrap_failed') {
        markTerminal({ phase: 'error', code });
      }
    },
    dispose() {
      if (state.phase === 'disposed') return;
      clearConfigurationTimers();
      state = { phase: 'disposed' };
      environment.window.removeEventListener('message', onMessage);
      settleConfigurationWaiter();
    },
  };
}
