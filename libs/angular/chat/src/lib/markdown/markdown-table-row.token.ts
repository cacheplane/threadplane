// libs/angular/chat/src/lib/markdown/markdown-table-row.token.ts
import { InjectionToken, Signal, signal } from '@angular/core';

/**
 * Provided by MarkdownTableRowComponent for header rows so that
 * MarkdownTableCellComponent can render <th> instead of <td>.
 * The value is a Signal<boolean> so that it tracks the row's isHeader reactively.
 */
export const IS_HEADER_ROW = new InjectionToken<Signal<boolean>>('IS_HEADER_ROW', {
  providedIn: null,
  factory: () => signal(false),
});
