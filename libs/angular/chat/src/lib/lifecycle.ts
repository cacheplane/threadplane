import { InjectionToken, Signal } from '@angular/core';

/** Reactive readiness and user submission counters for a chat component instance. */
export interface ChatLifecycle {
  /** True after `<chat>` initializes with a non-null agent binding. */
  readonly componentReady: Signal<boolean>;
  /** True after the first user submit. Sticky for the life of the chat instance — does NOT reset on clearThread. */
  readonly firstMessageSent: Signal<boolean>;
  /** Count of user submits. Resets on clearThread. */
  readonly messageCount: Signal<number>;
  /** Epoch ms of the most recent user submit. Resets on clearThread. */
  readonly inputSubmittedAt: Signal<number | null>;
}

/** Injection token for the lifecycle signals provided by a chat component. */
export const CHAT_LIFECYCLE = new InjectionToken<ChatLifecycle>('CHAT_LIFECYCLE');
