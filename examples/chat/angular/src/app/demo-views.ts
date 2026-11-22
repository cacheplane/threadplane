import { withViews, type ViewRegistry } from '@threadplane/angular/chat';
import { a2uiBasicCatalog } from '@threadplane/angular/a2ui';
import { BackupTableComponent } from './backup-table.component';

/**
 * The view registry every demo surface passes to `<chat [views]>`: the A2UI
 * basic catalog (so `---a2ui_JSON---` messages mount a surface) plus the
 * frontend components registered for specific SERVER tool calls by name.
 * Registering `list_backups` here is what turns that tool's JSON result into
 * a table in the transcript, in the hero and in the demo a visitor takes over.
 */
export function demoViews(): ViewRegistry {
  return withViews(a2uiBasicCatalog(), { list_backups: BackupTableComponent });
}
