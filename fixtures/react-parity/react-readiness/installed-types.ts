import { createRenderState } from '@threadplane/content/render-state';
import { useAgent } from '@threadplane/react';
import {
  RenderSpec,
  type RenderReadinessEntry,
  type RenderValue,
  type RenderViewProps,
} from '@threadplane/react/render';
import type { ComponentType } from 'react';
declare const View: ComponentType<RenderViewProps>;
export const entry: RenderReadinessEntry = {
  kind: 'readiness',
  component: View,
  isReady: (props) => props['value'] !== undefined,
  fallback: View,
};
declare const resolved: Parameters<RenderReadinessEntry['isReady']>[0];
// @ts-expect-error admission receives readonly resolved data
resolved['value'] = true;
export const asyncEntry: RenderReadinessEntry = {
  kind: 'readiness',
  component: View,
  // @ts-expect-error only synchronous booleans are allowed
  isReady: async () => true,
};
// @ts-expect-error descriptor contracts are readonly
entry.component = View;
export type ResolvedValue = RenderValue;
export const owner = createRenderState({ value: 'complete' });
export const publicEntries = { RenderSpec, useAgent };
