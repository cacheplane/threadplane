import { Component, computed, input, signal, ChangeDetectionStrategy } from '@angular/core';
import type { Spec } from '@json-render/core';
import { injectRenderHost } from '@threadplane/render';
import { emitBinding } from './emit-binding';

/** Resolved option shape — label and value are plain strings after surface-to-spec resolves them. */
interface ResolvedOption {
  label: string;
  value: string;
}

/** Renders single or multiple A2UI choices as chips or selection rows, with optional filtering. */
@Component({
  selector: 'a2ui-choice-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="a2ui-cp">
      @if (label()) {
        <span class="a2ui-cp__label">{{ label() }}</span>
      }

      @if (filterable()) {
        <input
          type="text"
          class="a2ui-cp__filter"
          placeholder="Filter options"
          [value]="filterText()"
          (input)="onFilterInput($event)"
        />
      }

      @if (displayStyle() === 'chips') {
        <!-- Chips: toggle buttons. -->
        <div class="a2ui-cp__chips">
          @for (opt of visibleOptions(); track opt.value) {
            <button
              type="button"
              [class]="isSelected(opt.value) ? 'a2ui-cp__chip a2ui-cp__chip--selected' : 'a2ui-cp__chip'"
              [attr.aria-pressed]="isSelected(opt.value)"
              (click)="onChipToggle(opt.value)"
            >{{ opt.label }}</button>
          }
        </div>
      } @else {
        <!-- Checkbox style: radio rows (mutuallyExclusive) or checkbox rows (multipleSelection). -->
        <div class="a2ui-cp__checks">
          @for (opt of visibleOptions(); track opt.value) {
            <label class="a2ui-cp__check-row">
              <input
                [type]="isSingleSelect() ? 'radio' : 'checkbox'"
                class="a2ui-cp__checkbox"
                [attr.name]="isSingleSelect() ? _groupName : null"
                [checked]="isSelected(opt.value)"
                (change)="onCheckChange(opt.value, $event)"
              />
              {{ opt.label }}
            </label>
          }
        </div>
      }
      @if (errorText()) {
      <div class="a2ui-check-error" role="alert">{{ errorText() }}</div>
    }
    </div>
  `,
  styles: [`
    .a2ui-cp { display: flex; flex-direction: column; gap: var(--a2ui-spacing-1); }
    .a2ui-cp__label {
      font-size: var(--a2ui-typography-label-size);
      font-weight: var(--a2ui-typography-label-weight);
      color: var(--a2ui-label);
    }
    .a2ui-cp__filter {
      padding: var(--a2ui-spacing-1) var(--a2ui-spacing-2);
      font-size: var(--a2ui-typography-caption-size);
      border-radius: var(--a2ui-shape-small);
      background: var(--a2ui-input-bg);
      color: var(--a2ui-on-surface);
      border: 1px solid var(--a2ui-outline);
      outline: none;
      transition: border-color var(--a2ui-motion-duration-short) var(--a2ui-motion-easing-standard);
    }
    .a2ui-cp__filter:focus {
      outline: var(--a2ui-focus-ring-width) solid var(--a2ui-focus-ring-color);
      outline-offset: 2px;
      border-color: var(--a2ui-primary);
    }
    .a2ui-cp__checks { display: flex; flex-direction: column; gap: var(--a2ui-spacing-2); }
    .a2ui-cp__check-row {
      display: flex;
      align-items: center;
      gap: var(--a2ui-spacing-2);
      font-size: var(--a2ui-typography-body-size);
      cursor: pointer;
    }
    .a2ui-cp__checkbox {
      width: 16px;
      height: 16px;
      border-radius: var(--a2ui-shape-extra-small);
      cursor: pointer;
      accent-color: var(--a2ui-primary);
    }
    .a2ui-cp__chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--a2ui-spacing-2);
    }
    .a2ui-cp__chip {
      padding: var(--a2ui-spacing-1) var(--a2ui-spacing-3);
      font-size: var(--a2ui-typography-body-size);
      border-radius: var(--a2ui-shape-large, 9999px);
      background: var(--a2ui-surface-variant);
      color: var(--a2ui-on-surface);
      border: 1px solid var(--a2ui-outline);
      cursor: pointer;
      transition: background var(--a2ui-motion-duration-short) var(--a2ui-motion-easing-standard),
                  border-color var(--a2ui-motion-duration-short) var(--a2ui-motion-easing-standard);
    }
    .a2ui-cp__chip--selected {
      background: var(--a2ui-primary);
      color: var(--a2ui-on-primary);
      border-color: var(--a2ui-primary);
    }
      .a2ui-check-error {
      font-size: var(--a2ui-typography-label-size);
      color: var(--a2ui-error, #d33d55);
    }
`],
})
export class A2uiChoicePickerComponent {
  private static _idCounter = 0;
  /** Groups the radio inputs of this instance (mutuallyExclusive mode). */
  protected readonly _groupName = `a2ui-choice-picker-${++A2uiChoicePickerComponent._idCounter}`;

  private readonly host = injectRenderHost();

  readonly label = input<string>('');
  /** v0.9 prop: current selection (string[]). Normalized in `valueArray`
   * because LLMs sometimes seed the data model with a scalar (e.g. `"5"`)
   * instead of an array (`["5"]`); we coerce so .includes() works either way. */
  readonly value = input<string | string[] | undefined>(undefined);
  /** Resolved options with plain string labels (surface-to-spec resolves DynamicString). */
  readonly options = input<ResolvedOption[]>([]);
  /** v0.9 prop: 'mutuallyExclusive' (single-select, default) or 'multipleSelection'. */
  readonly variant = input<'mutuallyExclusive' | 'multipleSelection'>('mutuallyExclusive');
  /** v0.9 prop: render as 'checkbox' rows (default) or 'chips'. */
  readonly displayStyle = input<'checkbox' | 'chips'>('checkbox');
  /** v0.9 prop: when true, show a client-side option filter input. */
  readonly filterable = input<boolean>(false);
  /** Live validation message written by the surface's check gate
   * (bound to /_a2uiChecks/<id>); empty when valid. */
  readonly errorText = input<string>('');
  readonly _bindings = input<Record<string, string>>({});
  // Framework inputs required by the render harness.
  readonly bindings = input<Record<string, string>>({});
  readonly loading = input<boolean>(false);
  readonly childKeys = input<string[]>([]);
  readonly spec = input<Spec | undefined>(undefined);

  protected readonly valueArray = computed<string[]>(() => {
    const v = this.value();
    if (Array.isArray(v)) return v;
    if (v == null || v === '') return [];
    return [String(v)];
  });

  protected readonly isSingleSelect = computed(() => this.variant() !== 'multipleSelection');

  /** Local, client-side option filter (only rendered when filterable). */
  protected readonly filterText = signal('');

  protected readonly visibleOptions = computed<ResolvedOption[]>(() => {
    const f = this.filterText().trim().toLowerCase();
    const opts = this.options();
    return f ? opts.filter(o => o.label.toLowerCase().includes(f)) : opts;
  });

  protected isSelected(value: string): boolean {
    return this.valueArray().includes(value);
  }

  onFilterInput(event: Event): void {
    this.filterText.set((event.target as HTMLInputElement).value);
  }

  onCheckChange(value: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    if (this.isSingleSelect()) {
      // Radio semantics: the chosen option replaces the selection. `value` is
      // a string list on the wire, so write a one-element array.
      if (checked) emitBinding(this.host, this._bindings(), 'value', [value]);
      return;
    }
    emitBinding(this.host, this._bindings(), 'value', this.toggled(value, checked));
  }

  onChipToggle(value: string): void {
    if (this.isSingleSelect()) {
      emitBinding(this.host, this._bindings(), 'value', [value]);
      return;
    }
    const checked = !this.isSelected(value);
    emitBinding(this.host, this._bindings(), 'value', this.toggled(value, checked));
  }

  private toggled(value: string, checked: boolean): string[] {
    const current = [...this.valueArray()];
    const idx = current.indexOf(value);
    if (checked && idx === -1) {
      current.push(value);
    } else if (!checked && idx !== -1) {
      current.splice(idx, 1);
    }
    // Pass the updated array directly (typed value, no JSON stringification needed).
    return current;
  }
}
