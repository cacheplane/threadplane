import { createRenderState, type RenderState, type RenderStateValue, type RenderStateSnapshot, type RenderStateChange } from '@threadplane/content/render-state';
import type { StateStore } from '@json-render/core';

const owner: RenderState = createRenderState({ profile: { name: 'Ada' }, values: [1] });
// This is the actual pinned SDK interface, not a local approximation.
const sdk: StateStore = owner;
sdk.get('/profile/name');
sdk.set('/profile/name', 'Grace');
sdk.update({ '/values': [2] });
sdk.getSnapshot();
const release = sdk.subscribe(() => owner.lastChange());
release();
const snapshot: RenderStateSnapshot = owner.getSnapshot();
const value: RenderStateValue = owner.get('/profile');
const change: RenderStateChange | undefined = owner.lastChange();
// @ts-expect-error Snapshot records are readonly.
snapshot.profile = {};
if (value && typeof value === 'object' && !Array.isArray(value)) {
  // @ts-expect-error Nested values are readonly.
  value.name = 'changed';
}
const values: Extract<RenderStateValue, readonly unknown[]> = [1, { name: 'Ada' }];
// @ts-expect-error The public value union itself supplies readonly arrays.
values.push(3);
if (change) {
  // @ts-expect-error Change metadata is readonly.
  change.path = '/other';
}
// @ts-expect-error Owner commands cannot be replaced by consumers.
owner.set = () => undefined;
owner.dispose();
