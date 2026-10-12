import { describe, it, expect } from 'vitest';
import { captureAuthority } from './authority';
import { projectIndex } from './index-projection';
import { projectReads } from './read-projection';
import { authorityInput, indexInput } from './test-fixtures';
function read(
  status = 'success',
  args: unknown = { file_path: '/skills/runway-analysis/SKILL.md' },
  result = '1  instruction'
) {
  const input = authorityInput(status, args, result);
  return projectReads(
    projectIndex(indexInput()),
    input.snapshot.toolCalls,
    captureAuthority(input)
  );
}
describe('literal successful inspected read evidence', () => {
  it('marks an exact owned instruction read only with confirmed raw status', () => {
    expect(read()).toMatchObject([
      {
        path: '/skills/runway-analysis/SKILL.md',
        category: 'instruction',
        kind: 'inspected',
        result: '1  instruction',
      },
    ]);
  });
  it('marks exact descendant reference paths separately and excludes sibling prefixes', () => {
    expect(
      read('success', {
        file_path: '/skills/runway-analysis/reference/margins.md',
      })
    ).toMatchObject([{ category: 'reference', kind: 'inspected' }]);
    for (const file_path of [
      '/skills/runway-analysis-other/SKILL.md',
      '/skills/runway-analysis/../other/file',
      '/skills/runway-analysis/%2e%2e/file',
      '/skills/runway-analysis\\reference/file',
    ])
      expect(read('success', { file_path })).toEqual([]);
  });
  it('does not interpret native complete as success without raw evidence', () => {
    const i = authorityInput();
    expect(
      projectReads(projectIndex(indexInput()), i.snapshot.toolCalls, {
        kind: 'unconfirmed',
      })
    ).toMatchObject([{ kind: 'unknown' }]);
    i.snapshot.toolCalls[0].status = 'pending';
    expect(
      projectReads(projectIndex(indexInput()), i.snapshot.toolCalls, {
        kind: 'unconfirmed',
      })
    ).toMatchObject([{ kind: 'pending' }]);
  });
  it('keeps error and unknown status unavailable, preserving literal result', () => {
    expect(
      read(
        'error',
        undefined,
        'Error: Line offset 900 exceeds file length (4 lines)'
      )
    ).toMatchObject([
      {
        kind: 'error',
        result: 'Error: Line offset 900 exceeds file length (4 lines)',
      },
    ]);
    expect(read('unknown')).toMatchObject([{ kind: 'unknown' }]);
  });
  it.each([0, -1, -100])(
    'excludes nonpositive limit %i even for an empty file',
    (limit) => {
      expect(
        read(
          'success',
          { file_path: '/skills/runway-analysis/SKILL.md', limit },
          'System reminder: File exists but has empty contents'
        )
      ).toMatchObject([{ kind: 'unavailable' }]);
    }
  );
  it('excludes the exact no-lines warning and unsupported result types', () => {
    const warning =
      'System reminder: no lines were read because `limit` was 0. The file was not inspected and may have contents; retry with `limit` >= 1 to read it.';
    expect(read('success', undefined, warning)).toMatchObject([
      { kind: 'unavailable', result: warning },
    ]);
    const i = authorityInput();
    (i.snapshot.toolCalls[0] as any).result = { content: 'text' };
    expect(
      projectReads(
        projectIndex(indexInput()),
        i.snapshot.toolCalls,
        captureAuthority(i)
      )
    ).toMatchObject([{ kind: 'unavailable' }]);
  });
  it.each([
    '1  first\n\n[Read 1 line (lines 1-1 of 3 total). 2 lines remaining from offset 1.]',
    '1  first\n\n[Read 1 line (lines 1-1). More lines remain from offset 1.]',
    "1  first\n\n[Output was truncated due to size limits. The file content is very large. Consider reformatting the file to make it easier to navigate. For example, if this is JSON, use execute(command='jq . /skills/runway-analysis/SKILL.md') to pretty-print it with line breaks. For other formats, you can use appropriate formatting tools to split long lines.]",
  ])('preserves partial/paginated/truncated text', (result) => {
    expect(read('success', undefined, result)).toMatchObject([
      { kind: 'partial', result },
    ]);
  });
  it('treats positive offset as a partial window and supports inspected empty files', () => {
    expect(
      read(
        'success',
        { file_path: '/skills/runway-analysis/SKILL.md', offset: 1, limit: 2 },
        '2  last'
      )
    ).toMatchObject([{ kind: 'partial' }]);
    expect(
      read(
        'success',
        undefined,
        'System reminder: File exists but has empty contents'
      )
    ).toMatchObject([{ kind: 'inspected', empty: true }]);
  });
  it('invalidates duplicate ids and contradictory native results/arguments', () => {
    for (const modify of [
      (i: any) => i.snapshot.toolCalls.push(i.snapshot.toolCalls[0]),
      (i: any) =>
        (i.snapshot.toolCalls[0].args = {
          file_path: '/skills/runway-analysis/reference/other.md',
        }),
      (i: any) => (i.snapshot.toolCalls[0].result = 'contradiction'),
    ]) {
      const i = authorityInput();
      const authority = captureAuthority(i);
      modify(i);
      expect(
        projectReads(
          projectIndex(indexInput()),
          i.snapshot.toolCalls,
          authority
        )
      ).toMatchObject([{ kind: 'unavailable' }]);
    }
  });
  it('never invents a selection or negative read claim from absent evidence', () => {
    expect(
      projectReads(projectIndex(indexInput()), [], { kind: 'unconfirmed' })
    ).toEqual([]);
    expect(
      projectReads(
        projectIndex(indexInput({})),
        authorityInput().snapshot.toolCalls,
        { kind: 'unconfirmed' }
      )
    ).toEqual([]);
  });
  it('rejects stale authority and unknown argument shapes without reviving reads', () => {
    const i = authorityInput();
    const authority = captureAuthority(i);
    const index = projectIndex({
      ...indexInput(),
      generation: 'new',
      currentGeneration: 'new',
    });
    expect(projectReads(index, i.snapshot.toolCalls, authority)).toMatchObject([
      { kind: 'unavailable' },
    ]);
    expect(
      read('success', {
        file_path: '/skills/runway-analysis/SKILL.md',
        offset: '0',
      })
    ).toMatchObject([{ kind: 'unavailable' }]);
    expect(
      read(
        'success',
        { file_path: '/skills/runway-analysis/SKILL.md', offset: -1 },
        '1  first'
      )
    ).toMatchObject([{ kind: 'inspected' }]);
  });
  it('does not represent malformed aggregate evidence as an absent read catalog', () => {
    expect(
      projectReads(projectIndex(indexInput()), new Date(), {
        kind: 'unconfirmed',
      })
    ).toMatchObject({ kind: 'unavailable' });
  });
  it('keeps actual pinned pagination partial when followed by the negative offset clamp notice', () => {
    const result =
      '1  ---\n\n[Read 1 line (lines 1-1 of 27 total). 26 lines remaining from offset 1.]\n\n[Requested offset -1 is before the start of the file; read from line 1 instead.]';
    expect(
      read(
        'success',
        { file_path: '/skills/runway-analysis/SKILL.md', offset: -1, limit: 1 },
        result
      )
    ).toMatchObject([{ kind: 'partial', result }]);
  });
  it.each([
    'unexpected nonnumbered output',
    '0  invalid marker',
    '1 single space gutter',
    '1.1  orphan continuation',
    '1  valid\narbitrary unnumbered row',
  ])('keeps unsupported raw success literal but unavailable: %s', (result) => {
    expect(read('success', undefined, result)).toMatchObject([
      { kind: 'unavailable', result },
    ]);
  });
  it('preserves positive gutters, blank source lines and continuation rows without interpreting source notice lookalikes', () => {
    const result =
      '  1  first\n1.1  continued\n  2  \n  3  [Read 1 line (lines 1-1 of 2 total). 1 line remaining from offset 1.]\n  4  System reminder: File exists but has empty contents';
    expect(read('success', undefined, result)).toMatchObject([
      { kind: 'inspected', empty: false, result },
    ]);
  });
  it('represents malformed read arguments explicitly while ignoring valid unrelated paths', () => {
    expect(read('success', null)).toEqual({ kind: 'unavailable' });
    expect(read('success', { file_path: '/notes.md' })).toEqual([]);
  });
  it.each([
    { limit: null },
    { offset: null },
    { limit: undefined },
    { offset: undefined },
  ])('does not default explicit unsupported bounds %#', (bounds) => {
    expect(
      read('success', {
        file_path: '/skills/runway-analysis/SKILL.md',
        ...bounds,
      })
    ).toMatchObject([{ kind: 'unavailable' }]);
  });
});
