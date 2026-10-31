import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getDocsDemo,
  type DocsDemoFrontend,
  type DocsDemoId,
} from './docs-demo-media';

describe('published documentation recordings', () => {
  for (const lesson of [
    'streaming',
    'persistence',
    'tools',
    'ui',
  ] as DocsDemoId[]) {
    for (const frontend of ['angular', 'react'] as DocsDemoFrontend[]) {
      it(`ships a verified, readable ${lesson}/${frontend} asset set`, () => {
        const media = getDocsDemo(lesson, frontend);
        const directory = join(__dirname, '../../public/media/docs');
        const capture = JSON.parse(
          readFileSync(join(directory, media.id + '-capture.json'), 'utf8')
        );
        expect(capture.id).toBe(media.id);
        expect(capture.frontend).toBe(frontend);
        expect(capture.sourceKind).toBe(
          lesson === 'ui' ? 'authored-local-json' : 'fixture-backed-langgraph'
        );
        expect(capture.sourceRevision).toMatch(/^[a-f0-9]{40}$/);
        expect(typeof capture.sourceTreeDirty).toBe('boolean');
        expect(capture.duration).toBeGreaterThanOrEqual(12);
        expect(capture.duration).toBeLessThanOrEqual(25);
        expect(capture.edits.speed).toBe(1);
        expect(capture.viewport).toEqual({
          width: media.width,
          height: media.height,
        });
        const poster = readFileSync(join(directory, media.id + '-poster.png'));
        expect(poster.readUInt32BE(16)).toBe(media.width);
        expect(poster.readUInt32BE(20)).toBe(media.height);
        expect(Object.keys(capture.assets)).toHaveLength(5);
        for (const [name, expected] of Object.entries(capture.assets) as [
          string,
          { sha256: string; bytes: number }
        ][]) {
          const contents = readFileSync(join(directory, name));
          expect(contents.length).toBe(expected.bytes);
          expect(createHash('sha256').update(contents).digest('hex')).toBe(
            expected.sha256
          );
        }
        for (const cue of capture.captions) {
          expect(cue.to).toBeLessThanOrEqual(capture.duration);
          expect(cue.text.length / (cue.to - cue.from)).toBeLessThanOrEqual(20);
        }
      });
    }
  }
});
