import { toJSONSchema } from 'zod/v4';
import type { StandardSchemaV1 } from '@threadplane/angular/render';

/** A client tool spec as shipped to the model / AG-UI RunAgentInput.tools. */
export interface ClientToolSpec {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

/**
 * Convert a Standard Schema to a JSON Schema for the model's `parameters`.
 * Uses Zod's converter; throws a clear error for non-Zod validators (callers
 * should supply a Zod schema — see the client-tools docs).
 */
export function deriveJsonSchema(toolName: string, schema: StandardSchemaV1): Record<string, unknown> {
  try {
    return toJSONSchema(schema as never) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `client tool "${toolName}": could not derive a JSON Schema from its schema. ` +
        `Use a Zod schema (recommended) or an already-JSON-Schema-compatible validator. ` +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
