import { describe, expect, it } from 'vitest';
import { a2uiBasicCatalog } from '@threadplane/angular/chat';
import { BackupTableComponent } from './backup-table.component';
import { demoViews } from './demo-views';

describe('demoViews', () => {
  it('keeps every A2UI catalog entry and adds the list_backups tool view', () => {
    const reg = demoViews();
    for (const key of Object.keys(a2uiBasicCatalog())) expect(reg[key]).toBeDefined();
    expect(reg['list_backups']).toBe(BackupTableComponent);
  });

  it('returns a frozen registry', () => {
    expect(Object.isFrozen(demoViews())).toBe(true);
  });
});
