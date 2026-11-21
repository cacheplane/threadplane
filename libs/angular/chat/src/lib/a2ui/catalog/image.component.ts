import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Spec } from '@json-render/core';

/** v0.9 fit values; 'scaleDown' maps to CSS object-fit: scale-down. */
type ImageFit = 'contain' | 'cover' | 'fill' | 'none' | 'scaleDown';

/** v0.9 variant maps to a sizing preset class. */
type ImageVariant = 'icon' | 'avatar' | 'smallFeature' | 'mediumFeature' | 'largeFeature' | 'header';

const FIT_MAP: Record<ImageFit, string> = {
  contain: 'contain',
  cover: 'cover',
  fill: 'fill',
  none: 'none',
  scaleDown: 'scale-down',
};

/** Renders an A2UI image with a description, sizing preset, and object-fit behavior. */
@Component({
  selector: 'a2ui-image',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Default,
  template: `
    <img
      [class]="cssClass()"
      [src]="url()"
      [alt]="description()"
      [style.object-fit]="objectFit()"
    />
  `,
  styles: [`
    .a2ui-img {
      display: block;
      max-width: 100%;
      border-radius: var(--a2ui-shape-extra-small);
    }
    .a2ui-img--icon {
      width: 24px;
      height: 24px;
    }
    .a2ui-img--avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
    }
    .a2ui-img--smallFeature {
      width: 120px;
    }
    .a2ui-img--mediumFeature {
      width: 240px;
    }
    .a2ui-img--largeFeature {
      width: 400px;
    }
    .a2ui-img--header {
      width: 100%;
      aspect-ratio: 16 / 5;
    }
  `],
})
export class A2uiImageComponent {
  readonly url = input<string>('');
  /** v0.9 prop: alt text / accessible description. */
  readonly description = input<string>('');
  /** v0.9 prop: CSS object-fit equivalent ('scaleDown' → 'scale-down'). */
  readonly fit = input<ImageFit>('fill');
  /** v0.9 prop: sizing preset. */
  readonly variant = input<ImageVariant>('mediumFeature');
  // Framework inputs required by the render harness.
  readonly bindings = input<Record<string, string>>({});
  readonly emit = input<(event: string) => void>(() => { /* noop */ });
  readonly loading = input<boolean>(false);
  readonly childKeys = input<string[]>([]);
  readonly spec = input<Spec | undefined>(undefined);

  protected readonly objectFit = computed(() => FIT_MAP[this.fit()] ?? 'fill');
  protected readonly cssClass = computed(() => `a2ui-img a2ui-img--${this.variant()}`);
}
