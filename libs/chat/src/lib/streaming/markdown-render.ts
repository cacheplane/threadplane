import { SecurityContext } from '@angular/core';
import type { DomSanitizer, SafeHtml } from '@angular/platform-browser';

let markedParse: ((src: string) => string) | null = null;
let markedLoadAttempted = false;
function ensureMarkedLoaded(): void {
  if (markedLoadAttempted) return;
  markedLoadAttempted = true;
  // Eagerly kick off the dynamic import so it's ready for subsequent calls
  void import('marked')
    .then((m) => {
      // GFM: enables tables, strikethrough, autolinks, task lists.
      // breaks: single \n becomes <br>. LLM chat output frequently uses
      // soft line breaks for visual structure where stricter markdown
      // would treat them as continuation. Matching common chat UX.
      const opts = { async: false, gfm: true, breaks: true } as const;
      markedParse = (src: string) => (m as any).marked.parse(src, opts) as string;
    })
    .catch(() => {
      markedParse = null;
    });
}

// Kick off the import at module load time so it resolves before first render
ensureMarkedLoaded();

/**
 * Escape and convert plain text to basic HTML (fallback when marked is unavailable).
 */
function plainTextToHtml(content: string): string {
  return content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

/**
 * Renders markdown content to sanitized HTML.
 * Falls back to plain text with newline-to-`<br>` conversion if `marked` is not installed.
 */
export function renderMarkdown(content: string, sanitizer: DomSanitizer): SafeHtml {
  if (markedParse) {
    const html = markedParse(content);
    return sanitizer.bypassSecurityTrustHtml(
      sanitizer.sanitize(SecurityContext.HTML, html) ?? ''
    );
  }
  // Fallback: escape HTML and convert newlines to <br>
  return sanitizer.bypassSecurityTrustHtml(plainTextToHtml(content));
}

/**
 * Renders markdown to a sanitized HTML string (not SafeHtml).
 * Used by the streaming markdown component for direct innerHTML assignment.
 */
export function renderMarkdownToString(content: string, sanitizer: DomSanitizer): string {
  if (markedParse) {
    const html = markedParse(content);
    return sanitizer.sanitize(SecurityContext.HTML, html) ?? '';
  }
  return plainTextToHtml(content);
}
