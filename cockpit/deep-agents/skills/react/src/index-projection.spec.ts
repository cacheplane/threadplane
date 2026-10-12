import { describe, it, expect } from 'vitest';
import { projectIndex } from './index-projection';
import { skill, indexInput } from './test-fixtures';
describe('owned Skills index', () => {
  it('captures root metadata without retaining caller objects', () => {
    const input = indexInput();
    const actual = projectIndex(input);
    expect(actual.kind).toBe('ready');
    if (actual.kind !== 'ready') throw Error('Expected index');
    expect(actual.skills[0]).toEqual(skill);
    (input.values as any).skills_metadata[0].description = 'mutated';
    expect(actual.skills[0].description).toBe('Bundled runway example.');
  });
  it('accepts fresh checkpoint values and ignores conflicting custom metadata', () => {
    const input = {
      ...indexInput({
        skills_metadata: [{ ...skill, description: 'Fresh' }],
        custom: { skills_metadata: [{ ...skill, description: 'False' }] },
      }),
      source: 'checkpoint' as const,
    };
    expect(projectIndex(input)).toMatchObject({
      kind: 'ready',
      source: 'checkpoint',
      skills: [{ description: 'Fresh' }],
    });
  });
  it('authoritatively represents empty and absent metadata', () => {
    expect(projectIndex(indexInput({ skills_metadata: [] }))).toMatchObject({
      kind: 'ready',
      skills: [],
    });
    expect(
      projectIndex(indexInput({ custom: { skills_metadata: [skill] } }))
    ).toMatchObject({ kind: 'absent' });
  });
  it.each(
    [
      [{ ...skill, name: '../runway' }],
      [{ ...skill, name: 'runway--analysis' }],
      [{ ...skill, path: '/skills/runway-analysis/../other/SKILL.md' }],
      [{ ...skill, path: '/skills/runway-analysis-other/SKILL.md' }],
      [{ ...skill, path: '/skills/runway-analysis//SKILL.md' }],
      [{ ...skill, path: '/skills/runway-analysis/%2e%2e/SKILL.md' }],
      [{ ...skill, metadata: { author: 1 } }],
      [{ ...skill, license: {} }],
      [{ ...skill, allowed_tools: ['read_file', 'read_file'] }],
      [{ ...skill, description: 'x'.repeat(65537) }],
      [skill, skill],
      Array.from({ length: 101 }, (_, i) => ({
        ...skill,
        name: 's' + i,
        path: '/skills/s' + i + '/SKILL.md',
      })),
    ].map((skills_metadata) => ({ skills_metadata }))
  )('rejects malformed/bounded/duplicate index %#', ({ skills_metadata }) => {
    expect(projectIndex(indexInput({ skills_metadata }))).toMatchObject({
      kind: 'unavailable',
    });
  });
  it('rejects stale generations and unsupported prototypes/accessors without evaluating them', () => {
    expect(
      projectIndex({ ...indexInput(), currentGeneration: 'new' })
    ).toMatchObject({ kind: 'stale' });
    const malicious = Object.defineProperty({}, 'skills_metadata', {
      enumerable: true,
      get: () => {
        throw Error('getter called');
      },
    });
    expect(projectIndex(indexInput(malicious))).toMatchObject({
      kind: 'unavailable',
    });
    expect(projectIndex(indexInput(new Date()))).toMatchObject({
      kind: 'unavailable',
    });
  });
  it('bounds aggregate display including supported annotation keys', () => {
    const skills_metadata = Array.from({ length: 30 }, (_, i) => ({
      name: 's' + i,
      path: '/skills/s' + i + '/SKILL.md',
      description: 'x'.repeat(40000),
    }));
    expect(projectIndex(indexInput({ skills_metadata })).kind).toBe(
      'unavailable'
    );
    const value = { ...skill, metadata: { ['x'.repeat(65537)]: 'value' } };
    expect(projectIndex(indexInput({ skills_metadata: [value] })).kind).toBe(
      'unavailable'
    );
  });
  it('drops unsupported extra annotations rather than exposing arbitrary metadata', () => {
    const actual = projectIndex(
      indexInput({
        skills_metadata: [
          { ...skill, instructionBody: 'Never part of the index' },
        ],
      })
    );
    expect(actual).toMatchObject({ kind: 'ready' });
    if (actual.kind === 'ready')
      expect(actual.skills[0]).not.toHaveProperty('instructionBody');
  });
});
