import { describe, expect, it } from 'vitest';
import * as runtimeTargetSessionModule from './runtime-target-session';
import {
  areEffectiveRuntimeTargetsEqual,
  createDefaultRuntimeTargetSession,
  getEffectiveRuntimeTarget,
  getSanitizedRuntimeTargetDisplay,
  validateAgUiTarget,
  validateLangGraphTarget,
} from './runtime-target-session';

describe('runtime target session', () => {
  it('exports only pure construction, validation, selection, display, and equality helpers', () => {
    expect(Object.keys(runtimeTargetSessionModule).sort()).toEqual([
      'areEffectiveRuntimeTargetsEqual',
      'createDefaultRuntimeTargetSession',
      'getEffectiveRuntimeTarget',
      'getSanitizedRuntimeTargetDisplay',
      'validateAgUiTarget',
      'validateLangGraphTarget',
    ]);
  });

  it('defaults both adapter slots independently to shared development', () => {
    const session = createDefaultRuntimeTargetSession();

    expect(session).toEqual({
      agUi: { kind: 'shared' },
      langgraph: { kind: 'shared' },
    });
    expect(session.agUi).not.toBe(session.langgraph);
  });

  it('selects only the slot owned by the current runtime adapter', () => {
    const session = {
      agUi: { kind: 'ag-ui' as const, endpoint: 'https://ag.example.test/agent' },
      langgraph: {
        kind: 'langsmith' as const,
        apiUrl: 'https://lang.example.test/api/',
        apiKey: 'test-key-redact-me',
      },
    };

    expect(getEffectiveRuntimeTarget(session, 'ag-ui')).toEqual({
      adapter: 'ag-ui',
      target: session.agUi,
    });
    expect(getEffectiveRuntimeTarget(session, 'langgraph')).toEqual({
      adapter: 'langgraph',
      target: session.langgraph,
    });
    expect(getEffectiveRuntimeTarget(session, 'none')).toEqual({
      adapter: 'none',
      target: null,
    });
  });
});

