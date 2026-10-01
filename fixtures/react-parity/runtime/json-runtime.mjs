import assert from 'node:assert/strict';
import { createJson } from '@threadplane/content/json';

const doc = (content, phase = 'streaming', generation = 'a') => ({ content, phase, generation });
for (const text of ['{"":1,"__proto__":{"value":2}}', '{"__proto__":null,"__proto__":[true,null]}']) {
  for (let split = 0; split <= text.length; split++) {
    const owner = createJson(doc(text.slice(0, split)));
    const first = owner.getSnapshot();
    let notifications = 0;
    const release = owner.subscribe(() => notifications++);
    owner.update(doc(text, 'complete'));
    const snapshot = owner.getSnapshot();
    assert.equal(snapshot.error, null);
    assert.equal(snapshot.complete, true);
    assert.deepEqual(snapshot.root.value, JSON.parse(text));
    assert.equal(Object.getPrototypeOf(snapshot.root.value), Object.prototype);
    assert.equal(Object.hasOwn(snapshot.root.value, '__proto__'), true);
    assert.equal(Reflect.set(snapshot.root.value, 'injected', true), false);
    assert.equal(Reflect.set(snapshot.root.children, 'injected', snapshot.root), false);
    assert.equal(first.document.content, text.slice(0, split));
    owner.update(doc(text, 'complete'));
    assert.equal(owner.getSnapshot(), snapshot);
    assert.equal(notifications, 1);
    release(); owner.dispose(); owner.dispose();
    assert.equal(owner.getSnapshot(), snapshot);
    assert.throws(() => owner.update(doc('null')), /disposed/);
  }
}
const owner = createJson(doc('{"stable":[1],"child":{"value":1 '));
const before = owner.getSnapshot();
owner.update(doc('{"stable":[1],"child":{"value":1 }'));
const after = owner.getSnapshot();
assert.equal(before.root.children.child.status, 'incomplete');
assert.equal(after.root.children.child.status, 'complete');
assert.equal(after.root.children.stable, before.root.children.stable);
assert.equal(after.root.value, before.root.value);
assert.equal(Reflect.set(after.root.children.stable.value, '0', 8), false);
owner.dispose();
for (const text of ['', '-', '1e+', '"open', '{"a":1']) {
  const owner = createJson(doc(text, 'complete'));
  assert.equal(owner.getSnapshot().error.code, 'UNEXPECTED_END');
  assert.equal(owner.getSnapshot().complete, false);
  owner.dispose();
}
const partial = createJson(doc('t'));
assert.equal(partial.getSnapshot().root.value, undefined);
partial.update(doc('true x', 'complete'));
assert.equal(partial.getSnapshot().error.code, 'TRAILING_CONTENT');
partial.update(doc('null', 'complete', 'b'));
assert.equal(partial.getSnapshot().root.value, null);
assert.equal(partial.getSnapshot().complete, true);
partial.dispose();
console.log('Installed owned JSON runtime contract passed');
