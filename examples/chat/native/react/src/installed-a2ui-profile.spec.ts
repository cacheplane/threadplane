import assert from 'node:assert/strict';
import test from 'node:test';
import type { A2uiMessage } from '@threadplane/a2ui';
import { createA2uiSurfaces } from '@threadplane/content/a2ui';

test('selected installed native A2UI profile exposes the published pure surfaces owner', () => {
  const owner = createA2uiSurfaces();
  // The installed protocol constrains the owner without loading protocol JS.
  const apply: (message: A2uiMessage) => void = owner.apply;
  assert.equal(typeof apply, 'function');
  assert.deepEqual(owner.getSnapshot(), { surfaces: [] });
  owner.dispose();
});