describe('runtime target URL validation', () => {
  it('normalizes scheme, host, and default ports while preserving path identity', () => {
    expect(validateAgUiTarget('HTTPS://AG.EXAMPLE.TEST:443/agents/')).toEqual({
      ok: true,
      value: {
        kind: 'ag-ui',
        endpoint: 'https://ag.example.test/agents/',
      },
    });
    expect(validateLangGraphTarget('http://LOCALHOST:80/api', 'test-key-redact-me')).toEqual({
      ok: true,
      value: {
        kind: 'langsmith',
        apiUrl: 'http://localhost/api',
        apiKey: 'test-key-redact-me',
      },
    });
    expect(validateAgUiTarget('https://ag.example.test/agent')).toEqual({
      ok: true,
      value: { kind: 'ag-ui', endpoint: 'https://ag.example.test/agent' },
    });
    expect(validateAgUiTarget('https://ag.example.test/agent/')).toEqual({
      ok: true,
      value: { kind: 'ag-ui', endpoint: 'https://ag.example.test/agent/' },
    });
  });

  it.each([
    ['http://localhost:3000/agent', 'http://localhost:3000/agent'],
    ['http://127.0.0.1:8123/agent', 'http://127.0.0.1:8123/agent'],
    ['http://[::1]:4200/agent', 'http://[::1]:4200/agent'],
  ])('allows an HTTP loopback target: %s', (input, normalized) => {
    expect(validateAgUiTarget(input)).toEqual({
      ok: true,
      value: { kind: 'ag-ui', endpoint: normalized },
    });
  });

  it.each([
    'http://127.1/agent',
    'http://2130706433/agent',
    'http://0x7f000001/agent',
    'http://0177.0.0.1/agent',
    'http://[0:0:0:0:0:0:0:1]/agent',
    'http://localhost./agent',
  ])('rejects a non-exact raw HTTP loopback spelling: %s', (input) => {
    expect(validateAgUiTarget(input)).toMatchObject({
      ok: false,
      error: { code: 'https_required' },
    });
  });

  it('allows case-normalized exact localhost with a port', () => {
    expect(validateAgUiTarget('http://LOCALHOST:4200/agent')).toEqual({
      ok: true,
      value: { kind: 'ag-ui', endpoint: 'http://localhost:4200/agent' },
    });
  });

  it.each([
    'https://example.test/a/../secret',
    'https://example.test/a/%2e%2e/secret',
    'https://example.test/a/%2E./secret',
    'https://example.test/a\\secret',
    'https://example.test\\secret',
  ])('rejects a pathname rewritten by URL parsing: %s', (input) => {
    expect(validateAgUiTarget(input)).toMatchObject({
      ok: false,
      error: { code: 'invalid_url' },
    });
  });

  it.each([
    ['', 'empty_url'],
    ['   ', 'empty_url'],
    ['/relative', 'invalid_url'],
    ['ftp://example.test/agent', 'invalid_url'],
    ['http://example.test/agent', 'https_required'],
    ['http://127.0.0.2/agent', 'https_required'],
    ['https://user:password@example.test/agent', 'credentials_not_allowed'],
    ['https://@example.test/agent', 'credentials_not_allowed'],
    ['https://example.test/agent?token=secret', 'query_not_allowed'],
    ['https://example.test/agent?', 'query_not_allowed'],
    ['https://example.test/agent#secret', 'fragment_not_allowed'],
    ['https://example.test/agent#', 'fragment_not_allowed'],
    ['https://example.test/agent\n', 'control_characters_not_allowed'],
    ['https://example.test/\u007fagent', 'control_characters_not_allowed'],
    ['https://example.test/\u0085agent', 'control_characters_not_allowed'],
  ])('rejects an unsafe AG-UI target with a safe code: %s', (input, code) => {
    const result = validateAgUiTarget(input);

    expect(result).toMatchObject({ ok: false, error: { code } });
    expect(JSON.stringify(result)).not.toContain(input || 'definitely-not-present');
  });

  it('requires a nonempty LangSmith key without exposing it in the error', () => {
    const result = validateLangGraphTarget('https://lang.example.test/api', '   ');

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'api_key_required',
        message: 'Enter an API key.',
      },
    });
  });

  it('uses only allowlisted safe error copy and never echoes rejected input', () => {
    const rejected = 'https://sensitive.example.test/agent?apiKey=test-key-redact-me';
    const result = validateAgUiTarget(rejected);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'query_not_allowed',
        message: 'Remove the query string from the URL.',
      },
    });
    expect(JSON.stringify(result)).not.toContain('sensitive.example.test');
    expect(JSON.stringify(result)).not.toContain('test-key-redact-me');
  });
});

