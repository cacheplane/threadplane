import type { Request } from '@playwright/test';

/**
 * Whether a request belongs to the page under test or to its React preview,
 * as opposed to the Angular example the same docs page embeds.
 *
 * The React preview specs guard against the preview starting agent work on
 * its own: no thread, run, or native call while a test only looks around.
 * But every canonical docs page also embeds the Angular example, and that
 * iframe mounts in Docs mode too. When the Angular example does real work on
 * load — the Chat Threads one POSTs /threads/search immediately — a page-wide
 * guard counts it, and the "keeps Angular as its default frontend" test fails
 * whenever that iframe finishes loading before the test does. That race failed
 * CI on react-chat-threads-preview.spec.ts three attempts in a row.
 *
 * `reactFrame` is the same pattern the spec asserts its React iframe's `src`
 * against, so the guard and the assertion cannot drift apart.
 */
export function fromPageOrReactPreview(
  request: Request,
  reactFrame: RegExp
): boolean {
  let frame;
  try {
    frame = request.frame();
  } catch {
    // Service-worker requests have no frame; they are not the preview's.
    return false;
  }
  if (frame === frame.page().mainFrame()) return true;
  return reactFrame.test(frame.url());
}
