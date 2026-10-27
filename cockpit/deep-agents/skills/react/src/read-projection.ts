import {
  copyData,
  displayUnits,
  LIMITS,
  record,
  sameData,
  type Authority,
} from './authority';
import { skillPath, type SkillIndex } from './index-projection';
export interface SkillRead {
  readonly id: string;
  readonly skillName: string;
  readonly path: string;
  readonly category: 'instruction' | 'reference';
  readonly kind:
    | 'pending'
    | 'unknown'
    | 'error'
    | 'unavailable'
    | 'partial'
    | 'inspected';
  readonly result?: string;
  /** The literal pinned empty-file reminder was observed; no body is invented. */
  readonly empty?: boolean;
}
const EMPTY = 'System reminder: File exists but has empty contents';
const NO_LINES =
  /^System reminder: no lines were read because `limit` was -?\d+\. The file was not inspected and may have contents; retry with `limit` >= 1 to read it\.$/;
const PARTIAL =
  /\n\n\[Read \d+ lines? \(lines \d+-\d+(?: of \d+ total)?\)\. (?:\d+ lines? remaining|More lines remain) from offset \d+\.\]$/;

/** Recognize only the pinned text formatter, without interpreting numbered source
 * text as notices. "Inspected" describes evidence, never an entire-file claim. */
function inspectedResult(
  result: string,
  path: string,
  offset: number
): 'inspected' | 'partial' | undefined {
  if (result === EMPTY) return offset > 0 ? 'partial' : 'inspected';
  let body = result,
    partial = offset > 0;
  const clamp =
    '\n\n[Requested offset ' +
    offset +
    ' is before the start of the file; read from line 1 instead.]';
  if (offset < 0 && body.endsWith(clamp)) body = body.slice(0, -clamp.length);
  const pagination = body.match(PARTIAL);
  if (pagination) {
    partial = true;
    body = body.slice(0, -pagination[0].length);
  }
  const truncation =
    "\n\n[Output was truncated due to size limits. The file content is very large. Consider reformatting the file to make it easier to navigate. For example, if this is JSON, use execute(command='jq . " +
    path +
    "') to pretty-print it with line breaks. For other formats, you can use appropriate formatting tools to split long lines.]";
  if (body.endsWith(truncation)) {
    partial = true;
    body = body.slice(0, -truncation.length);
    // The pinned size cap can leave only its documented warning.
    if (!body) return 'partial';
  }
  let previous = 0,
    continuation = 0;
  for (const row of body.split('\n')) {
    const match = /^ *([1-9][0-9]*)(?:\.([1-9][0-9]*))?  [\s\S]*$/.exec(row);
    if (!match) return undefined;
    const line = Number(match[1]),
      chunk = Number(match[2] ?? 0);
    if (!Number.isSafeInteger(line) || !Number.isSafeInteger(chunk))
      return undefined;
    if (chunk) {
      if (line !== previous || chunk !== continuation + 1) return undefined;
    } else if (previous && line !== previous + 1) return undefined;
    previous = line;
    continuation = chunk;
  }
  return partial ? 'partial' : 'inspected';
}

/** Native completion carries no ToolMessage status. Confirmed root raw evidence
 * must match the unique native id, exact arguments and literal result again. */
export type ReadProjection =
  | readonly SkillRead[]
  | { readonly kind: 'unavailable' };
