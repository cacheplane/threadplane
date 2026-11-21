import type { A2uiComponent } from '@threadplane/a2ui';

// `[^{}]` (no nested braces) + a length bound keep the scan linear on
// adversarial LLM-authored strings (CodeQL js/polynomial-redos).
const REF_PATTERN = /\{(\$\.[^{}]{1,512})\}/g;

function walk(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    let m: RegExpExecArray | null;
    REF_PATTERN.lastIndex = 0;
    while ((m = REF_PATTERN.exec(value)) !== null) into.add(m[1]);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) walk(v, into);
    return;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) walk(v, into);
  }
}

/** Extracts the set of data-model paths (e.g. `$.form.name`) referenced
 * by `{$.path}` expressions inside a component's props. Result is
 * deduplicated and sorted for stable signal identity. */
export function extractBindings(component: A2uiComponent): readonly string[] {
  const out = new Set<string>();
  walk(component, out);
  return [...out].sort();
}
