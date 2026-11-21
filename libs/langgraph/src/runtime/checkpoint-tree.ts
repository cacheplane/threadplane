import type { ThreadState } from '@langchain/langgraph-sdk';
import type {
  AgentCheckpoint,
  DeepReadonly,
  PlainValue,
} from '@threadplane/core';
import type { LangGraphState } from './langgraph-snapshot.js';
import { ownValue, ownValueWithSharing } from './ownership.js';
import { record, roleOf } from './wire-message.js';

/**
 * One saved checkpoint of a loaded history page, with the state it holds: the
 * core contract's checkpoint, with the LangGraph record alongside.
 */
export interface LangGraphCheckpoint extends AgentCheckpoint {
  /** The checkpoint id; undefined when the backend sent none. */
  readonly id: string | undefined;
  /** The first node the checkpoint would run next; undefined at the end. */
  readonly label: string | undefined;
  /** The graph state the checkpoint saved, `messages` included. */
  readonly values: LangGraphState;
  /** The checkpoint as the backend sent it. */
  readonly saved: DeepReadonly<ThreadState>;
}

/** One checkpoint in a branch tree, with the fork choices that lead to it. */
export interface LangGraphBranchNode {
  /** Always `'node'`. */
  readonly type: 'node';
  /** The checkpoint at this position. */
  readonly value: LangGraphCheckpoint;
  /** The fork choices that lead here: one checkpoint id for each fork passed. */
  readonly path: readonly string[];
}
/** A point in a branch tree where the history splits into alternatives. */
export interface LangGraphBranchFork {
  /** Always `'fork'`. */
  readonly type: 'fork';
  /** The alternative continuations, oldest first: the last is the newest. */
  readonly items: readonly LangGraphBranchTree[];
}
/** A history page as a tree: a run of checkpoints, splitting where a
 * checkpoint has several children. */
export interface LangGraphBranchTree {
  /** Always `'sequence'`. */
  readonly type: 'sequence';
  /** The checkpoints and forks of this run, oldest first. */
  readonly items: readonly (LangGraphBranchNode | LangGraphBranchFork)[];
}

/** Owns a whole history page, newest first as received, reusing every part
 * that equals the previous page. Unlike `projectCheckpointHistory` this reads
 * and retains each checkpoint's state, so a session only does it on request. */
export function projectCheckpoints(
  previous: readonly LangGraphCheckpoint[] | undefined,
  history: readonly ThreadState[]
): readonly LangGraphCheckpoint[] {
  return ownValueWithSharing(
    history.map((saved) => {
      const next = saved.next;
      const id = saved.checkpoint?.checkpoint_id;
      return {
        id: typeof id === 'string' ? id : undefined,
        label:
          Array.isArray(next) && typeof next[0] === 'string'
            ? next[0]
            : undefined,
        values: record(saved.values) ?? {},
        saved,
      };
    }) as unknown as PlainValue,
    previous as unknown as PlainValue
  ) as unknown as readonly LangGraphCheckpoint[];
}

/**
 * Pairs each assistant message id with the newest checkpoint whose state ends
 * its assistant messages with that message. Checkpoints without an id are
 * skipped.
 */
export function projectMessageCheckpoints(
  checkpoints: readonly LangGraphCheckpoint[]
): Readonly<Record<string, string>> {
  const found = new Map<string, string>();
  for (let index = checkpoints.length - 1; index >= 0; index -= 1) {
    const { id, values } = checkpoints[index];
    if (!id) continue;
    const messages = values['messages'];
    if (!Array.isArray(messages)) continue;
    for (let at = messages.length - 1; at >= 0; at -= 1) {
      const message = record(messages[at]);
      if (
        message &&
        roleOf(message) === 'assistant' &&
        typeof message['id'] === 'string'
      ) {
        found.set(message['id'], id);
        break;
      }
    }
  }
  return ownValue(Object.fromEntries(found)) as Readonly<
    Record<string, string>
  >;
}

const ROOT = '$';

/** Builds the branch tree of a history page from each checkpoint's parent. A
 * page that starts mid-thread is rooted at the parent with the newest
 * descendant. */
