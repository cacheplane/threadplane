// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Application } from 'typedoc';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectApiEntries } from './generate-api-docs';

describe('public TypeDoc signatures', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'threadplane-api-docs-'));
  let entries: ReturnType<typeof collectApiEntries>;

  beforeAll(async () => {
    const entryPoint = path.join(directory, 'index.ts');
    const tsconfig = path.join(directory, 'tsconfig.json');
    writeFileSync(
      tsconfig,
      JSON.stringify({ compilerOptions: { types: [] }, files: ['index.ts'] })
    );
    writeFileSync(
      entryPoint,
      `
      export interface Transport {
        /** @internal Private inspection. */
        inspect(id: string): string;
        /** @internal Internal overload. */
        read(id: number): number;
        /** Public read. */
        read(id: string): string;
        /** Public write. */
        write(value: string): void;
        /** @internal Internal overload. */
        write(value: number): void;
      }
      export class Client {
        /** @internal Private inspection. */
        inspect(id: string): string { return id; }
        /** @internal Internal overload. */
        read(id: number): number;
        /** Public read. */
        read(id: string): string;
        read(id: string | number): string | number { return id; }
        /** Public write. */
        write(value: string): void;
        /** @internal Internal overload. */
        write(value: number): void;
        write(value: string | number): void {}
      }
      /** @internal Private function. */
      export function inspect(id: string): string { return id; }
      /** @internal Internal overload. */
      export function read(id: number): number;
      /** Public read. */
      export function read(id: string): string;
      export function read(id: string | number): string | number { return id; }
    `
    );
    const app = await Application.bootstrapWithPlugins({
      entryPoints: [entryPoint],
      tsconfig,
    });
    const project = await app.convert();
    expect(project).toBeDefined();
    entries = collectApiEntries(project?.children ?? []);
  });

  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  it.each(['Transport', 'Client'])(
    'omits internal methods and preserves public overloads on %s',
    (name) => {
      expect(entries.find((entry) => entry.name === name)?.methods).toEqual([
        {
          name: 'read',
          signature: 'read(id: string): string',
          description: 'Public read.',
          params: [
            { name: 'id', type: 'string', description: '', optional: false },
          ],
        },
        {
          name: 'write',
          signature: 'write(value: string): void',
          description: 'Public write.',
          params: [
            { name: 'value', type: 'string', description: '', optional: false },
          ],
        },
      ]);
    }
  );

  it('omits internal functions while selecting the public function overload', () => {
    expect(entries.some((entry) => entry.name === 'inspect')).toBe(false);
    expect(entries.find((entry) => entry.name === 'read')).toMatchObject({
      signature: 'read(id: string): string',
      description: 'Public read.',
    });
  });
});