describe('effective target identity and display', () => {
  it('compares adapter, normalized URL, target kind, and LangSmith key', () => {
    const normalizedAgUi = validateAgUiTarget('HTTPS://AG.EXAMPLE.TEST:443/agent');
    const sameNormalizedAgUi = validateAgUiTarget('https://ag.example.test/agent');
    const agUi = getEffectiveRuntimeTarget(
      {
        ...createDefaultRuntimeTargetSession(),
        agUi: normalizedAgUi.ok
          ? normalizedAgUi.value
          : { kind: 'shared' },
      },
      'ag-ui',
    );
    const sameAgUi = getEffectiveRuntimeTarget(
      {
        ...createDefaultRuntimeTargetSession(),
        agUi: sameNormalizedAgUi.ok
          ? sameNormalizedAgUi.value
          : { kind: 'shared' },
      },
      'ag-ui',
    );

    expect(areEffectiveRuntimeTargetsEqual(agUi, sameAgUi)).toBe(true);
    expect(
      areEffectiveRuntimeTargetsEqual(
        sameAgUi,
        getEffectiveRuntimeTarget(createDefaultRuntimeTargetSession(), 'ag-ui'),
      ),
    ).toBe(false);
    expect(
      areEffectiveRuntimeTargetsEqual(
        sameAgUi,
        getEffectiveRuntimeTarget(createDefaultRuntimeTargetSession(), 'langgraph'),
      ),
    ).toBe(false);

    const langsmithA = getEffectiveRuntimeTarget(
      {
        ...createDefaultRuntimeTargetSession(),
        langgraph: {
          kind: 'langsmith',
          apiUrl: 'https://lang.example.test/api',
          apiKey: 'key-a',
        },
      },
      'langgraph',
    );
    const langsmithB = getEffectiveRuntimeTarget(
      {
        ...createDefaultRuntimeTargetSession(),
        langgraph: {
          kind: 'langsmith',
          apiUrl: 'https://lang.example.test/api',
          apiKey: 'key-b',
        },
      },
      'langgraph',
    );

    expect(areEffectiveRuntimeTargetsEqual(langsmithA, langsmithB)).toBe(false);
  });

  it('returns sanitized display data without the LangSmith key', () => {
    const display = getSanitizedRuntimeTargetDisplay({
      adapter: 'langgraph',
      target: {
        kind: 'langsmith',
        apiUrl: 'https://lang.example.test/api/',
        apiKey: 'test-key-redact-me',
      },
    });

    expect(display).toEqual({
      kind: 'langsmith',
      label: 'Custom LangSmith',
      origin: 'https://lang.example.test',
      pathname: '/api/',
      location: 'https://lang.example.test/api/',
    });
    expect(JSON.stringify(display)).not.toContain('test-key-redact-me');
    expect(
      getSanitizedRuntimeTargetDisplay({ adapter: 'none', target: null }),
    ).toEqual({
      kind: 'none',
      label: 'Runs in your browser',
      origin: null,
      pathname: null,
      location: null,
    });
  });

  it.each(['ag-ui', 'langgraph'] as const)(
    'keeps an absent %s runtime target unavailable',
    (adapter) => {
      const missingTarget = { adapter, target: null } as unknown as Parameters<
        typeof getSanitizedRuntimeTargetDisplay
      >[0];
      expect(getSanitizedRuntimeTargetDisplay(missingTarget)).toEqual({
        kind: 'none',
        label: 'Runtime target unavailable',
        origin: null,
        pathname: null,
        location: null,
      });
    }
  );

  it.each([
    {
      adapter: 'ag-ui' as const,
      target: {
        kind: 'ag-ui' as const,
        endpoint: 'https://user:secret@example.test/agent?token=secret#fragment',
      },
    },
    {
      adapter: 'langgraph' as const,
      target: {
        kind: 'langsmith' as const,
        apiUrl: 'not a URL containing test-key-redact-me',
        apiKey: 'test-key-redact-me',
      },
    },
  ])('sanitizes a structurally forged unvalidated target without throwing', (target) => {
    expect(() => getSanitizedRuntimeTargetDisplay(target)).not.toThrow();
    const display = getSanitizedRuntimeTargetDisplay(target);

    expect(display).toMatchObject({
      kind: target.target.kind,
      origin: null,
      pathname: null,
      location: null,
    });
    expect(JSON.stringify(display)).not.toMatch(
      /user|secret|token|fragment|test-key-redact-me/i,
    );
  });

  it('compares invalid custom identities reflexively without collapsing different values', () => {
    const first = {
      adapter: 'ag-ui' as const,
      target: { kind: 'ag-ui' as const, endpoint: 'invalid-one' },
    };
    const sameAsFirst = {
      adapter: 'ag-ui' as const,
      target: { kind: 'ag-ui' as const, endpoint: 'invalid-one' },
    };
    const second = {
      adapter: 'ag-ui' as const,
      target: { kind: 'ag-ui' as const, endpoint: 'invalid-two' },
    };

    expect(areEffectiveRuntimeTargetsEqual(first, first)).toBe(true);
    expect(areEffectiveRuntimeTargetsEqual(first, sameAsFirst)).toBe(true);
    expect(areEffectiveRuntimeTargetsEqual(first, second)).toBe(false);
  });

  it('includes the key when comparing structurally identical invalid LangSmith targets', () => {
    const target = {
      adapter: 'langgraph' as const,
      target: {
        kind: 'langsmith' as const,
        apiUrl: 'invalid-langsmith-url',
        apiKey: 'key-a',
      },
    };

    expect(areEffectiveRuntimeTargetsEqual(target, target)).toBe(true);
    expect(
      areEffectiveRuntimeTargetsEqual(target, {
        adapter: 'langgraph',
        target: {
          kind: 'langsmith',
          apiUrl: 'invalid-langsmith-url',
          apiKey: 'key-a',
        },
      }),
    ).toBe(true);
    expect(
      areEffectiveRuntimeTargetsEqual(target, {
        adapter: 'langgraph',
        target: {
          kind: 'langsmith',
          apiUrl: 'invalid-langsmith-url',
          apiKey: 'key-b',
        },
      }),
    ).toBe(false);
  });
});
