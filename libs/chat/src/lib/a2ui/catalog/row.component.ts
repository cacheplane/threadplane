import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Spec } from '@json-render/core';
import { RenderElementComponent } from '@threadplane/render';

type RowAlign = 'start' | 'center' | 'end' | 'stretch';
type RowJustify = 'start' | 'center' | 'end' | 'spaceAround' | 'spaceBetween' | 'spaceEvenly' | 'stretch';

const ALIGN_MAP: Record<RowAlign, string> = {
  start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch',
};

/** justify 'stretch' has no justify-content equivalent — children grow instead
 * (see the --justify-stretch class below). */
const JUSTIFY_MAP: Record<RowJustify, string> = {
  start: 'flex-start', center: 'center', end: 'flex-end',
  spaceAround: 'space-around', spaceBetween: 'space-between',
  spaceEvenly: 'space-evenly', stretch: 'normal',
};

/** Arranges A2UI child elements horizontally with configurable alignment, distribution, and spacing. */
@Component({
  selector: 'a2ui-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Default,
  imports: [RenderElementComponent],
  template: `
    <div
      [class]="cssClass()"
      [style.align-items]="alignItems()"
      [style.justify-content]="justifyContent()"
      [style.gap.px]="gapPx()"
    >
      @for (key of childKeys(); track key) {
        <render-element [elementKey]="key" [spec]="spec()" />
      }
    </div>
  `,
  styles: [`
    .a2ui-row {
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
      gap: var(--a2ui-spacing-3);
    }
    .a2ui-row--justify-stretch > render-element {
      flex: 1;
    }
  `],
})
export class A2uiRowComponent {
  readonly childKeys = input<string[]>([]);
  readonly spec = input.required<Spec>();
  /** v0.9 prop: cross-axis alignment (default 'stretch'). */
  readonly align = input<RowAlign>('stretch');
  /** v0.9 prop: main-axis distribution (default 'start'). */
  readonly justify = input<RowJustify>('start');
  /** Not part of the v0.9 catalog — kept for json-render generative-ui
   * specs, which may set a numeric spacing unit (multiples of 4px) or a
   * named size. Unset falls back to the CSS default gap. */
  readonly gap = input<number | 'small' | 'medium' | 'large' | undefined>(undefined);
  // Framework inputs required by the render harness.
  readonly bindings = input<Record<string, string>>({});
  readonly emit = input<(event: string) => void>(() => { /* noop */ });
  readonly loading = input<boolean>(false);

  protected readonly alignItems = computed(() => ALIGN_MAP[this.align()] ?? 'stretch');
  protected readonly justifyContent = computed(() => JUSTIFY_MAP[this.justify()] ?? 'flex-start');
  protected readonly cssClass = computed(() =>
    this.justify() === 'stretch' ? 'a2ui-row a2ui-row--justify-stretch' : 'a2ui-row',
  );
  protected readonly gapPx = computed(() => {
    const g = this.gap();
    if (typeof g === 'number' && Number.isFinite(g)) return g * 4;
    if (g === 'small') return 8;
    if (g === 'medium') return 12;
    if (g === 'large') return 16;
    return null;
  });
}
