import { expect, it, vi } from 'vitest';
const fault = vi.hoisted(() => ({
  mode: 'none' as 'none' | 'incomplete' | 'different',
}));
vi.mock('@cacheplane/partial-json', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@cacheplane/partial-json')
  >();
  return {
    ...actual,
    createPartialJsonParser: () => {
      const parser = actual.createPartialJsonParser();
      let finished = false;
      const other = actual.createPartialJsonParser();
      other.push(
        JSON.stringify({
          root: 'root',
          elements: {
            root: { type: 'Heading', props: { content: 'Different output' } },
          },
        })
      );
      other.finish();
      return {
        push: parser.push.bind(parser),
        finish() {
          parser.finish();
          finished = true;
        },
        get root() {
          if (finished && fault.mode === 'different') return other.root;
          if (finished && fault.mode === 'incomplete' && parser.root)
            return { ...parser.root, status: 'streaming' };
          return parser.root;
        },
      };
    },
  };
});
import { createPlayback } from './playback';

it.each(['incomplete', 'different'] as const)(
  'refuses %s terminal parser output and recovers on Reset',
  (mode) => {
    const source = JSON.stringify({
      root: 'root',
      elements: {
        root: { type: 'Heading', props: { content: 'Authored output' } },
      },
    });
    fault.mode = mode;
    const playback = createPlayback([{ label: 'Authored', json: source }]);
    const phases: string[] = [];
    playback.subscribe(() => phases.push(playback.getSnapshot().phase));
    playback.finish();
    expect(playback.getSnapshot()).toMatchObject({
      phase: 'error',
      playing: false,
      rawJson: '',
      spec: null,
    });
    expect(phases).not.toContain('complete');
    fault.mode = 'none';
    playback.reset();
    playback.finish();
    expect(playback.getSnapshot()).toMatchObject({
      phase: 'complete',
      rawJson: source,
    });
    expect(playback.getSnapshot().spec).toEqual(JSON.parse(source));
  }
);
