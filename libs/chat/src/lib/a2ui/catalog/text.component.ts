import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { Spec } from '@json-render/core';

type TextVariant = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'caption' | 'body';

/** Renders A2UI text using the selected typography variant. */
@Component({
  selector: 'a2ui-text',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Default,
  template: `<span [class]="cssClass()">{{ text() }}</span>`,
  styles: [`
    .a2ui-text-h1 {
      display: block;
      font-size: var(--a2ui-typography-h1-size);
      font-weight: var(--a2ui-typography-h1-weight);
      line-height: var(--a2ui-typography-h1-line-height);
      margin: 0;
    }
    .a2ui-text-h2 {
      display: block;
      font-size: var(--a2ui-typography-h2-size);
      font-weight: var(--a2ui-typography-h2-weight);
      line-height: var(--a2ui-typography-h2-line-height);
      margin: 0;
    }
    .a2ui-text-h3 {
      display: block;
      font-size: var(--a2ui-typography-h3-size);
      font-weight: var(--a2ui-typography-h3-weight);
      line-height: var(--a2ui-typography-h3-line-height);
      margin: 0;
    }
    .a2ui-text-h4 {
      display: block;
      font-size: var(--a2ui-typography-h4-size);
      font-weight: var(--a2ui-typography-h4-weight);
      line-height: var(--a2ui-typography-h4-line-height);
      margin: 0;
    }
    .a2ui-text-h5 {
      display: block;
      font-size: var(--a2ui-typography-h5-size);
      font-weight: var(--a2ui-typography-h5-weight);
      line-height: var(--a2ui-typography-h5-line-height);
      margin: 0;
    }
    .a2ui-text-caption {
      display: block;
      font-size: var(--a2ui-typography-caption-size);
      font-weight: var(--a2ui-typography-caption-weight);
      color: var(--a2ui-caption);
      line-height: var(--a2ui-typography-caption-line-height);
    }
    .a2ui-text-body {
      display: block;
      font-size: var(--a2ui-typography-body-size);
      font-weight: var(--a2ui-typography-body-weight);
      line-height: var(--a2ui-typography-body-line-height);
    }
  `],
})
export class A2uiTextComponent {
  readonly text = input<string>('');
  /** v0.9 prop: typography variant. */
  readonly variant = input<TextVariant>('body');
  // Framework-mandated inputs the render harness passes to every element.
  readonly bindings = input<Record<string, string>>({});
  readonly emit = input<(event: string) => void>(() => { /* noop */ });
  readonly loading = input<boolean>(false);
  readonly childKeys = input<string[]>([]);
  readonly spec = input<Spec | undefined>(undefined);

  protected cssClass(): string {
    return `a2ui-text-${this.variant()}`;
  }
}
