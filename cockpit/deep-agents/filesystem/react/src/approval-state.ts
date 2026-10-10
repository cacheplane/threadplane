import {
  canonicalPath,
  copyJson,
  MAX_TEXT,
  MAX_TOTAL_TEXT,
  plainRecord,
  sameJson,
  type PlainValue,
} from './workspace-state';
export type Choice = 'approve' | 'reject';
// Native HITL embeds the Python repr of complete args in description. A pair
// of maximally escaped text arguments can exceed 8 KiB by a large margin.
export const MAX_DESCRIPTION = 1048576;
export const MAX_METADATA = 2097152;
export interface ApprovalAction {
  readonly name: 'write_file' | 'edit_file' | 'delete';
  readonly args: Readonly<Record<string, PlainValue>>;
  readonly description: string;
}
export type ApprovalState =
  | {
      readonly kind: 'unavailable';
      readonly reason: string;
      readonly rawProposal?: PlainValue;
    }
  | {
      readonly kind: 'valid';
      readonly interruptId: string;
      readonly actions: readonly ApprovalAction[];
      readonly choices: readonly Choice[];
      readonly signature: string;
    };
const exactKeys = (
  r: Record<string, unknown>,
  required: string[],
  optional: string[] = []
) =>
  required.every((k) => Object.hasOwn(r, k)) &&
  Object.keys(r).every((k) => required.includes(k) || optional.includes(k));
/** Pinned WriteFileSchema, EditFileSchema, DeleteSchema; never normalize args. */
export function mutationArgs(name: unknown, args: unknown): boolean {
  if (
    !plainRecord(args) ||
    !(
      canonicalPath(args.file_path) ||
      (name === 'delete' && args.file_path === '/')
    )
  )
    return false;
  const text = (key: string) =>
    typeof args[key] === 'string' && (args[key] as string).length <= MAX_TEXT;
  if (name === 'write_file')
    return exactKeys(args, ['file_path', 'content']) && text('content');
  if (name === 'edit_file')
    return (
      exactKeys(
        args,
        ['file_path', 'old_string', 'new_string'],
        ['replace_all']
      ) &&
      text('old_string') &&
      text('new_string') &&
      (!Object.hasOwn(args, 'replace_all') ||
        typeof args.replace_all === 'boolean')
    );
  return name === 'delete' && exactKeys(args, ['file_path']);
}
export function approvalState(input: unknown): ApprovalState {
  let rawProposal: PlainValue | undefined;
  try {
    input = copyJson(input);
    // Capture unsupported input only if the entire raw JSON is bounded. Never
    // rewrite a path, omit an unknown mutation key, or evaluate an accessor.
    let rawText = 0;
    const count = (v: unknown): void => {
      if (typeof v === 'string') rawText += v.length;
      else if (Array.isArray(v)) v.forEach(count);
      else if (plainRecord(v))
        Object.entries(v).forEach(([k, x]) => {
          rawText += k.length;
          count(x);
        });
      if (rawText > MAX_METADATA + MAX_TOTAL_TEXT)
        throw new Error('Raw proposal exceeds visible budget');
    };
    count(input);
    rawProposal = input as PlainValue;
    if (
      !plainRecord(input) ||
      !exactKeys(input, ['id', 'value']) ||
      typeof input.id !== 'string' ||
      !input.id ||
      input.id.length > 1024 ||
      !plainRecord(input.value) ||
      !exactKeys(input.value, ['action_requests', 'review_configs'])
    )
      throw new Error();
    const actions = input.value.action_requests,
      configs = input.value.review_configs;
    if (
      !Array.isArray(actions) ||
      !actions.length ||
      actions.length > 20 ||
      !Array.isArray(configs) ||
      configs.length !== actions.length
    )
      throw new Error();
    let total = 0,
      metadata = 0;
    for (const [i, action] of actions.entries()) {
      const config = configs[i];
      if (
        !plainRecord(action) ||
        !exactKeys(action, ['name', 'args', 'description']) ||
        !mutationArgs(action.name, action.args) ||
        typeof action.description !== 'string' ||
        action.description.length > MAX_DESCRIPTION ||
        !plainRecord(config) ||
        !exactKeys(config, ['action_name', 'allowed_decisions']) ||
        config.action_name !== action.name ||
        !Array.isArray(config.allowed_decisions) ||
        !config.allowed_decisions.length ||
        config.allowed_decisions.length > 4 ||
        new Set(config.allowed_decisions).size !==
          config.allowed_decisions.length ||
        config.allowed_decisions.some(
          (v) => !['approve', 'edit', 'reject', 'respond'].includes(v)
        )
      )
        throw new Error();
      metadata += action.description.length;
      total += Object.values(
        action.args as Record<string, unknown>
      ).reduce<number>((n, v) => n + (typeof v === 'string' ? v.length : 0), 0);
      if (total > MAX_TOTAL_TEXT || metadata > MAX_METADATA) throw new Error();
    }
    const choices = (['approve', 'reject'] as Choice[]).filter((choice) =>
      configs.every((c) => c.allowed_decisions.includes(choice))
    );
    return Object.freeze({
      kind: 'valid',
      interruptId: input.id,
      actions: actions as readonly ApprovalAction[],
      choices: Object.freeze(choices),
      signature: JSON.stringify(input),
    });
  } catch {
    return Object.freeze({
      kind: 'unavailable',
      reason:
        rawProposal === undefined
          ? 'Raw current proposal is unavailable: non-JSON data or visible bounds exceeded. No decisions can be sent.'
          : 'Complete raw proposal shown: unsupported action, arguments, metadata, shape or bounds. No decisions can be sent.',
      ...(rawProposal !== undefined ? { rawProposal } : {}),
    });
  }
}
/** Match the captured pause against current authority before calling this. */
export function createDecision(
  batch: ApprovalState,
  currentSignature: string,
  choice: unknown
): PlainValue | undefined {
  try {
    // A signature contains JSON escapes in addition to the raw bounded text.
    const captured = copyJson(batch, false, 33554432);
    if (
      (choice !== 'approve' && choice !== 'reject') ||
      !plainRecord(captured) ||
      captured.kind !== 'valid' ||
      typeof currentSignature !== 'string' ||
      currentSignature.length > (MAX_METADATA + MAX_TOTAL_TEXT) * 6 ||
      captured.signature !== currentSignature
    )
      return undefined;
    const current = approvalState(JSON.parse(currentSignature));
    if (
      current.kind !== 'valid' ||
      !sameJson(current, captured) ||
      !current.choices.includes(choice)
    )
      return undefined;
    return Object.freeze({
      decisions: Object.freeze(
        current.actions.map(() => Object.freeze({ type: choice }))
      ),
    });
  } catch {
    return undefined;
  }
}
