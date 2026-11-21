import { describe, it, expect } from 'vitest';
// Must use zod/v4 z — the root 'zod' package exports a v3 runtime that lacks
// _zod.def internals required by toJSONSchema. All schema construction goes
// through the v4 sub-path to keep parity with the declaration API's converter.
import { z } from 'zod/v4';
import { deriveJsonSchema } from './to-json-schema';
import type { StandardSchemaV1 } from '@threadplane/angular/render';

describe('deriveJsonSchema()', () => {
  it('converts a Zod object schema to JSON Schema', () => {
    const schema = z.object({
      city: z.string(),
      days: z.number().optional(),
    });
    const result = deriveJsonSchema('get_weather', schema);

    expect(result).toMatchObject({
      type: 'object',
      properties: {
        city: { type: 'string' },
      },
    });
    // days is optional — it should appear in properties but not in required
    expect((result['properties'] as Record<string, unknown>)['days']).toBeDefined();
  });

  it('returns a plain object (not a Zod instance)', () => {
    const schema = z.object({ foo: z.boolean() });
    const result = deriveJsonSchema('test', schema);
    expect(typeof result).toBe('object');
    expect(result).not.toBeNull();
    // Must not be the schema itself
    expect(result).not.toBe(schema);
  });

  it('throws an Error containing the tool name when the schema is not a Zod schema', () => {
    // Construct a minimal Standard Schema-compatible object that is NOT a Zod schema.
    // toJSONSchema requires the Zod internals (_zod.def) which this fake lacks,
    // so it throws "Cannot read properties of undefined (reading 'def')".
    const fakeSchema = {
      '~standard': { version: 1, vendor: 'x', validate: (v: unknown) => ({ value: v }) },
    } as unknown as StandardSchemaV1;

    expect(() => deriveJsonSchema('bad', fakeSchema)).toThrowError(/bad/);
  });

  it('the thrown error message mentions how to fix it (Zod recommendation)', () => {
    const fakeSchema = {
      '~standard': { version: 1, vendor: 'x', validate: (v: unknown) => ({ value: v }) },
    } as unknown as StandardSchemaV1;

    expect(() => deriveJsonSchema('my_tool', fakeSchema)).toThrowError(/Zod/);
  });
});
