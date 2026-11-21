// libs/angular/chat/src/lib/markdown/katex-loader.ts
import {
  Injectable,
  InjectionToken,
  inject,
  makeEnvironmentProviders,
  signal,
  type EnvironmentProviders,
} from '@angular/core';

/** The part of KaTeX the math view uses. */
export interface ChatMathModule {
  renderToString(
    latex: string,
    options: { displayMode: boolean; throwOnError: boolean }
  ): string;
}

/**
 * Loads KaTeX, usually `() => import('katex')`. The application supplies it,
 * so the chat library never names `katex`: an application that does not
 * render math installs and bundles nothing for it, and its development server
 * never has to resolve the package.
 */
export type ChatMathLoader = () => Promise<
  ChatMathModule | { default: ChatMathModule }
>;

const CHAT_MATH_LOADER = new InjectionToken<ChatMathLoader>('CHAT_MATH_LOADER');

/**
 * Turns on LaTeX math in chat markdown: inline `$…$` / `\(…\)` and display
 * `$$…$$` / `\[…\]`. Without it, math shows as its raw source.
 *
 * The loader runs the first time a message contains math, so chats that never
 * do download nothing. The KaTeX stylesheet is the application's to include
 * (`katex/dist/katex.min.css`); math renders without it, unstyled.
 *
 * ```ts
 * provideChatMath(() => import('katex'))
 * ```
 */
export function provideChatMath(load: ChatMathLoader): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: CHAT_MATH_LOADER, useValue: load },
  ]);
}

/**
 * Renders LaTeX with the application's KaTeX. `render` returns the KaTeX HTML
 * string, or null when math is not provided, KaTeX has not loaded yet or failed
 * to, or the LaTeX is invalid: the view then renders the raw `$…$` source.
 */
@Injectable({ providedIn: 'root' })
export class ChatMathRenderer {
  private readonly load = inject(CHAT_MATH_LOADER, { optional: true });
  private katex: ChatMathModule | null = null;
  private loading: Promise<void> | undefined;

  /**
   * Flips to true once KaTeX has loaded. The math view reads it as a signal
   * dependency, so math that fell back to raw source while KaTeX was loading
   * re-renders once it is available.
   */
  readonly ready = signal(false);

  /** Starts the load once and resolves when it has settled. Tests await it. */
  loaded(): Promise<void> {
    const load = this.load;
    if (!load) return Promise.resolve();
    return (this.loading ??= load()
      .then((m) => {
        this.katex = 'default' in m ? m.default : m;
        this.ready.set(true);
      })
      .catch(() => {
        this.katex = null;
      }));
  }

  render(latex: string, displayMode: boolean): string | null {
    if (!this.katex) {
      // The first math starts the load; `ready` re-renders it after.
      void this.loaded();
      return null;
    }
    try {
      // throwOnError:true so invalid LaTeX throws, and the view falls back to
      // the raw source instead of KaTeX's own red error markup.
      return this.katex.renderToString(latex, {
        displayMode,
        throwOnError: true,
      });
    } catch {
      return null;
    }
  }
}
