import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLearningSource, findSourceExcerpt } from './learning-source';
import { learningMilestones, sourceHref } from './learning-lesson';
import recording from './trip-recording.json';
import type { Recording } from './playback';

const revision = 'a'.repeat(40);
const root = process.cwd().endsWith('/apps/website') ? '../..' : '.';

describe('learning lesson source and milestones', () => {
  for (const framework of ['angular', 'react'] as const) {
    it(`resolves ${framework} teaching excerpts from the actual cockpit files`, () => {
      const paths =
        framework === 'react'
          ? ['app.tsx', 'application.ts', 'connection.ts'].map(
              (file) => `cockpit/langgraph/streaming/react/src/${file}`
            )
          : ['streaming.component.ts', 'app.config.ts'].map(
              (file) => `cockpit/langgraph/streaming/angular/src/app/${file}`
            );
      const sources = Object.fromEntries(
        paths.map((path) => [path, readFileSync(resolve(root, path), 'utf8')])
      );
      const source = createLearningSource(framework, sources, revision);
      expect(source.files.map((file) => file.path)).toEqual(paths);
      expect(source.snippet.code).toContain(
        framework === 'react'
          ? 'useAgent(application)'
          : 'injectAgent(STREAMING_AGENT)'
      );
      const file = source.files.find(
        (file) => file.path === source.snippet.path
      )!;
      expect(
        file.source
          .split('\n')
          .slice(source.snippet.start - 1, source.snippet.end)
          .join('\n')
      ).toBe(source.snippet.code);
      expect(sourceHref(source.revision, file.path, source.snippet)).toContain(
        `/blob/${revision}/${file.path}#L`
      );
    });
  }

  it('fails clearly when a source excerpt drifts or revision is invalid', () => {
    expect(() =>
      findSourceExcerpt('const other = 1;', 'useAgent(application)', 'app.tsx')
    ).toThrow(/app.tsx/);
    expect(() => createLearningSource('react', {}, 'main')).toThrow(
      /revision/i
    );
    expect(() => createLearningSource('react', {}, revision)).toThrow(
      /app.tsx/
    );
    expect(() => findSourceExcerpt('same\nsame', 'same', 'app.tsx')).toThrow(
      /ambiguous/i
    );
  });

  it('finds named milestones from captured evidence in chronological order', () => {
    const milestones = learningMilestones(recording as Recording);
    expect(milestones.map((item) => item.id)).toEqual([
      'message',
      'request',
      'partial',
      'complete',
    ]);
    const frames = (recording as Recording).frames;
    expect(
      frames[milestones[0].index].messages.some((message) =>
        ['user', 'human'].includes(message.role)
      )
    ).toBe(true);
    expect(
      frames[milestones[2].index].messages.some(
        (message) => message.role === 'assistant' && message.text
      )
    ).toBe(true);
    expect(milestones.map((item) => item.index)).toEqual(
      [...milestones.map((item) => item.index)].sort((a, b) => a - b)
    );
  });

  it('does not invent absent milestones or infer completion from call settlement', () => {
    const empty = { ...recording, frames: [] } as Recording;
    expect(learningMilestones(empty)).toEqual([]);
    const pending = {
      ...empty,
      frames: [
        {
          id: '1',
          elapsedMs: 0,
          label: 'snapshot',
          state: { busy: false, outcome: 'error' },
          messages: [],
          requests: [],
          calls: [
            {
              id: '1',
              name: 'submit',
              input: { message: 'Trip' },
              status: 'settled',
            },
          ],
          event: { type: 'snapshot', payload: null },
        },
      ],
    } as Recording;
    expect(
      learningMilestones(pending).some((item) => item.id === 'complete')
    ).toBe(false);
  });

  it('does not treat a previous answer as the new turn partial response', () => {
    const baseline = {
      id: '0',
      elapsedMs: 0,
      label: 'snapshot',
      state: { busy: false, outcome: null },
      messages: [
        { id: 'old', role: 'assistant', text: 'Previous completed answer' },
      ],
      requests: [],
      event: { type: 'snapshot', payload: null },
    };
    const frames = [
      baseline,
      {
        id: '1',
        elapsedMs: 0,
        label: 'snapshot',
        state: { busy: true, outcome: null },
        messages: [
          { id: 'old', role: 'assistant', text: 'Previous completed answer' },
          { id: 'new', role: 'user', text: 'Next question' },
        ],
        requests: [],
        event: { type: 'snapshot', payload: null },
      },
    ];
    expect(
      learningMilestones({ ...recording, frames } as Recording).some(
        (item) => item.id === 'partial'
      )
    ).toBe(false);
    frames.push({
      ...frames[1],
      id: '2',
      messages: [
        ...frames[1].messages,
        { id: 'reply', role: 'assistant', text: 'New partial' },
      ],
    });
    expect(
      learningMilestones({ ...recording, frames } as Recording).find(
        (item) => item.id === 'partial'
      )?.index
    ).toBe(2);
  });

  it('does not claim submission or completion from a retained baseline before a new user arrives', () => {
    const baseline = {
      id: '0',
      elapsedMs: 0,
      label: 'snapshot',
      state: { busy: false, outcome: 'success' },
      messages: [
        { id: 'u1', role: 'user', text: 'Old question' },
        { id: 'a1', role: 'assistant', text: 'Old answer' },
      ],
      requests: [],
      event: { type: 'snapshot', payload: null },
    };
    const frames = [
      baseline,
      { ...baseline, id: '1', state: { busy: true, outcome: null } },
    ];
    expect(learningMilestones({ ...recording, frames } as Recording)).toEqual(
      []
    );
  });
});
