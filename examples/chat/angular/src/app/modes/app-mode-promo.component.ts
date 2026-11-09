import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Marketing hero shown in popup/sidebar mode while App mode is off. Sells the
 * App-mode map cockpit and the Threadplane primitives behind it, with a CTA
 * that enables App mode.
 *
 * Isolated contract — no shell coupling:
 *  - `hasMapsKey`: whether GOOGLE_MAPS_API_KEY is configured (gates the CTA).
 *  - `enable`: emitted when the user clicks the CTA.
 */
@Component({
  selector: 'app-mode-promo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="promo">
      <img
        #promoImg
        class="promo__img"
        src="/app-mode-preview.jpg"
        alt="Preview of the App-mode map cockpit"
        loading="lazy"
        (error)="promoImg.style.display = 'none'"
      />
      <div class="promo__caption">
        <div class="promo__copy">
          <span class="promo__eyebrow">
            <span class="promo__icon promo__icon--sm" aria-hidden="true">layers</span>
            Built with Threadplane
          </span>
          <h2 class="promo__title">See your trip come alive on a live map</h2>
          <p class="promo__subtitle">A map cockpit where the agent edits your itinerary in real time.</p>
          <ul class="promo__pills">
            <li class="promo__pill"><span class="promo__icon promo__icon--sm" aria-hidden="true">build</span>Client tools</li>
            <li class="promo__pill"><span class="promo__icon promo__icon--sm" aria-hidden="true">widgets</span>Generative UI</li>
            <li class="promo__pill"><span class="promo__icon promo__icon--sm" aria-hidden="true">how_to_reg</span>Human-in-the-loop</li>
            <li class="promo__pill"><span class="promo__icon promo__icon--sm" aria-hidden="true">database</span>Shared state</li>
          </ul>
        </div>
        <div class="promo__action">
          <button
            type="button"
            class="promo__cta"
            [disabled]="!hasMapsKey()"
            [attr.title]="hasMapsKey() ? null : 'Set GOOGLE_MAPS_API_KEY to enable'"
            (click)="enable.emit()"
          >
            <span class="promo__icon" aria-hidden="true">map</span>
            Enable app mode
            <span class="promo__icon" aria-hidden="true">arrow_forward</span>
          </button>
          @if (!hasMapsKey()) {
            <p class="promo__note">Set <code>GOOGLE_MAPS_API_KEY</code> to enable</p>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; width: 100%; }
    .promo {
      box-sizing: border-box;
      width: min(780px, 100%);
      margin: 0 auto;
      border-radius: 16px;
      overflow: hidden;
      background: var(--demo-control-bg);
      border: 1px solid var(--demo-control-border);
      animation: promo-rise 320ms ease both;
    }
    .promo__img {
      width: 100%; height: auto; display: block;
    }
    .promo__caption {
      display: flex; flex-wrap: wrap; align-items: center; gap: 16px;
      padding: 16px 20px;
      border-top: 1px solid var(--demo-control-border);
    }
    .promo__copy { flex: 1 1 320px; min-width: 0; }
    .promo__eyebrow {
      display: inline-flex; align-items: center; gap: 6px;
      background: var(--demo-control-selected-bg); color: var(--demo-control-selected-text);
      font-size: 12px; padding: 3px 10px; border-radius: 8px; margin-bottom: 9px;
    }
    .promo__title { font-size: 20px; font-weight: 600; color: var(--demo-control-text); line-height: 1.3; margin: 0 0 4px; }
    .promo__subtitle { font-size: 13px; color: var(--demo-control-muted); line-height: 1.5; margin: 0 0 12px; }
    .promo__pills { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; margin: 0; padding: 0; }
    .promo__pill {
      display: inline-flex; align-items: center; gap: 6px;
      background: var(--demo-control-surface); border: 1px solid var(--demo-control-border);
      color: var(--demo-control-text); font-size: 12px; padding: 5px 10px; border-radius: 8px;
    }
    .promo__action { min-width: 0; max-width: 100%; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
    .promo__cta {
      display: inline-flex; align-items: center; gap: 8px;
      min-height: 44px;
      background: var(--demo-control-yellow); color: var(--demo-control-ink);
      border: none; font: inherit; font-size: 14px; font-weight: 600;
      padding: 11px 18px; border-radius: 8px; cursor: pointer;
    }
    .promo__cta:disabled { opacity: 0.5; cursor: not-allowed; }
    .promo__cta:focus-visible { outline: 2px solid var(--demo-control-focus); outline-offset: 2px; }
    .promo__cta:hover:not(:disabled) { filter: brightness(1.08); }
    .promo__note { font-size: 12px; color: var(--demo-control-muted); margin: 0; overflow-wrap: anywhere; }
    .promo__note code { font-family: var(--tplane-chat-font-mono, monospace); }
    .promo__icon { font-family: 'Material Symbols Outlined', sans-serif; font-size: 18px; line-height: 1; }
    .promo__icon--sm { font-size: 15px; }
    @keyframes promo-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .promo { animation: none; } }
  `],
})
export class AppModePromoComponent {
  /** Whether GOOGLE_MAPS_API_KEY is configured; gates the CTA. */
  readonly hasMapsKey = input<boolean>(false);
  /** Emitted when the user clicks the "Enable app mode" CTA. */
  readonly enable = output<void>();
}
