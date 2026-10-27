import type {
  AstNode,
  StreamState,
  StreamError,
} from '@cacheplane/json-stream';
import type { JsonNode, JsonError, JsonPartialValue } from './types.js';

function array<T>(values: T[], prior?: readonly T[]): readonly T[] {
  return prior &&
    prior.length === values.length &&
    values.every((value, index) => Object.is(value, prior[index]))
    ? prior
    : Object.freeze(values);
}
function record<T>(
  entries: readonly (readonly [string, T])[],
  prior?: Readonly<Record<string, T>>
): Readonly<Record<string, T>> {
  // fromEntries defines own data properties, including __proto__ and the empty key.
  const value: Record<string, T> = Object.fromEntries(entries);
  const keys = Object.keys(value),
    old = prior && Object.keys(prior);
  return prior &&
    old?.length === keys.length &&
    keys.every(
      (key, index) => old[index] === key && Object.is(prior[key], value[key])
    )
    ? prior
    : Object.freeze(value);
}

/** @internal Own the current canonical graph; no vendor values enter snapshots. */
export function createProjection() {
  const nodes = new Map<number, JsonNode>();
  const errors = new WeakMap<StreamError, JsonError>();
  return (state: StreamState) => {
    function project(node: AstNode): JsonNode {
      const cached = nodes.get(node.id);
      const prior = cached?.kind === node.kind ? cached : undefined;
      const base = { id: node.id, status: node.status };
      let next: JsonNode;
      switch (node.kind) {
        case 'array': {
          const old = prior?.kind === 'array' ? prior : undefined;
          // Even unchanged canonical parents may have newly completed children.
          const children = array(
            node.children.map((id) => project(state.nodes[id])),
            old?.children
          );
          const value = array(
            children.map((child) => child.value),
            old?.value
          );
          next = { ...base, kind: 'array', children, value };
          break;
        }
        case 'object': {
          const old = prior?.kind === 'object' ? prior : undefined;
          const children = record(
            node.children.map(
              (id, index) =>
                [node.keys[index], project(state.nodes[id])] as const
            ),
            old?.children
          );
          const value = record<JsonPartialValue>(
            Object.entries(children).map(
              ([key, child]) => [key, child.value] as const
            ),
            old?.value
          );
          next = { ...base, kind: 'object', children, value };
          break;
        }
        case 'string':
          next = {
            ...base,
            kind: 'string',
            buffer: node.buffer,
            value: node.value,
          };
          break;
        case 'number':
          next = {
            ...base,
            kind: 'number',
            buffer: node.buffer,
            value: node.value,
          };
          break;
        case 'boolean':
          next = { ...base, kind: 'boolean', value: node.value };
          break;
        case 'null':
          next = { ...base, kind: 'null', value: node.value };
          break;
      }
      const owned =
        prior &&
        Object.keys(next).every((key) =>
          Object.is(Reflect.get(next, key), Reflect.get(prior, key))
        )
          ? prior
          : Object.freeze(next);
      nodes.set(node.id, owned);
      return owned;
    }
    let error: JsonError | null = null;
    if (state.error) {
      error =
        errors.get(state.error) ??
        Object.freeze({
          code: state.error.code,
          message: state.error.message,
          index: state.error.index,
          line: state.error.line,
          column: state.error.column,
        });
      errors.set(state.error, error);
    }
    return {
      root: state.rootId === null ? null : project(state.nodes[state.rootId]),
      error,
      complete: state.complete && error === null,
    };
  };
}
