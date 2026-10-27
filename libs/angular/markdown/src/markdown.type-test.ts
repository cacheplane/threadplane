import type { InputSignal } from '@angular/core';
import type { MarkdownSnapshot } from '@threadplane/content/markdown';
import { MarkdownComponent } from './public-api';

type Input = MarkdownComponent['snapshot'] extends InputSignal<infer T>
  ? T
  : never;
export function markdownContracts(snapshot: MarkdownSnapshot) {
  const accepted: Input = snapshot;
  // @ts-expect-error Raw strings are not accepted snapshots.
  const raw: Input = 'text';
  // @ts-expect-error Generation and phase are required together with root.
  const partial: Input = { root: null };
  // @ts-expect-error The accepted document is readonly.
  accepted.document.content = 'changed';
  if (accepted.root) {
    // @ts-expect-error Nested children remain readonly.
    accepted.root.children.push(accepted.root.children[0]);
    // @ts-expect-error Definitions are readonly maps.
    accepted.root.linkDefinitions.clear();
    const definition = accepted.root.citations.get('source');
    if (definition) {
      // @ts-expect-error Definition values are deeply readonly.
      definition.children[0].status = 'complete';
    }
  }
  return [accepted, raw, partial];
}