export function projectBranchTree(
  checkpoints: readonly LangGraphCheckpoint[]
): LangGraphBranchTree {
  type Sequence = { type: 'sequence'; items: (LangGraphBranchNode | Fork)[] };
  type Fork = { type: 'fork'; items: Sequence[] };
  const root: Sequence = { type: 'sequence', items: [] };
  if (checkpoints.length <= 1) {
    root.items = checkpoints.map((value) => ({
      type: 'node',
      value,
      path: [],
    }));
    return ownValue(
      root as unknown as PlainValue
    ) as unknown as LangGraphBranchTree;
  }
  const ids = new Set<string>();
  const children = new Map<string, LangGraphCheckpoint[]>();
  for (const checkpoint of checkpoints) {
    const parent = checkpoint.saved.parent_checkpoint?.checkpoint_id ?? ROOT;
    const siblings = children.get(parent) ?? [];
    siblings.push(checkpoint);
    children.set(parent, siblings);
    if (checkpoint.id !== undefined) ids.add(checkpoint.id);
  }
  if (!children.has(ROOT)) {
    const latestUnder = (parent: string) => {
      const pending = [parent];
      const seen = new Set<string>();
      let latest = parent;
      while (pending.length) {
        const current = pending.shift() as string;
        if (seen.has(current)) continue;
        seen.add(current);
        for (const child of children.get(current) ?? []) {
          if (child.id === undefined) continue;
          if (child.id.localeCompare(latest) > 0) latest = child.id;
          pending.push(child.id);
        }
      }
      return latest;
    };
    const orphan = [...children.keys()]
      .filter((parent) => !ids.has(parent))
      .map((parent) => ({ parent, latest: latestUnder(parent) }))
      .sort((left, right) => left.latest.localeCompare(right.latest))
      .at(-1)?.parent;
    if (orphan !== undefined)
      children.set(ROOT, children.get(orphan) as LangGraphCheckpoint[]);
  }
  const pending: { id: string; sequence: Sequence; path: string[] }[] = [
    { id: ROOT, sequence: root, path: [] },
  ];
  const visited = new Set<string>();
  while (pending.length) {
    const task = pending.shift() as (typeof pending)[number];
    if (visited.has(task.id)) continue;
    visited.add(task.id);
    const next = children.get(task.id);
    if (!next?.length) continue;
    let fork: Fork | undefined;
    if (next.length > 1) {
      fork = { type: 'fork', items: [] };
      task.sequence.items.push(fork);
    }
    for (const value of next) {
      if (value.id === undefined) continue;
      let sequence = task.sequence;
      let path = task.path;
      if (fork) {
        sequence = { type: 'sequence', items: [] };
        fork.items.unshift(sequence);
        path = [...task.path, value.id];
      }
      sequence.items.push({ type: 'node', value, path });
      pending.push({ id: value.id, sequence, path });
    }
  }
  return ownValue(
    root as unknown as PlainValue
  ) as unknown as LangGraphBranchTree;
}

/**
 * The checkpoints a branch shows, oldest first. `branch` is the fork choices
 * joined with `>`, as in a node's `path`. At a fork the branch does not name,
 * the newest continuation is followed.
 */
export function selectBranch(
  tree: LangGraphBranchTree,
  branch = ''
): readonly LangGraphCheckpoint[] {
  const chosen = branch ? branch.split('>') : [];
  const result: LangGraphCheckpoint[] = [];
  let sequence: LangGraphBranchTree | undefined = tree;
  let depth = 0;
  while (sequence) {
    let next: LangGraphBranchTree | undefined;
    for (const item of sequence.items) {
      if (item.type === 'node') {
        result.push(item.value);
        continue;
      }
      const first = (candidate: LangGraphBranchTree) => {
        const node = candidate.items[0];
        return node?.type === 'node' ? node.value.id : undefined;
      };
      // Alternatives are listed oldest first, so the last is the newest.
      next =
        item.items.find((candidate) => first(candidate) === chosen[depth]) ??
        item.items[item.items.length - 1];
      depth += 1;
      break;
    }
    sequence = next;
  }
  return result;
}
