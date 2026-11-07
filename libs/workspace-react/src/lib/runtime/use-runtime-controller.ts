'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  type RefObject,
} from 'react';
import {
  parseRuntimeChildReadyMessage,
  parseRuntimeInspectionMessage,
  type InspectionFrame,
  parseRuntimeConfigurationResponseMessage,
  parseRuntimeResponseMessage,
  RUNTIME_BRIDGE_VERSION,
  RUNTIME_CONFIGURATION_VERSION,
  type RuntimeConfigurationTarget,
} from '@threadplane/cockpit-runtime-bridge';
import type { RuntimeAdapter } from '@threadplane/cockpit-registry';
import { useEffectiveRuntimeTarget } from './runtime-target-provider';
import type {
  RuntimeActivityContext,
  RuntimeActivityInput,
} from './session-activity';
import {
  areEffectiveRuntimeTargetsEqual,
  type EffectiveRuntimeTarget,
  validateAgUiTarget,
  validateLangGraphTarget,
} from './runtime-target-session';
import {
  classifyRuntimeTerminalTransition,
  createRuntimeSnapshot,
  parseRuntimeTarget,
  runtimeReducer,
  type RuntimeAction,
  type RuntimeSnapshot,
  type RuntimeTarget,
  type RuntimeTerminalTransition,
} from './runtime-state';

const RUNTIME_CHECK_TIMEOUT_MS = 5_000;
const RUNTIME_CONFIGURE_RETRY_MS = 250;
const RUNTIME_CONFIGURATION_TIMEOUT_MS = 5_000;

export interface UseRuntimeControllerOptions {
  runtimeUrl: string | null;
  capability: string;
  effectiveTarget: EffectiveRuntimeTarget;
  onInspection?(frame: InspectionFrame): void;
  onInspectionReset?(): void;
  onActivity(event: RuntimeActivityInput): void;
  onTerminalTransition(event: RuntimeTerminalTransition): void;
}

export interface RuntimeController {
  snapshot: RuntimeSnapshot;
  runtimeContext: RuntimeActivityContext;
  validatedRuntimeUrl: string | null;
  frameRef: RefObject<HTMLIFrameElement | null>;
  frameGeneration: number;
  targetGeneration: number;
  onFrameLoad(): void;
  recheck(): void;
  reload(): void;
  open(): 'requested' | 'failed';
}

interface RouteContext {
  token: number;
  target: RuntimeTarget;
  capability: string;
  invalidInputRevision: symbol | null;
  effectiveTarget: EffectiveRuntimeTarget;
  targetGeneration: number;
}

interface ActiveCheck {
  nonce: string;
  routeToken: number;
  targetGeneration: number;
  capability: string;
  origin: string;
  frameWindow: Window | null;
}

interface FrameSession {
  routeToken: number;
  targetGeneration: number;
  origin: string;
  frameWindow: Window;
  loaded: boolean;
  inspectionSequence: number;
  nonce: string | null;
  status: 'awaiting' | 'configured' | 'failed';
}

interface ConfigurationAttempt {
  routeToken: number;
  targetGeneration: number;
  status: 'awaiting' | 'configured' | 'failed';
}

type RuntimeControllerActivityKind = Exclude<
  RuntimeActivityInput['kind'],
  'mode_changed'
>;

function activityKindFor(
  transition: RuntimeTerminalTransition
): RuntimeControllerActivityKind {
  switch (transition.toState) {
    case 'invalid_configuration':
      return 'configuration_invalid';
    case 'ready':
      return transition.transition === 'recovered'
        ? 'runtime_recovered'
        : 'runtime_ready';
    case 'unresponsive':
      return 'runtime_unresponsive';
    case 'error':
      return 'runtime_initialization_error';
    case 'unauthorized':
      return 'runtime_unauthorized';
    case 'network_blocked':
      return 'runtime_network_blocked';
    case 'incompatible_bridge':
      return 'runtime_incompatible_bridge';
  }
}

