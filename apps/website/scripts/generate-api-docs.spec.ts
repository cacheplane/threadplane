// @vitest-environment node
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { generateApiReference } from './api-reference/generate';
import { SDK_ENTRYPOINTS, validateRegistry } from './api-reference/registry';
import type { ApiSymbol } from '../src/lib/api-reference-model';
import {
  apiMemberAnchor,
  apiSymbolFileName,
} from '../src/lib/api-reference-model';

const root = path.resolve(__dirname, '../../..');
mkdirSync(path.join(root, 'tmp'), { recursive: true });
const fixture = mkdtempSync(path.join(root, 'tmp/api-fixture-'));
const output = path.join(fixture, 'output');
writeFileSync(
  path.join(fixture, 'package.json'),
  JSON.stringify({ name: '@fixture/sdk', version: '1.0.0' })
);
// Both the source program and staged declarations must resolve this package.
const externalPackage = mkdtempSync(
  path.join(root, 'node_modules/api-docs-fixture-')
);
const externalPackageName = path.basename(externalPackage);
writeFileSync(
  path.join(externalPackage, 'package.json'),
  JSON.stringify({
    name: externalPackageName,
    version: '1.0.0',
    types: 'index.d.ts',
  })
);
writeFileSync(
  path.join(externalPackage, 'index.d.ts'),
  `
export interface Undocumented { value: string }
/** Upstream summary. */ export interface Documented { value: string }
`
);
writeFileSync(
  path.join(fixture, 'index.ts'),
  `
import { Component, input as signalInput, output, Input, Output, EventEmitter } from '@angular/core';
import { forwardRef } from 'react';
import type { ExternalOptions as ImportedOptions } from './peer';
export type {
  /** SDK-owned summary for an external contract. */ Undocumented as ExternalContract,
  /** This must not replace upstream documentation. */ Documented as UpstreamContract,
} from '${externalPackageName}';
/** Read a value. @param value - The value. */
export function read<T extends string = string>(value: T, ...rest: string[]): T;
/** Read a number. */
export function read(value: number, optional?: boolean): number;
export function read(value: string | number, ...rest: unknown[]): string | number { return value; }
/** @internal */
export function hidden(): void {}
/** A transport. */
export class Transport {
  private secret = 0;
  constructor() { void this.secret; }
  protected protectedValue = 0;
  /** @internal */ inspect(): void {}
  /** @internal */ write(value: number): number;
  /** Write a value. */ write(value: string): string;
  write(value: string | number): string | number { return value; }
  /** Current value. */ get value(): string { return ''; }
  set value(value: string) {}
}
/** A callable. */
export interface Callable<T = string> { (value?: T): T; [key: string]: unknown; }
/** State values. */ export enum State { Ready = 'ready', Done = 'done' }
/** Namespace. */ export namespace Tools { /** A nested value. */ export interface Options { optional?: string } }
/** Merged. */ export interface Merged { first: string }
export interface Merged { second: number }
export type Mode = 'ready';
/** Supported modes. */ export const Mode = { Ready: 'ready' } as const;
export { Transport as Client };
/** A signal component. */
@Component({ selector: 'fixture-signal', template: '' })
export class SignalComponent {
  readonly value = signalInput.required<string>({ alias: 'selected' });
  readonly transformed = signalInput<number, string | number>(0, { transform: value => Number(value) });
  readonly changed = output<string>({ alias: 'selectionChange' });
  @Input({ required: true, alias: 'legacy' }) classic = '';
  @Output('legacyChange') classicChange = new EventEmitter<string>();
}
/** Ref component props. */ export interface RefProps { label?: string }
/** A ref component. */ export const RefComponent = forwardRef<HTMLDivElement, RefProps>(() => null);
/** A Unicode-named export. */ export interface Café { value: string }
/**
 * Linked transport: {@link Transport}. Member: {@link Transport.(write:2)}.
 * Qualified: {@link @fixture/sdk/peer#Transport | peer transport}.
 * Imported: {@link @fixture/sdk/peer#ExternalOptions | peer options}.
 * Overload: {@link (read:2) | numeric read}.
 * Type selector: {@link (Mode:type) | mode type}.
 * Unicode: {@link "Café" | Unicode export}.
 */
export interface Linked { transport: Transport }
/** Imported alias options. */ export interface Imported { options: ImportedOptions }
/** Uppercase identity. */ export interface Capability { value: string }
/** Lowercase identity. */ export const capability = 1;
`
);
writeFileSync(
  path.join(fixture, 'peer.ts'),
  `
/** Cross-entrypoint options. */ export interface ExternalOptions { optional?: string }
export { Transport } from './index';
export type { Client } from './index';
`
);
const entrypoints = [
  {
    id: 'fixture',
    importPath: '@fixture/sdk',
    packageName: '@fixture/sdk',
    project: 'fixture',
    framework: 'shared' as const,
    version: '1.0.0',
    status: 'published' as const,
    source: path.relative(root, path.join(fixture, 'index.ts')),
  },
  {
    id: 'fixture/peer',
    importPath: '@fixture/sdk/peer',
    packageName: '@fixture/sdk',
    project: 'fixture',
    framework: 'shared' as const,
    version: '1.0.0',
    status: 'published' as const,
    source: path.relative(root, path.join(fixture, 'peer.ts')),
  },
];
afterAll(() => {
  rmSync(fixture, { recursive: true, force: true });
  rmSync(externalPackage, { recursive: true, force: true });
});
const symbol = (name: string): ApiSymbol =>
  JSON.parse(
    readFileSync(path.join(output, 'fixture', apiSymbolFileName(name)), 'utf8')
  );

