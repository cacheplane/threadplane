import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Spec } from '@json-render/core';

/**
 * Convert an icon identifier to its Material Symbols ligature form.
 *
 * Material Symbols ligatures are snake_case (`account_circle`, `trending_up`),
 * but A2UI catalogs commonly emit camelCase identifiers (`accountCircle`,
 * `shoppingCart`). Splitting on lower→upper boundaries and lowercasing maps
 * camelCase → the matching ligature. Already-snake_case names, single words,
 * and non-identifier glyphs (emoji) have no boundaries to split and pass
 * through unchanged. Unknown names still fall back to the browser default.
 */
export function toMaterialSymbolName(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/** Renders an A2UI icon from a Material Symbols name or an inline SVG path. */
@Component({
  selector: 'a2ui-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Default,
  template: `
    @if (svgPath(); as path) {
      <svg
        class="a2ui-icon a2ui-icon--svg"
        viewBox="0 -960 960 960"
        fill="currentColor"
        role="img"
        aria-hidden="true"
      ><path [attr.d]="path" /></svg>
    } @else if (ligatureName(); as name) {
      <span
        class="a2ui-icon material-symbols-outlined"
        [attr.aria-label]="name"
        role="img"
      >{{ glyphName() }}</span>
    }
  `,
  styles: [`
    /* Renders Material Symbols by ligature name (A2UI's canonical icon set).
       Relies only on the Material Symbols Outlined @font-face being present —
       host apps load the stylesheet (see README). Unknown / not-yet-loaded
       names fall back to the browser default glyph. */
    .a2ui-icon {
      font-family: 'Material Symbols Outlined';
      font-weight: normal;
      font-style: normal;
      font-size: 1.125rem;
      line-height: 1;
      letter-spacing: normal;
      text-transform: none;
      white-space: nowrap;
      word-wrap: normal;
      direction: ltr;
      font-feature-settings: 'liga';
      -webkit-font-feature-settings: 'liga';
      -webkit-font-smoothing: antialiased;
      font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
      color: currentColor;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      user-select: none;
    }
    .a2ui-icon--svg {
      width: 1.125rem;
      height: 1.125rem;
    }
  `],
})
export class A2uiIconComponent {
  /** v0.9 prop: a Material Symbols name (string) or an inline `{ svgPath }`. */
  readonly name = input<string | { svgPath: string } | undefined>(undefined);
  // Framework inputs required by the render harness.
  readonly bindings = input<Record<string, string>>({});
  readonly emit = input<(event: string) => void>(() => { /* noop */ });
  readonly loading = input<boolean>(false);
  readonly childKeys = input<string[]>([]);
  readonly spec = input<Spec | undefined>(undefined);

  /** Inline SVG path when `name` is the `{ svgPath }` object form. */
  protected readonly svgPath = computed<string | null>(() => {
    const n = this.name();
    return typeof n === 'object' && n !== null && typeof n.svgPath === 'string'
      ? n.svgPath
      : null;
  });

  /** The string ligature name when `name` is a string. */
  protected readonly ligatureName = computed<string>(() =>
    typeof this.name() === 'string' ? (this.name() as string) : '',
  );

  /** The effective name as a Material Symbols ligature (camelCase → snake_case). */
  protected readonly glyphName = computed(() => toMaterialSymbolName(this.ligatureName()));
}
