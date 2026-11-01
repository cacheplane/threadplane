import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { Spec } from '@json-render/core';

/** Renders an A2UI audio URL with native playback controls and an optional description. */
@Component({
  selector: 'a2ui-audio-player',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Default,
  template: `
    <div class="a2ui-audio-wrap">
      @if (description()) {
        <span class="a2ui-audio-description">{{ description() }}</span>
      }
      <audio
        class="a2ui-audio"
        [src]="url()"
        controls
      ></audio>
    </div>
  `,
  styles: [`
    .a2ui-audio-wrap {
      display: flex;
      flex-direction: column;
      gap: var(--a2ui-spacing-1);
    }
    .a2ui-audio-description {
      font-size: var(--a2ui-typography-caption-size);
      color: var(--a2ui-on-surface-variant);
    }
    .a2ui-audio {
      display: block;
      width: 100%;
    }
  `],
})
export class A2uiAudioPlayerComponent {
  readonly url = input<string>('');
  /** v0.9 prop: short description / title rendered above the player. */
  readonly description = input<string>('');
  // Framework inputs required by the render harness.
  readonly bindings = input<Record<string, string>>({});
  readonly emit = input<(event: string) => void>(() => { /* noop */ });
  readonly loading = input<boolean>(false);
  readonly childKeys = input<string[]>([]);
  readonly spec = input<Spec | undefined>(undefined);
}
