// libs/angular/chat/src/lib/markdown/katex-loader.ts
import { signal } from '@angular/core';

/**
 * Lazy KaTeX integration for the markdown math view. Mirrors the lazy `marked`
 * loader in ../streaming/markdown-render.ts: `katex` is an optional peer
 * dependency, dynamically imported the first time math is rendered, so chats
 * that never contain math download nothing. `renderMath` returns the KaTeX HTML string,
 * or null when KaTeX is unavailable or the LaTeX is invalid — the view then
 * renders the raw `$…$` source instead.
 *
 * CSS: the KaTeX stylesheet (and its woff2 fonts) is the CONSUMER's
 * responsibility — this lib injects nothing at runtime (no third-party CDN
 * fetch). Apps import `katex/dist/katex.min.css` themselves; math still renders
 * without it, just unstyled.
 */

let katexRender: ((latex: string, displayMode: boolean) => string) | null =
  null;

/**
 * Flips to true once KaTeX has loaded. The math view reads it as a signal
 * dependency so any math that fell back to raw source while KaTeX was still
 * loading re-renders once it becomes available.
 */
export const katexReady = signal(false);

let katexLoading: Promise<void> | undefined;

/**
 * Starts the KaTeX import once and resolves when it has settled (success or
 * failure). `renderMath` calls it; tests await it.
 */
export function loadKatex(): Promise<void> {
  return (katexLoading ??= import('katex')
    .then((m) => {
      const katex = ((m as { default?: unknown }).default ?? m) as {
        renderToString: (latex: string, options: object) => string;
      };
      katexRender = (latex, displayMode) =>
        // throwOnError:true so invalid LaTeX throws → we catch → raw-source
        // fallback, instead of KaTeX emitting its own red error markup.
        katex.renderToString(latex, { displayMode, throwOnError: true });
      katexReady.set(true);
    })
    .catch(() => {
      katexRender = null;
    }));
}

/**
 * Render LaTeX to a KaTeX HTML string, or null if KaTeX is unavailable or the
 * input throws (invalid LaTeX) — the caller then renders the raw `$…$` source.
 */
export function renderMath(latex: string, displayMode: boolean): string | null {
  if (!katexRender) {
    // The first math starts the import; `katexReady` re-renders it after.
    void loadKatex();
    return null;
  }
  try {
    return katexRender(latex, displayMode);
  } catch {
    return null;
  }
}