export function projectReads(
  index: SkillIndex,
  tools: unknown,
  authority: Authority
): ReadProjection {
  if (index.kind !== 'ready') return [];
  try {
    const calls = copyData(tools);
    if (!Array.isArray(calls) || calls.length > LIMITS.entries)
      return { kind: 'unavailable' };
    if (
      calls.some(
        (call) =>
          !record(call) ||
          typeof call.id !== 'string' ||
          typeof call.name !== 'string'
      )
    )
      return { kind: 'unavailable' };
    if (
      calls.some(
        (call) =>
          record(call) &&
          call.name === 'read_file' &&
          (!record(call.args) || typeof call.args.file_path !== 'string')
      )
    )
      return { kind: 'unavailable' };
    const ownedAuthority = copyData(authority) as Authority;
    const ids = new Map<string, number>();
    for (const call of calls)
      if (record(call) && typeof call.id === 'string')
        ids.set(call.id, (ids.get(call.id) ?? 0) + 1);
    const output: SkillRead[] = [],
      strings: string[] = [];
    for (const call of calls) {
      if (
        !record(call) ||
        typeof call.id !== 'string' ||
        call.name !== 'read_file' ||
        !record(call.args) ||
        !skillPath(call.args.file_path)
      )
        continue;
      const path = call.args.file_path;
      const skill = index.skills.find((s) =>
        path.startsWith(s.path.slice(0, -'SKILL.md'.length))
      );
      if (!skill) continue;
      // A duplicate call is one unavailable row, never two successful reads.
      if (output.some((r) => r.id === call.id)) continue;
      const result =
        typeof call.result === 'string' &&
        call.result.length <= LIMITS.fieldText
          ? call.result
          : undefined;
      const row = {
        id: call.id,
        skillName: skill.name,
        path,
        category:
          path === skill.path
            ? ('instruction' as const)
            : ('reference' as const),
        ...(result !== undefined ? { result } : {}),
      };
      let kind: SkillRead['kind'] =
        call.status === 'pending' ? 'pending' : 'unknown';
      let empty: boolean | undefined;
      const limit = Object.hasOwn(call.args, 'limit') ? call.args.limit : 100,
        offset = Object.hasOwn(call.args, 'offset') ? call.args.offset : 0;
      if (
        ids.get(call.id) !== 1 ||
        (call.result !== undefined && result === undefined) ||
        !Number.isSafeInteger(limit) ||
        !Number.isSafeInteger(offset)
      )
        kind = 'unavailable';
      else if (ownedAuthority.kind === 'terminal') {
        const aiCalls = ownedAuthority.messages
          .flatMap((m) =>
            record(m) && m.type === 'ai' && Array.isArray(m.tool_calls)
              ? m.tool_calls
              : []
          )
          .filter((c) => record(c) && c.id === call.id);
        const results = ownedAuthority.messages.filter(
          (m) => record(m) && m.type === 'tool' && m.tool_call_id === call.id
        );
        const rawCall = aiCalls[0],
          rawResult = results[0];
        if (
          ownedAuthority.turn.owner !== index.owner ||
          ownedAuthority.turn.generation !== index.generation ||
          aiCalls.length !== 1 ||
          results.length !== 1 ||
          !record(rawCall) ||
          !record(rawResult) ||
          rawCall.name !== call.name ||
          !sameData(rawCall.args, call.args) ||
          rawResult.content !== result ||
          call.status !== 'complete'
        )
          kind = 'unavailable';
        else if (rawResult.status !== ownedAuthority.rawToolStatuses[call.id])
          kind = 'unavailable';
        else if (ownedAuthority.rawToolStatuses[call.id] === 'error')
          kind = 'error';
        else if (ownedAuthority.rawToolStatuses[call.id] === 'success') {
          if (
            !Number.isSafeInteger(limit) ||
            (limit as number) <= 0 ||
            !Number.isSafeInteger(offset) ||
            result === undefined ||
            !result ||
            NO_LINES.test(result)
          )
            kind = 'unavailable';
          else {
            kind =
              inspectedResult(result, path, offset as number) ?? 'unavailable';
            if (kind !== 'unavailable') empty = result === EMPTY;
          }
        }
      }
      strings.push(row.id, row.skillName, path, result ?? '');
      output.push(
        Object.freeze({
          ...row,
          kind,
          ...(empty !== undefined ? { empty } : {}),
        })
      );
    }
    displayUnits(strings);
    return Object.freeze(output);
  } catch {
    return { kind: 'unavailable' };
  }
}