function isSameOperationalRoute(
  previous: RouteContext,
  next: Omit<RouteContext, 'token' | 'targetGeneration'>
): boolean {
  if (
    previous.capability !== next.capability ||
    previous.target.kind !== next.target.kind
  ) {
    return false;
  }

  switch (previous.target.kind) {
    case 'configured':
      return (
        next.target.kind === 'configured' &&
        previous.target.sanitizedUrl === next.target.sanitizedUrl
      );
    case 'invalid_configuration':
      return previous.invalidInputRevision === next.invalidInputRevision;
    case 'not_configured':
      return true;
  }
}

function configurationTargetFor(
  effectiveTarget: EffectiveRuntimeTarget
): RuntimeConfigurationTarget | null {
  switch (effectiveTarget.adapter) {
    case 'none':
      return null;
    case 'ag-ui':
      return effectiveTarget.target.kind === 'shared'
        ? { kind: 'shared' }
        : {
            kind: 'ag-ui',
            endpoint: effectiveTarget.target.endpoint,
          };
    case 'langgraph':
      return effectiveTarget.target.kind === 'shared'
        ? { kind: 'shared' }
        : {
            kind: 'langsmith',
            apiUrl: effectiveTarget.target.apiUrl,
            apiKey: effectiveTarget.target.apiKey,
          };
  }
}

function runtimeContextFor(
  snapshot: RuntimeSnapshot,
  effectiveTarget: EffectiveRuntimeTarget
): RuntimeActivityContext {
  return {
    adapter: effectiveTarget.adapter,
    targetKind: effectiveTarget.target?.kind ?? 'none',
    protocolVersion:
      effectiveTarget.adapter === 'none'
        ? RUNTIME_BRIDGE_VERSION
        : RUNTIME_CONFIGURATION_VERSION,
    configurationGeneration: snapshot.targetGeneration,
    phase: snapshot.phase,
    reasonCode:
      snapshot.phase === 'invalid_configuration'
        ? 'invalid_runtime_url'
        : snapshot.errorCode,
  };
}

function frameSessionMatchesRoute(
  session: FrameSession,
  route: RouteContext
): boolean {
  return (
    route.target.kind === 'configured' &&
    session.routeToken === route.token &&
    session.targetGeneration === route.targetGeneration &&
    session.origin === route.target.origin
  );
}

function configurationAttemptMatchesRoute(
  attempt: ConfigurationAttempt,
  route: RouteContext
): boolean {
  return (
    attempt.routeToken === route.token &&
    attempt.targetGeneration === route.targetGeneration
  );
}

