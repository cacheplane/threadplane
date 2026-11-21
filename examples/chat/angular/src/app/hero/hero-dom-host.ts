/**
 * The hero walkthrough drives the REAL chat UI (no mocked composer), so it has
 * to reach into the rendered DOM. Keeping that layer here — as pure functions
 * over a root element — means the selectors and the geometry maths are unit
 * testable against a mounted `<chat>` without booting the script runner.
 *
 * Every selector matches an accessible name that the chat primitives commit to
 * publicly (`aria-label`, visible button text), so a DOM refactor inside
 * `@threadplane/angular/chat` fails these tests rather than silently freezing the hero.
 */

export interface CursorPoint {
  x: number;
  y: number;
}

/** The chat composer textarea, or null before `<chat>` has rendered it. */
export function composerOf(root: HTMLElement): HTMLTextAreaElement | null {
  return root.querySelector('textarea[aria-label="Type a message"]');
}

/** The composer's Send button. Disabled while the composer is empty. */
export function sendButtonOf(root: HTMLElement): HTMLButtonElement | null {
  return root.querySelector('button[aria-label="Send message"]');
}

/** The interrupt panel's Accept button, matched on its visible label. */
export function acceptButtonOf(root: HTMLElement): HTMLButtonElement | null {
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('chat-interrupt-panel button'));
  return buttons.find((b) => /accept/i.test(b.textContent ?? '')) ?? null;
}

/**
 * Types `text` into `textarea` one character at a time, dispatching the same
 * `input` event a real keystroke would so the composer's signal stays in sync.
 * `instant` (reduced motion, or a test) writes the whole string in one go.
 */
export async function typeIntoTextarea(
  textarea: HTMLTextAreaElement | null,
  text: string,
  delayMs: number,
  instant = false,
): Promise<void> {
  if (!textarea) return;
  const set = (value: string) => {
    textarea.value = value;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  };
  if (instant) {
    set(text);
    return;
  }
  for (let i = 1; i <= text.length; i++) {
    set(text.slice(0, i));
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  }
}

/** Clicks `button` when present. Returns whether a click was dispatched. */
export function pressButton(button: HTMLButtonElement | null): boolean {
  if (!button) return false;
  button.click();
  return true;
}

/**
 * Where the fake cursor should sit to look like it is pointing at `el`:
 * vertically centred, and inset from the left edge so it lands on wide
 * elements (the composer) rather than sailing past their middle.
 */
export function cursorPointFor(root: HTMLElement, el: Element | null): CursorPoint | null {
  if (!el) return null;
  const rootRect = root.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.left - rootRect.left + Math.min(r.width / 2, 40)),
    y: Math.round(r.top - rootRect.top + r.height / 2),
  };
}
