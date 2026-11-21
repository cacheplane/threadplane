import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { A2uiAudioPlayerComponent } from './audio-player.component';
import { A2uiCardComponent } from './card.component';
import { A2uiColumnComponent } from './column.component';
import { A2uiDividerComponent } from './divider.component';
import { A2uiIconComponent } from './icon.component';
import { A2uiImageComponent } from './image.component';
import { A2uiListComponent } from './list.component';
import { A2uiModalComponent } from './modal.component';
import { A2uiRowComponent } from './row.component';
import { A2uiTabsComponent } from './tabs.component';
import { A2uiTextComponent } from './text.component';
import { A2uiVideoComponent } from './video.component';

const components = [
  ['audio-player.component.ts', A2uiAudioPlayerComponent],
  ['card.component.ts', A2uiCardComponent],
  ['column.component.ts', A2uiColumnComponent],
  ['divider.component.ts', A2uiDividerComponent],
  ['icon.component.ts', A2uiIconComponent],
  ['image.component.ts', A2uiImageComponent],
  ['list.component.ts', A2uiListComponent],
  ['modal.component.ts', A2uiModalComponent],
  ['row.component.ts', A2uiRowComponent],
  ['tabs.component.ts', A2uiTabsComponent],
  ['text.component.ts', A2uiTextComponent],
  ['video.component.ts', A2uiVideoComponent],
] as const;

describe('A2UI catalog change detection', () => {
  const catalogDirectory = dirname(fileURLToPath(import.meta.url));

  for (const row of components) {
    const file = row[0];
    const component = row[1];
    const source = readFileSync(join(catalogDirectory, file), 'utf8');
    const onPush = (component as unknown as { ɵcmp: { onPush: boolean } }).ɵcmp
      .onPush;
    it(`${file} explicitly preserves default change detection`, () => {
      expect(source).toContain(
        'changeDetection: ChangeDetectionStrategy.Default'
      );
      expect(onPush).toBe(false);
    });
  }
});
