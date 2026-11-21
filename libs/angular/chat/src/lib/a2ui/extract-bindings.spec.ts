import { describe, it, expect } from 'vitest';
import type { A2uiComponentDef } from '@threadplane/a2ui';
import { extractBindings } from './extract-bindings';

describe('extractBindings', () => {
  it('returns [] when no prop is a $.path reference', () => {
    const def = { Button: { label: 'Hello', action: 'submit' } } as A2uiComponentDef;
    expect(extractBindings(def)).toEqual([]);
  });

  it('extracts a single $.path reference from a string prop', () => {
    const def = { TextField: { value: '{$.form.name}' } } as A2uiComponentDef;
    expect(extractBindings(def)).toEqual(['$.form.name']);
  });

  it('extracts multiple references and deduplicates', () => {
    const def = {
      TextField: { value: '{$.form.name}', placeholder: '{$.form.name}' },
    } as A2uiComponentDef;
    expect(extractBindings(def)).toEqual(['$.form.name']);
  });

  it('returns a sorted result for stable signal identity', () => {
    const def = {
      Form: { title: '{$.b}', subtitle: '{$.a}' },
    } as unknown as A2uiComponentDef;
    expect(extractBindings(def)).toEqual(['$.a', '$.b']);
  });

  it('recurses into nested record values', () => {
    const def = {
      Card: { header: { label: '{$.user.name}' }, body: { text: '{$.user.bio}' } },
    } as unknown as A2uiComponentDef;
    expect(extractBindings(def)).toEqual(['$.user.bio', '$.user.name']);
  });

  it('ignores non-reference string scalars', () => {
    const def = { Button: { label: 'literal text' } } as A2uiComponentDef;
    expect(extractBindings(def)).toEqual([]);
  });
});
