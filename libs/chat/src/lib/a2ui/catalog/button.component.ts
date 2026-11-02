import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import type { Spec } from '@json-render/core';
import { RenderElementComponent } from '@threadplane/render';

type ButtonVariant = 'default' | 'primary' | 'borderless';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  default: 'a2ui-btn a2ui-btn--default',
  primary: 'a2ui-btn a2ui-btn--primary',
  borderless: 'a2ui-btn a2ui-btn--borderless',
};

/** Renders A2UI child content as a styled button and forwards clicks to the render event handler. */
@Component({
  selector: 'a2ui-button',
  standalone: true,
  imports: [RenderElementComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      [class]="cssClass()"
      [disabled]="disabled()"
      (click)="handleClick()"
    >
      @for (key of childKeys(); track key) {
        <render-element [elementKey]="key" [spec]="spec()" />
      }
    </button>
  `,
  styles: [`
    .a2ui-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: var(--a2ui-spacing-2) var(--a2ui-spacing-4);
      border-radius: var(--a2ui-shape-small);
      font-size: var(--a2ui-typography-body-size);
      font-weight: 500;
      cursor: pointer;
      transition: background var(--a2ui-motion-duration-short) var(--a2ui-motion-easing-standard),
                  opacity var(--a2ui-motion-duration-short) var(--a2ui-motion-easing-standard);
      border: none;
    }
    .a2ui-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .a2ui-btn--primary {
      background: var(--a2ui-primary);
      color: var(--a2ui-on-primary);
    }
    .a2ui-btn--primary:hover:not(:disabled) { background: var(--a2ui-primary-hover); }
    .a2ui-btn--default {
      background: var(--a2ui-surface-variant);
      color: var(--a2ui-on-surface);
      border: 1px solid var(--a2ui-outline);
    }
    .a2ui-btn--default:hover:not(:disabled) { background: var(--a2ui-outline); }
    .a2ui-btn--borderless {
      background: transparent;
      color: var(--a2ui-on-surface);
      border: none;
    }
    .a2ui-btn--borderless:hover:not(:disabled) { background: var(--a2ui-surface-variant); }
  `],
})
export class A2uiButtonComponent {
  /** v0.9: child Text component is rendered inside the button via childKeys. */
  readonly childKeys = input<string[]>([]);
  readonly spec = input.required<Spec>();
  /** v0.9 prop: visual style (default 'default'). */
  readonly variant = input<ButtonVariant>('default');
  readonly disabled = input<boolean>(false);
  readonly emit = input<(event: string) => void>(() => { /* noop */ });
  // Framework inputs required by the render harness.
  readonly bindings = input<Record<string, string>>({});
  readonly loading = input<boolean>(false);

  protected cssClass(): string {
    return VARIANT_CLASS[this.variant()] ?? VARIANT_CLASS['default'];
  }

  handleClick(): void {
    this.emit()('click');
  }
}