export function useRuntimeController({
  runtimeUrl,
  capability,
  effectiveTarget,
  onActivity,
  onTerminalTransition,
  onInspection,
  onInspectionReset,
}: UseRuntimeControllerOptions): RuntimeController {
  const target = useMemo(() => parseRuntimeTarget(runtimeUrl), [runtimeUrl]);
  const [snapshot, dispatch] = useReducer(runtimeReducer, undefined, () =>
    createRuntimeSnapshot(target, capability)
  );
  const snapshotRef = useRef(snapshot);

  const frameRef = useRef<HTMLIFrameElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configurationRetryRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const configurationDeadlineRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const activeCheckRef = useRef<ActiveCheck | null>(null);
  const frameSessionRef = useRef<FrameSession | null>(null);
  const onInspectionRef = useRef(onInspection);
  const onInspectionResetRef = useRef(onInspectionReset);
  const onActivityRef = useRef(onActivity);
  const onTerminalTransitionRef = useRef(onTerminalTransition);

  useLayoutEffect(() => {
    onInspectionRef.current = onInspection;
    onInspectionResetRef.current = onInspectionReset;
    onActivityRef.current = onActivity;
    onTerminalTransitionRef.current = onTerminalTransition;
  }, [onActivity, onTerminalTransition, onInspection, onInspectionReset]);

  const invalidInputRevision = useMemo(
    () =>
      target.kind === 'invalid_configuration'
        ? Symbol('invalid runtime input')
        : null,
    [runtimeUrl, target.kind]
  );
  const effectiveAdapter = effectiveTarget.adapter;
  const effectiveTargetKind = effectiveTarget.target?.kind ?? null;
  const effectiveAgUiEndpoint =
    effectiveTarget.adapter === 'ag-ui' &&
    effectiveTarget.target.kind === 'ag-ui'
      ? effectiveTarget.target.endpoint
      : null;
  const effectiveLangSmithApiUrl =
    effectiveTarget.adapter === 'langgraph' &&
    effectiveTarget.target.kind === 'langsmith'
      ? effectiveTarget.target.apiUrl
      : null;
  const effectiveLangSmithApiKey =
    effectiveTarget.adapter === 'langgraph' &&
    effectiveTarget.target.kind === 'langsmith'
      ? effectiveTarget.target.apiKey
      : null;
  const committedEffectiveTarget = useMemo<EffectiveRuntimeTarget>(() => {
    switch (effectiveAdapter) {
      case 'none':
        return Object.freeze({ adapter: 'none', target: null });
      case 'ag-ui':
        if (effectiveTargetKind === 'ag-ui' && effectiveAgUiEndpoint !== null) {
          const validated = validateAgUiTarget(effectiveAgUiEndpoint);
          return Object.freeze({
            adapter: 'ag-ui',
            target: Object.freeze({
              kind: 'ag-ui',
              endpoint: validated.ok
                ? validated.value.endpoint
                : effectiveAgUiEndpoint,
            }),
          });
        }
        return Object.freeze({
          adapter: 'ag-ui',
          target: Object.freeze({ kind: 'shared' }),
        });
      case 'langgraph':
        if (
          effectiveTargetKind === 'langsmith' &&
          effectiveLangSmithApiUrl !== null &&
          effectiveLangSmithApiKey !== null
        ) {
          const validated = validateLangGraphTarget(
            effectiveLangSmithApiUrl,
            effectiveLangSmithApiKey
          );
          return Object.freeze({
            adapter: 'langgraph',
            target: Object.freeze({
              kind: 'langsmith',
              apiUrl: validated.ok
                ? validated.value.apiUrl
                : effectiveLangSmithApiUrl,
              apiKey: effectiveLangSmithApiKey,
            }),
          });
        }
        return Object.freeze({
          adapter: 'langgraph',
          target: Object.freeze({ kind: 'shared' }),
        });
    }
  }, [
    effectiveAdapter,
    effectiveTargetKind,
    effectiveAgUiEndpoint,
    effectiveLangSmithApiUrl,
    effectiveLangSmithApiKey,
  ]);
  const renderedRoute = useMemo<
    Omit<RouteContext, 'token' | 'targetGeneration'>
  >(
    () => ({
      target,
      capability,
      invalidInputRevision,
      effectiveTarget: committedEffectiveTarget,
    }),
    [target, capability, invalidInputRevision, committedEffectiveTarget]
  );
  const routeContextRef = useRef<RouteContext>({
    token: 0,
    targetGeneration: 0,
    ...renderedRoute,
  });
  const configurationAttemptRef = useRef<ConfigurationAttempt | null>(
    target.kind === 'configured' && committedEffectiveTarget.adapter !== 'none'
      ? { routeToken: 0, targetGeneration: 0, status: 'awaiting' }
      : null
  );

  const applyAction = useCallback((action: RuntimeAction) => {
    snapshotRef.current = runtimeReducer(snapshotRef.current, action);
    dispatch(action);
  }, []);

  const clearCheckTimer = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const clearConfigurationRetry = useCallback(() => {
    if (configurationRetryRef.current !== null) {
      clearTimeout(configurationRetryRef.current);
      configurationRetryRef.current = null;
    }
  }, []);

  const clearConfigurationTimers = useCallback(() => {
    clearConfigurationRetry();
    if (configurationDeadlineRef.current !== null) {
      clearTimeout(configurationDeadlineRef.current);
      configurationDeadlineRef.current = null;
    }
  }, [clearConfigurationRetry]);

  const cancelActiveCheck = useCallback(
    (updateState: boolean) => {
      const hadActiveCheck = activeCheckRef.current !== null;
      activeCheckRef.current = null;
      clearCheckTimer();
      if (hadActiveCheck && updateState) {
        applyAction({ type: 'check_cancelled' });
      }
    },
    [applyAction, clearCheckTimer]
  );

  const cancelFrameSession = useCallback(() => {
    clearConfigurationTimers();
    frameSessionRef.current = null;
    try {
      onInspectionResetRef.current?.();
    } catch {
      // Inspection consumers cannot interrupt runtime ownership or health.
    }
  }, [clearConfigurationTimers]);

  const recordActivity = useCallback(
    (
      kind: RuntimeControllerActivityKind,
      eventCapability: string,
      state = snapshotRef.current
    ) => {
      const route = routeContextRef.current;
      onActivityRef.current({
        id: globalThis.crypto.randomUUID(),
        at: new Date().toISOString(),
        kind,
        capability: eventCapability,
        ...(route.effectiveTarget.adapter === 'none'
          ? {}
          : { runtime: runtimeContextFor(state, route.effectiveTarget) }),
      });
    },
    []
  );

  const settleActiveCheck = useCallback(
    (activeCheck: ActiveCheck, action: RuntimeAction) => {
      if (activeCheckRef.current !== activeCheck) return;
      activeCheckRef.current = null;
      clearCheckTimer();
      applyAction(action);
    },
    [applyAction, clearCheckTimer]
  );

  const startCheck = useCallback(
    (intent: 'frame_load' | 'recheck') => {
      const route = routeContextRef.current;
      if (route.target.kind !== 'configured') return;
      if (
        route.effectiveTarget.adapter !== 'none' &&
        (!frameSessionRef.current ||
          !frameSessionMatchesRoute(frameSessionRef.current, route) ||
          frameSessionRef.current.status !== 'configured')
      ) {
        return;
      }

      cancelActiveCheck(true);

      const nonce = globalThis.crypto.randomUUID();
      const startedAt = Date.now();
      const frameWindow = frameRef.current?.contentWindow ?? null;
      const activeCheck: ActiveCheck = {
        nonce,
        routeToken: route.token,
        targetGeneration: route.targetGeneration,
        capability: route.capability,
        origin: route.target.origin,
        frameWindow,
      };
      activeCheckRef.current = activeCheck;
      applyAction({ type: 'check_started', intent, nonce, startedAt });
      recordActivity('runtime_check_requested', route.capability);

      timeoutRef.current = setTimeout(() => {
        const currentRoute = routeContextRef.current;
        if (
          activeCheckRef.current !== activeCheck ||
          currentRoute.token !== activeCheck.routeToken ||
          currentRoute.targetGeneration !== activeCheck.targetGeneration ||
          currentRoute.capability !== activeCheck.capability
        ) {
          return;
        }
        settleActiveCheck(activeCheck, {
          type: 'timeout',
          nonce,
          at: Date.now(),
        });
      }, RUNTIME_CHECK_TIMEOUT_MS);

      try {
        if (frameWindow === null) {
          throw new Error('Runtime frame is unavailable');
        }
        frameWindow.postMessage(
          {
            type: 'tplane:runtime-check',
            version: RUNTIME_BRIDGE_VERSION,
            nonce,
            capability: route.capability,
          },
          route.target.origin
        );
      } catch {
        settleActiveCheck(activeCheck, {
          type: 'timeout',
          nonce,
          at: Date.now(),
        });
      }
    },
    [applyAction, cancelActiveCheck, recordActivity, settleActiveCheck]
  );

  const postConfiguration = useCallback((session: FrameSession) => {
    const route = routeContextRef.current;
    const configurationTarget = configurationTargetFor(route.effectiveTarget);
    if (
      session.nonce === null ||
      session.status !== 'awaiting' ||
      configurationTarget === null ||
      !frameSessionMatchesRoute(session, route) ||
      frameSessionRef.current !== session
    ) {
      return;
    }
    try {
      session.frameWindow.postMessage(
        {
          type: 'tplane:runtime-configure',
          version: RUNTIME_CONFIGURATION_VERSION,
          nonce: session.nonce,
          generation: session.targetGeneration,
          target: configurationTarget,
        },
        session.origin
      );
    } catch {
      // The bounded deadline remains authoritative if the frame disappears.
    }
  }, []);

  const startConfigurationDeadline = useCallback(
    (routeToken: number, targetGeneration: number) => {
      if (configurationDeadlineRef.current !== null) return;
      configurationDeadlineRef.current = setTimeout(() => {
        configurationDeadlineRef.current = null;
        const route = routeContextRef.current;
        const attempt = configurationAttemptRef.current;
        if (
          route.token !== routeToken ||
          route.targetGeneration !== targetGeneration ||
          route.effectiveTarget.adapter === 'none' ||
          attempt === null ||
          !configurationAttemptMatchesRoute(attempt, route) ||
          attempt.status !== 'awaiting'
        ) {
          return;
        }
        const session = frameSessionRef.current;
        if (
          session !== null &&
          frameSessionMatchesRoute(session, route) &&
          session.status === 'configured'
        ) {
          return;
        }
        clearConfigurationTimers();
        attempt.status = 'failed';
        if (session !== null && frameSessionMatchesRoute(session, route)) {
          session.status = 'failed';
        }
        cancelActiveCheck(false);
        applyAction({
          type: 'runtime_failure',
          code: 'incompatible_bridge',
          at: Date.now(),
        });
      }, RUNTIME_CONFIGURATION_TIMEOUT_MS);
    },
    [applyAction, cancelActiveCheck, clearConfigurationTimers]
  );

  const startConfigurationRetry = useCallback(
    (session: FrameSession) => {
      const retry = () => {
        if (
          frameSessionRef.current !== session ||
          session.status !== 'awaiting'
        ) {
          return;
        }
        postConfiguration(session);
        if (session.nonce !== null) {
          configurationRetryRef.current = setTimeout(
            retry,
            RUNTIME_CONFIGURE_RETRY_MS
          );
        }
      };
      retry();
    },
    [postConfiguration]
  );

  const startConfigurationAttempt = useCallback(
    (session: FrameSession) => {
      const route = routeContextRef.current;
      const attempt = configurationAttemptRef.current;
      if (
        attempt === null ||
        !configurationAttemptMatchesRoute(attempt, route) ||
        attempt.status !== 'awaiting' ||
        !frameSessionMatchesRoute(session, route)
      ) {
        return;
      }
      session.status = 'awaiting';
      applyAction({ type: 'configuration_started' });
      if (configurationRetryRef.current !== null) {
        postConfiguration(session);
      } else {
        startConfigurationRetry(session);
      }
      startConfigurationDeadline(session.routeToken, session.targetGeneration);
    },
    [
      applyAction,
      postConfiguration,
      startConfigurationDeadline,
      startConfigurationRetry,
    ]
  );

  const getOrCreateFrameSession = useCallback((): FrameSession | null => {
    const route = routeContextRef.current;
    if (
      route.target.kind !== 'configured' ||
      route.effectiveTarget.adapter === 'none'
    ) {
      return null;
    }
    const attempt = configurationAttemptRef.current;
    if (
      attempt === null ||
      !configurationAttemptMatchesRoute(attempt, route) ||
      attempt.status === 'failed'
    ) {
      return null;
    }
    const frameWindow = frameRef.current?.contentWindow ?? null;
    if (frameWindow === null) return null;
    const existing = frameSessionRef.current;
    if (
      existing &&
      existing.frameWindow === frameWindow &&
      frameSessionMatchesRoute(existing, route)
    ) {
      return existing;
    }
    if (existing) {
      cancelFrameSession();
      configurationAttemptRef.current = {
        routeToken: route.token,
        targetGeneration: route.targetGeneration,
        status: 'awaiting',
      };
    } else {
      clearConfigurationRetry();
    }
    const session: FrameSession = {
      routeToken: route.token,
      targetGeneration: route.targetGeneration,
      origin: route.target.origin,
      frameWindow,
      loaded: false,
      inspectionSequence: -1,
      nonce: null,
      status: 'awaiting',
    };
    frameSessionRef.current = session;
    return session;
  }, [cancelFrameSession, clearConfigurationRetry]);

  const onFrameLoad = useCallback(() => {
    const route = routeContextRef.current;
    if (route.effectiveTarget.adapter === 'none') {
      startCheck('frame_load');
      return;
    }
    // child-ready can precede the first iframe load. Preserve that session,
    // including its earliest frames; subsequent loads start a new owner.
    if (frameSessionRef.current?.loaded) {
      cancelActiveCheck(false);
      cancelFrameSession();
      configurationAttemptRef.current = {
        routeToken: route.token,
        targetGeneration: route.targetGeneration,
        status: 'awaiting',
      };
    }
    const session = getOrCreateFrameSession();
    if (session === null) return;
    session.loaded = true;
    if (session.status === 'configured') {
      startCheck('frame_load');
    } else if (session.status === 'awaiting') {
      startConfigurationAttempt(session);
    }
  }, [
    cancelActiveCheck,
    cancelFrameSession,
    getOrCreateFrameSession,
    startCheck,
    startConfigurationAttempt,
  ]);

  const recheck = useCallback(() => {
    const route = routeContextRef.current;
    if (route.effectiveTarget.adapter === 'none') {
      startCheck('recheck');
      return;
    }
    const currentAttempt = configurationAttemptRef.current;
    if (
      currentAttempt === null ||
      !configurationAttemptMatchesRoute(currentAttempt, route) ||
      currentAttempt.status === 'failed'
    ) {
      clearConfigurationTimers();
      const session = frameSessionRef.current;
      if (session !== null && frameSessionMatchesRoute(session, route)) {
        session.status = 'awaiting';
      }
      configurationAttemptRef.current = {
        routeToken: route.token,
        targetGeneration: route.targetGeneration,
        status: 'awaiting',
      };
      applyAction({ type: 'configuration_started' });
      startConfigurationDeadline(route.token, route.targetGeneration);
    }
    const session = getOrCreateFrameSession();
    if (session === null) return;
    if (session.status === 'configured') {
      startCheck('recheck');
      return;
    }
    startConfigurationAttempt(session);
  }, [
    applyAction,
    clearConfigurationTimers,
    getOrCreateFrameSession,
    startCheck,
    startConfigurationAttempt,
    startConfigurationDeadline,
  ]);

  const reload = useCallback(() => {
    const route = routeContextRef.current;
    if (route.target.kind !== 'configured') return;
    cancelActiveCheck(true);
    cancelFrameSession();
    applyAction({ type: 'reload_requested' });
    if (route.effectiveTarget.adapter !== 'none') {
      configurationAttemptRef.current = {
        routeToken: route.token,
        targetGeneration: route.targetGeneration,
        status: 'awaiting',
      };
      startConfigurationDeadline(route.token, route.targetGeneration);
    } else {
      configurationAttemptRef.current = null;
    }
    recordActivity('runtime_reload_requested', route.capability);
  }, [
    applyAction,
    cancelActiveCheck,
    cancelFrameSession,
    recordActivity,
    startConfigurationDeadline,
  ]);

  const open = useCallback((): 'requested' | 'failed' => {
    const route = routeContextRef.current;
    if (route.target.kind !== 'configured') return 'failed';
    recordActivity('runtime_open_requested', route.capability);
    try {
      if (typeof window.open !== 'function') return 'failed';
      window.open(route.target.configuredUrl, '_blank', 'noopener,noreferrer');
      return 'requested';
    } catch {
      return 'failed';
    }
  }, [recordActivity]);

  useLayoutEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const route = routeContextRef.current;
      const frameWindow = frameRef.current?.contentWindow ?? null;
      if (
        frameWindow === null ||
        route.target.kind !== 'configured' ||
        event.source !== frameWindow ||
        event.origin !== route.target.origin
      ) {
        return;
      }

      if (route.effectiveTarget.adapter !== 'none') {
        const inspection = parseRuntimeInspectionMessage(event.data);
        if (inspection !== null) {
          const session = frameSessionRef.current;
          if (
            session === null ||
            session.status !== 'configured' ||
            !frameSessionMatchesRoute(session, route) ||
            event.source !== session.frameWindow ||
            event.origin !== session.origin ||
            inspection.nonce !== session.nonce ||
            inspection.generation !== session.targetGeneration ||
            inspection.frame.sequence <= session.inspectionSequence
          )
            return;
          session.inspectionSequence = inspection.frame.sequence;
          try {
            onInspectionRef.current?.(inspection.frame);
          } catch {
            // Inspection is optional and must not disrupt health checks.
          }
          return;
        }
        const childReady = parseRuntimeChildReadyMessage(event.data);
        if (childReady !== null) {
          const session = getOrCreateFrameSession();
          if (session === null || session.status === 'failed') return;
          if (session.nonce !== null && session.nonce !== childReady.nonce) {
            return;
          }
          if (session.status === 'configured') return;
          session.nonce = childReady.nonce;
          startConfigurationAttempt(session);
          return;
        }

        const response = parseRuntimeConfigurationResponseMessage(event.data);
        if (response !== null) {
          const session = frameSessionRef.current;
          if (
            session === null ||
            !frameSessionMatchesRoute(session, route) ||
            event.source !== session.frameWindow ||
            event.origin !== session.origin ||
            session.nonce !== response.nonce ||
            session.targetGeneration !== response.generation
          ) {
            return;
          }

          if (response.type === 'tplane:runtime-configured') {
            if (session.status !== 'awaiting') return;
            const attempt = configurationAttemptRef.current;
            if (
              attempt === null ||
              !configurationAttemptMatchesRoute(attempt, route) ||
              attempt.status !== 'awaiting'
            ) {
              return;
            }
            clearConfigurationTimers();
            session.status = 'configured';
            attempt.status = 'configured';
            applyAction({ type: 'configuration_succeeded' });
            if (session.loaded) startCheck('frame_load');
            return;
          }

          if (session.status === 'failed') return;
          if (response.type === 'tplane:runtime-configuration-failed') {
            const attempt = configurationAttemptRef.current;
            if (
              attempt === null ||
              !configurationAttemptMatchesRoute(attempt, route) ||
              attempt.status !== 'awaiting'
            ) {
              return;
            }
            clearConfigurationTimers();
            session.status = 'failed';
            attempt.status = 'failed';
            cancelActiveCheck(false);
            applyAction({
              type: 'runtime_failure',
              code: 'incompatible_bridge',
              at: Date.now(),
            });
            return;
          }

          if (session.status !== 'configured') return;
          cancelActiveCheck(false);
          applyAction({
            type: 'runtime_failure',
            code: response.code,
            at: Date.now(),
          });
          return;
        }
      }

      const activeCheck = activeCheckRef.current;
      if (
        activeCheck === null ||
        event.source !== activeCheck.frameWindow ||
        event.origin !== activeCheck.origin ||
        route.token !== activeCheck.routeToken ||
        route.targetGeneration !== activeCheck.targetGeneration ||
        route.capability !== activeCheck.capability
      ) {
        return;
      }

      const message = parseRuntimeResponseMessage(event.data);
      if (message === null || message.nonce !== activeCheck.nonce) return;

      const at = Date.now();
      if (message.type === 'tplane:runtime-ready') {
        settleActiveCheck(activeCheck, {
          type: 'ready',
          nonce: message.nonce,
          at,
        });
      } else {
        settleActiveCheck(activeCheck, {
          type: 'bootstrap_failed',
          nonce: message.nonce,
          code: message.code,
          at,
        });
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [
    applyAction,
    cancelActiveCheck,
    clearConfigurationTimers,
    getOrCreateFrameSession,
    settleActiveCheck,
    startCheck,
    startConfigurationAttempt,
  ]);

  useLayoutEffect(() => {
    const previousRoute = routeContextRef.current;
    const routeChanged = !isSameOperationalRoute(previousRoute, renderedRoute);
    const targetChanged = !areEffectiveRuntimeTargetsEqual(
      previousRoute.effectiveTarget,
      renderedRoute.effectiveTarget
    );
    if (routeChanged || targetChanged) {
      cancelActiveCheck(false);
      cancelFrameSession();
    }

    const committedRoute: RouteContext = {
      ...renderedRoute,
      token: routeChanged ? previousRoute.token + 1 : previousRoute.token,
      targetGeneration:
        previousRoute.targetGeneration + (targetChanged ? 1 : 0),
    };
    routeContextRef.current = committedRoute;

    if (routeChanged || targetChanged) {
      applyAction({
        type: 'context_reset',
        target: committedRoute.target,
        capability: committedRoute.capability,
        routeChanged,
        targetChanged,
      });
    }

    const requiresConfiguration =
      committedRoute.target.kind === 'configured' &&
      committedRoute.effectiveTarget.adapter !== 'none';
    if (routeChanged || targetChanged) {
      configurationAttemptRef.current = requiresConfiguration
        ? {
            routeToken: committedRoute.token,
            targetGeneration: committedRoute.targetGeneration,
            status: 'awaiting',
          }
        : null;
    } else if (!requiresConfiguration) {
      configurationAttemptRef.current = null;
    } else if (
      configurationAttemptRef.current === null ||
      !configurationAttemptMatchesRoute(
        configurationAttemptRef.current,
        committedRoute
      )
    ) {
      configurationAttemptRef.current = {
        routeToken: committedRoute.token,
        targetGeneration: committedRoute.targetGeneration,
        status: 'awaiting',
      };
    }

    if (
      requiresConfiguration &&
      configurationAttemptRef.current?.status === 'awaiting'
    ) {
      if (snapshotRef.current.phase !== 'configuring') {
        applyAction({ type: 'configuration_started' });
      }
      startConfigurationDeadline(
        committedRoute.token,
        committedRoute.targetGeneration
      );
    }
  }, [
    renderedRoute,
    applyAction,
    cancelActiveCheck,
    cancelFrameSession,
    startConfigurationDeadline,
  ]);

  useLayoutEffect(
    () => () => {
      cancelActiveCheck(false);
      cancelFrameSession();
    },
    [cancelActiveCheck, cancelFrameSession]
  );

  const initialReportedSnapshotRef = useRef<RuntimeSnapshot | null>(null);
  if (initialReportedSnapshotRef.current === null) {
    initialReportedSnapshotRef.current =
      target.kind === 'invalid_configuration'
        ? createRuntimeSnapshot({ kind: 'not_configured' }, capability)
        : snapshot;
  }
  useEffect(() => {
    const previous = initialReportedSnapshotRef.current;
    initialReportedSnapshotRef.current = snapshot;
    if (previous === null) return;
    const transition = classifyRuntimeTerminalTransition(previous, snapshot);
    if (transition === null) return;
    onTerminalTransitionRef.current(transition);
    recordActivity(
      activityKindFor(transition),
      transition.capability,
      snapshot
    );
  }, [snapshot, recordActivity]);

  const runtimeContext = runtimeContextFor(
    snapshot,
    routeContextRef.current.effectiveTarget
  );

  return {
    snapshot,
    runtimeContext,
    validatedRuntimeUrl:
      target.kind === 'configured' ? target.sanitizedUrl : null,
    frameRef,
    frameGeneration: snapshot.frameGeneration,
    targetGeneration: snapshot.targetGeneration,
    onFrameLoad,
    recheck,
    reload,
    open,
  };
}

export interface UseEmbeddedRuntimeControllerOptions {
  runtimeUrl: string | null;
  capability: string;
  adapter: RuntimeAdapter;
  onInspection?(frame: InspectionFrame): void;
  onInspectionReset?(): void;
}

const ignoreRuntimeActivity = () => undefined;

/** Embedded surfaces share target selection without exposing connection secrets. */
export function useEmbeddedRuntimeController({
  adapter,
  ...options
}: UseEmbeddedRuntimeControllerOptions): RuntimeController {
  const effectiveTarget = useEffectiveRuntimeTarget(adapter);
  return useRuntimeController({
    ...options,
    effectiveTarget,
    onActivity: ignoreRuntimeActivity,
    onTerminalTransition: ignoreRuntimeActivity,
  });
}
