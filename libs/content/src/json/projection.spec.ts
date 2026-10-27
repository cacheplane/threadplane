import { create, push, finish } from '@cacheplane/json-stream';
import { describe, expect, it } from 'vitest';
import { createProjection } from './projection.js';

describe('owned JSON projection', () => {
  it('owns recursively frozen nodes and values without freezing parser storage', () => {
    const state = finish(
      push(create(), '{"__proto__":{"values":[true,null,-0,"text"]}}')
    );
    const result = createProjection()(state);
    const root = result.root;
    if (root?.kind !== 'object') throw new Error('object expected');
    const proto = root.children.__proto__;
    if (proto.kind !== 'object') throw new Error('nested object expected');
    const values = proto.children.values;
    if (values.kind !== 'array') throw new Error('array expected');
    expect(root).not.toBe(state.nodes[0]);
    expect(root.value).not.toBe(state.nodes[0].value);
    expect(values.value).not.toBe(state.nodes[2].value);
    expect(Object.isFrozen(state.nodes[0].value)).toBe(false);
    for (const node of values.children) {
      expect(Object.isFrozen(node)).toBe(true);
      expect(Reflect.set(node, 'status', 'incomplete')).toBe(false);
    }
    expect(Object.is(values.value[2], -0)).toBe(true);
    expect(Reflect.set(values.value, '0', false)).toBe(false);
    expect(Reflect.set(proto.value, 'values', [])).toBe(false);
    expect(Reflect.set(proto.children, 'values', values)).toBe(false);
  });
  it('traverses changed descendants even when canonical parent identity is retained', () => {
    const project = createProjection();
    const before = push(create(), '{"child":{"value":1 ');
    const first = project(before);
    const after = push(before, '}');
    expect(after.nodes[0]).toBe(before.nodes[0]);
    const second = project(after);
    if (first.root?.kind !== 'object' || second.root?.kind !== 'object')
      throw new Error('object expected');
    expect(second.root).not.toBe(first.root);
    expect(second.root.children.child.status).toBe('complete');
    expect(first.root.children.child.status).toBe('incomplete');
    expect(second.root.value).toBe(first.root.value);
    expect(project(after).root).toBe(second.root);
  });
  it('owns and reuses terminal diagnostics without exposing the vendor error', () => {
    const project = createProjection();
    const state = push(create(), '\ntrue x');
    const result = project(state);
    expect(result.error).toEqual(state.error);
    expect(result.error).not.toBe(state.error);
    expect(result.error).toMatchObject({
      code: 'TRAILING_CONTENT',
      index: 6,
      line: 2,
      column: 6,
    });
    expect(Object.isFrozen(state.error)).toBe(false);
    expect(project(push(state, 'ignored')).error).toBe(result.error);
    expect(Reflect.set(result.error as object, 'code', 'INVALID_SYNTAX')).toBe(
      false
    );
  });
});
