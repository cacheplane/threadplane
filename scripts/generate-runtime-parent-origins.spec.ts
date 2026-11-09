import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GENERATED_RUNTIME_PARENT_ORIGINS_MODULE,
  generateRuntimeParentOriginPolicy,
  parseRuntimeParentPreviewOrigins,
} from './generate-runtime-parent-origins';

describe('generate runtime parent origins', () => {
  const source = JSON.parse(
    readFileSync(resolve(__dirname, '../runtime-parent-origins.json'), 'utf8')
  ) as unknown;

  it('uses the checked-in source for production/local origins and merges exact CI previews', () => {
    const policy = generateRuntimeParentOriginPolicy(source, [
      'https://website-pr-123.vercel.app',
      'https://website-pr-456.vercel.app',
    ]);

    expect(policy.childAllowedParentOrigins).toEqual([
      'https://threadplane.ai',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3001',
      'http://localhost:4308',
      'http://127.0.0.1:4308',
      'https://website-pr-123.vercel.app',
      'https://website-pr-456.vercel.app',
    ]);
    expect(policy.cspFrameAncestors).toEqual(policy.childAllowedParentOrigins);
  });

  it('permits exact port 3001 parents in the CSP without broadening local embedding', () => {
    const policy = generateRuntimeParentOriginPolicy(source, []);
    const frameAncestors = policy.deploymentHeaders['Content-Security-Policy']
      .split('; ')
      .find((directive) => directive.startsWith('frame-ancestors '))
      ?.split(' ')
      .slice(1);

    expect(frameAncestors).toContain('http://localhost:3001');
    expect(frameAncestors).toContain('http://127.0.0.1:3001');
    expect(frameAncestors).toEqual(policy.childAllowedParentOrigins);
    expect(frameAncestors).not.toContain('http://localhost:3002');
    expect(frameAncestors).not.toContain('http://127.0.0.1:3002');
    expect(frameAncestors?.some((origin) => origin.includes('*'))).toBe(false);
  });

  it('deduplicates preview origins already present in the base source', () => {
    expect(
      generateRuntimeParentOriginPolicy(source, [
        'https://threadplane.ai',
        'https://website-pr-123.vercel.app',
        'https://website-pr-123.vercel.app',
      ]).childAllowedParentOrigins
    ).toEqual([
      'https://threadplane.ai',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3001',
      'http://localhost:4308',
      'http://127.0.0.1:4308',
      'https://website-pr-123.vercel.app',
    ]);
  });

  it.each([
    ['wildcard', ['https://*.vercel.app']],
    ['suffix', ['.vercel.app']],
    ['path', ['https://website-pr-123.vercel.app/path']],
    ['insecure remote', ['http://website-pr-123.vercel.app']],
  ])('rejects invalid CI preview origin input: %s', (_name, previews) => {
    expect(() => generateRuntimeParentOriginPolicy(source, previews)).toThrow(
      'Invalid runtime parent origin policy'
    );
  });

  it('rejects source shape drift and never includes the retired Cockpit origin', () => {
    expect(() =>
      generateRuntimeParentOriginPolicy(
        { baseOrigins: ['https://threadplane.ai'], extra: true },
        []
      )
    ).toThrow('Invalid runtime parent origin policy');
    expect(
      generateRuntimeParentOriginPolicy(source, []).childAllowedParentOrigins
    ).not.toContain('https://cockpit.threadplane.ai');
  });

  it('rejects the retired Cockpit origin when CI supplies it as a preview', () => {
    expect(() =>
      generateRuntimeParentOriginPolicy(source, [
        'https://website-pr-123.vercel.app',
        'https://cockpit.threadplane.ai',
      ])
    ).toThrow('Invalid runtime parent origin policy');
  });

  it('returns frozen non-secret child and CSP inputs', () => {
    const policy = generateRuntimeParentOriginPolicy(source, []);

    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.childAllowedParentOrigins)).toBe(true);
    expect(Object.isFrozen(policy.cspFrameAncestors)).toBe(true);
    expect(policy.compiledChildModule).toContain(
      'GENERATED_RUNTIME_PARENT_ORIGINS'
    );
    expect(policy.compiledChildModule).toContain('https://threadplane.ai');
    expect(policy.deploymentHeaders).toEqual({
      'Content-Security-Policy': expect.stringContaining(
        `frame-ancestors ${policy.cspFrameAncestors.join(' ')}`
      ),
      'Referrer-Policy': 'origin',
    });
    expect(policy.deploymentHeaders['Content-Security-Policy']).toContain(
      "connect-src 'self' https: http://localhost:* http://127.0.0.1:*"
    );
    expect(policy.deploymentHeaders['Content-Security-Policy']).not.toContain('[::1]');
    expect(policy.deploymentHeaders['Content-Security-Policy']).toContain("script-src 'self';");
    expect(JSON.stringify(policy)).not.toMatch(
      /apiKey|authorization|secret|token/i
    );
  });

  it('renders the checked-in compiled child module from the same base policy', () => {
    const policy = generateRuntimeParentOriginPolicy(source, []);
    const checkedInModule = readFileSync(
      resolve(__dirname, `../${GENERATED_RUNTIME_PARENT_ORIGINS_MODULE}`),
      'utf8'
    );

    expect(checkedInModule).toBe(policy.compiledChildModule);
  });

  it('replaces a prior preview policy with the base policy instead of carrying stale origins forward', () => {
    const previewModule = generateRuntimeParentOriginPolicy(source, [
      'https://website-pr-123.vercel.app',
    ]).compiledChildModule;
    const replacementModule = generateRuntimeParentOriginPolicy(
      source,
      parseRuntimeParentPreviewOrigins(undefined)
    ).compiledChildModule;

    expect(previewModule).toContain('https://website-pr-123.vercel.app');
    expect(replacementModule).not.toContain(
      'https://website-pr-123.vercel.app'
    );
    expect(replacementModule).toBe(
      generateRuntimeParentOriginPolicy(source, []).compiledChildModule
    );
  });

  it('parses only explicit newline-delimited CI preview origins', () => {
    expect(
      parseRuntimeParentPreviewOrigins(
        'https://website-pr-123.vercel.app\nhttps://website-pr-456.vercel.app\n'
      )
    ).toEqual([
      'https://website-pr-123.vercel.app',
      'https://website-pr-456.vercel.app',
    ]);
    expect(parseRuntimeParentPreviewOrigins(undefined)).toEqual([]);
    expect(() =>
      parseRuntimeParentPreviewOrigins('https://*.vercel.app')
    ).toThrow('Invalid runtime parent origin policy');
  });

  it('wires the authoritative artifact through assembly, Nx, deployment, and CI', () => {
    const assembly = readFileSync(
      resolve(__dirname, './assemble-examples.ts'),
      'utf8'
    );
    const scriptsProject = readFileSync(
      resolve(__dirname, './project.json'),
      'utf8'
    );
    const workflow = readFileSync(
      resolve(__dirname, '../.github/workflows/ci.yml'),
      'utf8'
    );

    expect(assembly).toContain('generateRuntimeParentOriginPolicy');
    expect(assembly).toContain('compiledChildModule');
    expect(assembly).toContain('deploymentHeaders');
    expect(assembly).toContain('RUNTIME_PARENT_PREVIEW_ORIGINS');
    expect(scriptsProject).toContain('runtime-parent-origins.json');
    expect(scriptsProject).toContain('generate-runtime-parent-origins.ts');
    expect(workflow).toContain('runtime-parent-origins\\.json');
    expect(workflow).toContain('generate-runtime-parent-origins');
    expect(workflow).toContain('RUNTIME_PARENT_PREVIEW_ORIGINS');
    expect(workflow).toContain(
      '${{ steps.deploy_website.outputs.deployment_url }}'
    );
    expect(workflow).not.toContain('https://*.vercel.app');
  });
});
