import type { RuntimeAdapter } from '@threadplane/cockpit-registry';

export type SharedTarget = { readonly kind: 'shared' };

export type AgUiTarget =
  | SharedTarget
  | { readonly kind: 'ag-ui'; readonly endpoint: string };

export type LangGraphTarget =
  | SharedTarget
  | {
      readonly kind: 'langsmith';
      readonly apiUrl: string;
      readonly apiKey: string;
    };

export interface RuntimeTargetSession {
  readonly agUi: AgUiTarget;
  readonly langgraph: LangGraphTarget;
}

export type EffectiveRuntimeTarget =
  | { readonly adapter: 'ag-ui'; readonly target: AgUiTarget }
  | { readonly adapter: 'langgraph'; readonly target: LangGraphTarget }
  | { readonly adapter: 'none'; readonly target: null };

export type RuntimeTargetValidationErrorCode =
  | 'empty_url'
  | 'invalid_url'
  | 'https_required'
  | 'credentials_not_allowed'
  | 'query_not_allowed'
  | 'fragment_not_allowed'
  | 'control_characters_not_allowed'
  | 'api_key_required';

export interface RuntimeTargetValidationError {
  code: RuntimeTargetValidationErrorCode;
  message: string;
}

export type RuntimeTargetValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: RuntimeTargetValidationError };

export type SanitizedRuntimeTargetDisplay = {
  kind: 'shared' | 'ag-ui' | 'langsmith' | 'none';
  label: string;
  origin: string | null;
  pathname: string | null;
  location: string | null;
};

const ERROR_MESSAGES: Readonly<
  Record<RuntimeTargetValidationErrorCode, string>
> = {
  empty_url: 'Enter an absolute HTTP or HTTPS URL.',
  invalid_url: 'Enter a valid absolute HTTP or HTTPS URL.',
  https_required: 'Use HTTPS unless targeting localhost.',
  credentials_not_allowed: 'Remove credentials from the URL.',
  query_not_allowed: 'Remove the query string from the URL.',
  fragment_not_allowed: 'Remove the fragment from the URL.',
  control_characters_not_allowed: 'Remove control characters from the URL.',
  api_key_required: 'Enter an API key.',
};

const failure = <T>(
  code: RuntimeTargetValidationErrorCode
): RuntimeTargetValidationResult<T> => ({
  ok: false,
  error: { code, message: ERROR_MESSAGES[code] },
});

const hasControlCharacters = (value: string): boolean =>
  Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || (code >= 127 && code <= 159);
  });

interface RawUrlParts {
  authority: string;
  pathname: string;
}

const getRawUrlParts = (value: string): RawUrlParts => {
  const authorityStart = value.indexOf('://') + 3;
  const pathStart = value.indexOf('/', authorityStart);
  return {
    authority: value.slice(
      authorityStart,
      pathStart === -1 ? value.length : pathStart
    ),
    pathname: pathStart === -1 ? '' : value.slice(pathStart),
  };
};

const getRawHostname = (authority: string): string | null => {
  if (authority.startsWith('[')) {
    const closingBracket = authority.indexOf(']');
    if (closingBracket === -1) return null;
    const suffix = authority.slice(closingBracket + 1);
    if (suffix !== '' && !/^:\d+$/.test(suffix)) return null;
    return authority.slice(0, closingBracket + 1).toLowerCase();
  }

  const portSeparator = authority.lastIndexOf(':');
  if (
    portSeparator !== -1 &&
    (!/^\d+$/.test(authority.slice(portSeparator + 1)) ||
      authority.indexOf(':') !== portSeparator)
  ) {
    return null;
  }
  return (
    portSeparator === -1 ? authority : authority.slice(0, portSeparator)
  ).toLowerCase();
};

