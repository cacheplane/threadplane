import type { JsonDocument } from './types.js';

export type Transition =
  | { readonly kind: 'noop' | 'replace' }
  | {
      readonly kind: 'append';
      readonly suffix: string;
      readonly finish: boolean;
    }
  | {
      readonly kind: 'violation';
      readonly reason:
        | 'complete-to-streaming'
        | 'post-completion-content-mutation'
        | 'content-shrink'
        | 'content-divergence';
    };

export function classify(prior: JsonDocument, next: JsonDocument): Transition {
  if (prior.generation !== next.generation) return { kind: 'replace' };
  if (prior.phase === next.phase && prior.content === next.content)
    return { kind: 'noop' };
  if (prior.phase === 'complete')
    return {
      kind: 'violation',
      reason:
        next.phase === 'streaming'
          ? 'complete-to-streaming'
          : 'post-completion-content-mutation',
    };
  if (next.content.length < prior.content.length)
    return { kind: 'violation', reason: 'content-shrink' };
  if (!next.content.startsWith(prior.content))
    return { kind: 'violation', reason: 'content-divergence' };
  return {
    kind: 'append',
    suffix: next.content.slice(prior.content.length),
    finish: next.phase === 'complete',
  };
}
