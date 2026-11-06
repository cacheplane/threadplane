import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CAPTURE_TARGETS,
  DEFAULT_WEBSITE_URL,
  WORKSPACE_CONTENT_SELECTOR,
  WORKSPACE_READY_SELECTOR,
  isMainModule,
  modeButtonName,
  parseCaptureArgs,
  workspaceModeSelector,
} from './capture-screenshots';

describe('Website workspace screenshot capture', () => {
  it('defaults to the canonical streaming Run route', () => {
    expect(DEFAULT_WEBSITE_URL).toBe(
      'https://threadplane.ai/docs/angular/langgraph/guides/streaming?mode=run'
    );
    expect(parseCaptureArgs([])).toEqual({
      url: DEFAULT_WEBSITE_URL,
      keepPng: false,
    });
  });

  it('parses CLI overrides without changing existing flag behavior', () => {
    expect(
      parseCaptureArgs([
        '--keep-png',
        '--url',
        'http://localhost:3000/docs/angular/langgraph/guides/streaming?mode=run',
      ])
    ).toEqual({
      url: 'http://localhost:3000/docs/angular/langgraph/guides/streaming?mode=run',
      keepPng: true,
    });
  });

  it('uses executable Website workspace selectors and mode matchers', () => {
    expect(WORKSPACE_READY_SELECTOR).toBe(
      '[data-workspace-shell][data-hydrated="true"]'
    );
    expect(WORKSPACE_CONTENT_SELECTOR).toBe('[data-workspace-surface]');
    expect(workspaceModeSelector('Code')).toBe(
      '[data-workspace-shell][data-workspace-mode="Code"]'
    );

    const runName = modeButtonName('Run');
    expect(runName.test('Run')).toBe(true);
    expect(runName.test('Run, Ready')).toBe(true);
    expect(runName.test('Runtime')).toBe(false);
  });

  it('preserves all four modes and output basenames', () => {
    expect(CAPTURE_TARGETS.map(({ name, mode }) => ({ name, mode }))).toEqual([
      { name: 'workspace-run', mode: 'Run' },
      { name: 'workspace-code', mode: 'Code' },
      { name: 'workspace-docs', mode: 'Docs' },
      { name: 'workspace-api', mode: 'API' },
    ]);
  });

  it('does not treat an imported module as the CLI entrypoint', () => {
    const entry = '/tmp/capture-screenshots.ts';
    expect(isMainModule(pathToFileURL(entry).href, entry)).toBe(true);
    expect(isMainModule('file:///tmp/importer.ts', entry)).toBe(false);
    expect(isMainModule('file:///tmp/importer.ts', undefined)).toBe(false);
  });
});