describe('real API Extractor declaration generation', () => {
  it('preserves public overloads, exact tokens, aliases, nested declarations and source positions', async () => {
    const index = await generateApiReference({
      root,
      entrypoints,
      output,
      validate: false,
    });
    expect(index.symbols.map((item) => item.name)).toEqual(
      expect.arrayContaining([
        'read',
        'Transport',
        'Client',
        'State',
        'Callable',
        'Merged',
        'Tools',
        'Tools.Options',
      ])
    );
    expect(index.symbols.some((item) => item.name === 'hidden')).toBe(false);
    const read = symbol('read');
    expect(read.declarations).toHaveLength(2);
    expect(
      read.declarations[0].excerptTokens.map((t) => t.text).join('')
    ).toContain('...rest: string[]');
    expect(read.declarations[0].typeParameters?.[0].typeParameterName).toBe(
      'T'
    );
    expect(read.source?.path).toBe(entrypoints[0].source);
    expect(read.source?.line).toBeGreaterThan(0);
    const members = symbol('Transport').declarations[0].members;
    expect(
      members.some((item) =>
        ['secret', 'protectedValue', 'inspect'].includes(item.name)
      )
    ).toBe(false);
    expect(members.filter((item) => item.name === 'write')).toHaveLength(1);
    expect(members.filter((item) => item.name === 'value')).toHaveLength(1);
    const accessor = members.find((item) => item.name === 'value');
    expect(
      accessor?.excerptTokens.map((token) => token.text).join('')
    ).toContain('get value(): string;');
    expect(
      accessor?.excerptTokens.map((token) => token.text).join('')
    ).toContain('set value(value: string);');
    expect(accessor?.isReadonly).toBe(false);
    expect(symbol('State').declarations[0].members).toHaveLength(2);
    expect(symbol('Merged').declarations[0].members).toHaveLength(2);
    expect(symbol('Mode').summary).toBe('Supported modes.');
    expect(symbol('ExternalContract').summary).toBe(
      'SDK-owned summary for an external contract.'
    );
    expect(symbol('ExternalContract').source?.path).toBe(entrypoints[0].source);
    expect(symbol('ExternalContract').isTypeOnly).toBe(true);
    expect(
      symbol('ExternalContract')
        .declarations[0].excerptTokens.map((token) => token.text)
        .join('')
    ).toContain('interface Undocumented');
    expect(symbol('ExternalContract').declarations[0].members[0]).toMatchObject(
      {
        name: 'value',
        kind: 'PropertySignature',
      }
    );
    expect(
      symbol('ExternalContract')
        .declarations[0].members[0].excerptTokens.map((token) => token.text)
        .join('')
    ).toBe('value: string');
    expect(symbol('UpstreamContract').summary).toBe('Upstream summary.');
    expect(symbol('Tools').isTypeOnly).toBe(true);
    expect(symbol('Client').name).toBe('Client');
    // The importable alias has its own page; its defining declaration excerpt
    // retains the original name exactly as API Extractor reports it.
    expect(
      symbol('Client')
        .declarations[0].excerptTokens.map((t) => t.text)
        .join('')
    ).toContain('class Transport');
    expect(symbol('Linked').summary).toContain(
      '](/docs/api/fixture/Transport)'
    );
    expect(symbol('Linked').summary).toContain(
      '](/docs/api/fixture/Transport#'
    );
    expect(symbol('Linked').summary).toContain(
      '[peer transport](/docs/api/fixture/peer/Transport)'
    );
    expect(symbol('Linked').summary).toContain(
      '[peer options](/docs/api/fixture/peer/ExternalOptions)'
    );
    expect(symbol('Linked').summary).toContain(
      `[numeric read](/docs/api/fixture/read#${apiMemberAnchor(
        read.declarations[1],
        1
      )})`
    );
    expect(symbol('Linked').summary).toContain(
      `[Unicode export](/docs/api/fixture/${encodeURIComponent('Café')})`
    );
    const mode = symbol('Mode');
    const typeIndex = mode.declarations.findIndex(
      (member) => member.kind === 'TypeAlias'
    );
    expect(symbol('Linked').summary).toContain(
      `[mode type](/docs/api/fixture/Mode#${apiMemberAnchor(
        mode.declarations[typeIndex],
        typeIndex
      )})`
    );
    expect(
      symbol('Linked').declarations[0].members[0].excerptTokens.some(
        (token) => token.href === '/docs/api/fixture/Transport'
      )
    ).toBe(true);
    expect(symbol('SignalComponent').declarations[0].angular).toMatchObject({
      selector: 'fixture-signal',
      inputs: [
        { name: 'classic', alias: 'legacy', required: true, type: 'string' },
        {
          name: 'transformed',
          alias: 'transformed',
          required: false,
          type: 'string | number',
        },
        { name: 'value', alias: 'selected', required: true, type: 'string' },
      ],
      outputs: [
        { name: 'changed', alias: 'selectionChange', type: 'string' },
        { name: 'classicChange', alias: 'legacyChange', type: 'string' },
      ],
    });
    expect(
      symbol('RefComponent')
        .declarations[0].excerptTokens.map((token) => token.text)
        .join('')
    ).toContain('ForwardRefExoticComponent');
    expect(symbol('Capability').name).toBe('Capability');
    expect(symbol('capability').name).toBe('capability');
    expect(
      symbol('Imported').declarations[0].members[0].excerptTokens.some(
        (token) => token.href === '/docs/api/fixture/peer/ExternalOptions'
      )
    ).toBe(true);
    expect(
      index.symbols.find(
        (symbol) =>
          symbol.name === 'Client' && symbol.entrypointId === 'fixture/peer'
      )?.isTypeOnly
    ).toBe(true);
  }, 120000);
  it('is deterministic, check is read-only, prunes stale output and preserves prior output on failure', async () => {
    const before = readFileSync(path.join(output, 'index.json'), 'utf8');
    await generateApiReference({
      root,
      entrypoints,
      output,
      validate: false,
      check: true,
    });
    expect(readFileSync(path.join(output, 'index.json'), 'utf8')).toBe(before);
    writeFileSync(path.join(output, 'obsolete.json'), '{}');
    await expect(
      generateApiReference({
        root,
        entrypoints,
        output,
        validate: false,
        check: true,
      })
    ).rejects.toThrow('obsolete.json');
    await expect(
      generateApiReference({
        root,
        entrypoints: [{ ...entrypoints[0], source: 'missing.ts' }],
        output,
        validate: false,
      })
    ).rejects.toThrow('missing.ts');
    expect(readFileSync(path.join(output, 'index.json'), 'utf8')).toBe(before);
    await generateApiReference({ root, entrypoints, output, validate: false });
    expect(() => readFileSync(path.join(output, 'obsolete.json'))).toThrow();
  }, 120000);
});
it('reconciles all 11 SDK projects and 30 typed import entrypoints', () => {
  expect(SDK_ENTRYPOINTS).toHaveLength(30);
  expect(new Set(SDK_ENTRYPOINTS.map((entry) => entry.project)).size).toBe(11);
  expect(() => validateRegistry(root, SDK_ENTRYPOINTS)).not.toThrow();
  expect(() =>
    validateRegistry(
      root,
      SDK_ENTRYPOINTS.filter((entry) => entry.id !== 'react/debug')
    )
  ).toThrow('react/debug');
});