const normalizeTargetUrl = (
  input: unknown
): RuntimeTargetValidationResult<string> => {
  if (typeof input !== 'string') return failure('invalid_url');
  if (input.trim().length === 0) return failure('empty_url');
  if (hasControlCharacters(input)) {
    return failure('control_characters_not_allowed');
  }

  const candidate = input.trim();
  if (candidate.includes('?')) return failure('query_not_allowed');
  if (candidate.includes('#')) return failure('fragment_not_allowed');
  if (candidate.includes('\\')) return failure('invalid_url');
  if (!/^https?:\/\//i.test(candidate)) return failure('invalid_url');

  const raw = getRawUrlParts(candidate);
  if (raw.authority.includes('@')) return failure('credentials_not_allowed');
  if (candidate.slice(0, candidate.indexOf(':')).toLowerCase() === 'http') {
    const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    const rawHostname = getRawHostname(raw.authority);
    if (rawHostname === null || !loopbackHosts.has(rawHostname)) {
      return failure('https_required');
    }
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return failure('invalid_url');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return failure('invalid_url');
  }
  if (url.username || url.password) return failure('credentials_not_allowed');

  if (url.pathname !== (raw.pathname || '/')) return failure('invalid_url');

  return { ok: true, value: `${url.origin}${raw.pathname || '/'}` };
};

export const createDefaultRuntimeTargetSession = (): RuntimeTargetSession => ({
  agUi: { kind: 'shared' },
  langgraph: { kind: 'shared' },
});

export const validateAgUiTarget = (
  endpoint: unknown
): RuntimeTargetValidationResult<Extract<AgUiTarget, { kind: 'ag-ui' }>> => {
  const normalized = normalizeTargetUrl(endpoint);
  if (!normalized.ok) return normalized;
  return {
    ok: true,
    value: { kind: 'ag-ui', endpoint: normalized.value },
  };
};

export const validateLangGraphTarget = (
  apiUrl: unknown,
  apiKey: unknown
): RuntimeTargetValidationResult<
  Extract<LangGraphTarget, { kind: 'langsmith' }>
> => {
  const normalized = normalizeTargetUrl(apiUrl);
  if (!normalized.ok) return normalized;
  if (typeof apiKey !== 'string') return failure('api_key_required');
  if (apiKey.trim().length === 0) return failure('api_key_required');
  return {
    ok: true,
    value: { kind: 'langsmith', apiUrl: normalized.value, apiKey },
  };
};

export const getEffectiveRuntimeTarget = (
  session: RuntimeTargetSession,
  adapter: RuntimeAdapter
): EffectiveRuntimeTarget => {
  switch (adapter) {
    case 'ag-ui':
      return { adapter, target: session.agUi };
    case 'langgraph':
      return { adapter, target: session.langgraph };
    case 'none':
      return { adapter, target: null };
  }
};

const identityUrl = (target: EffectiveRuntimeTarget): string | null =>
  target.target?.kind === 'ag-ui'
    ? target.target.endpoint
    : target.target?.kind === 'langsmith'
    ? target.target.apiUrl
    : null;

const normalizedIdentityUrl = (
  target: EffectiveRuntimeTarget
): RuntimeTargetValidationResult<string> => {
  const value = identityUrl(target);
  if (value === null) return failure('invalid_url');
  return normalizeTargetUrl(value);
};

export const areEffectiveRuntimeTargetsEqual = (
  left: EffectiveRuntimeTarget,
  right: EffectiveRuntimeTarget
): boolean => {
  if (left.adapter !== right.adapter) return false;
  if (left.target === null || right.target === null) {
    return left.target === right.target;
  }
  if (left.target.kind !== right.target.kind) return false;
  if (left.target.kind === 'shared' || right.target.kind === 'shared') {
    return left.target.kind === right.target.kind;
  }
  const leftUrl = normalizedIdentityUrl(left);
  const rightUrl = normalizedIdentityUrl(right);
  if (!leftUrl.ok || !rightUrl.ok) {
    if (leftUrl.ok || rightUrl.ok || identityUrl(left) !== identityUrl(right)) {
      return false;
    }
  } else if (leftUrl.value !== rightUrl.value) {
    return false;
  }
  return left.target.kind === 'langsmith' && right.target.kind === 'langsmith'
    ? left.target.apiKey === right.target.apiKey
    : true;
};

export const getSanitizedRuntimeTargetDisplay = (
  effectiveTarget: EffectiveRuntimeTarget
): SanitizedRuntimeTargetDisplay => {
  const { target } = effectiveTarget;
  if (target === null) {
    return {
      kind: 'none',
      label:
        effectiveTarget.adapter === 'none'
          ? 'Runs in your browser'
          : 'Runtime target unavailable',
      origin: null,
      pathname: null,
      location: null,
    };
  }
  if (target.kind === 'shared') {
    return {
      kind: 'shared',
      label: 'Shared development',
      origin: null,
      pathname: null,
      location: null,
    };
  }

  const validated =
    target.kind === 'ag-ui'
      ? validateAgUiTarget(target.endpoint)
      : validateLangGraphTarget(target.apiUrl, target.apiKey);
  if (!validated.ok) {
    return {
      kind: target.kind,
      label: target.kind === 'ag-ui' ? 'Custom AG-UI' : 'Custom LangSmith',
      origin: null,
      pathname: null,
      location: null,
    };
  }

  const location =
    validated.value.kind === 'ag-ui'
      ? validated.value.endpoint
      : validated.value.apiUrl;
  const parsed = new URL(location);
  return {
    kind: target.kind,
    label: target.kind === 'ag-ui' ? 'Custom AG-UI' : 'Custom LangSmith',
    origin: parsed.origin,
    pathname: parsed.pathname,
    location: parsed.href,
  };
};
