import type { StandardSchemaV1 } from '@threadplane/angular/render';
import type { AnyFunctionToolDef, FunctionToolHandlerContext } from './tool-def';
import type { ClientToolResult } from './client-tools-capability';

const defaultSignal = new AbortController().signal;

/** Validate raw model args against a Standard Schema. */
export async function validateArgs(
  schema: StandardSchemaV1,
  args: unknown,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const res = await schema['~standard'].validate(args);
  if (res.issues) {
    return { ok: false, error: res.issues.map((i) => i.message).join('; ') };
  }
  // Cast rather than rely on discriminant narrowing: the cockpit example apps
  // compile this source with `strictNullChecks: false`, where the
  // `issues?: undefined` discriminant doesn't narrow `res` to the success type.
  return { ok: true, value: (res as { value: unknown }).value };
}

/** Validate args, run the handler, and normalize the outcome to a ClientToolResult. */
export async function executeFunctionTool(
  def: AnyFunctionToolDef,
  rawArgs: unknown,
  context: FunctionToolHandlerContext = { signal: defaultSignal },
): Promise<ClientToolResult> {
  const v = await validateArgs(def.schema, rawArgs);
  if (!v.ok) return { ok: false, error: `invalid arguments: ${(v as { error: string }).error}` };
  try {
    const value = await def.handler((v as { value: unknown }).value as never, context);
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
