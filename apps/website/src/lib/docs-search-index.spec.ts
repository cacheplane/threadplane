import { describe, expect, it } from 'vitest';
import { indexDocSections } from './docs-search-index';
import { extractHeadings } from './extract-headings';
import { getAllDocSlugs, getDocBySlug } from './docs';

const SOURCE = `---
description: Frontmatter must not be indexed.
---

# Streaming

Intro prose above the first heading.

## Token deltas

The adapter merges \`TEXT_MESSAGE_CONTENT\` deltas.

\`\`\`ts
const secretCodeToken = 'should-not-be-indexed';
\`\`\`

<Callout type="tip" title="See it live">
Callout body prose is searchable.
</Callout>

<StackDiagram caption="Backend speaks AG-UI over SSE" />
`;

describe('indexDocSections', () => {
  const sections = indexDocSections(SOURCE);
  const preamble = sections.find((s) => s.heading === null);
  const deltas = sections.find((s) => s.heading === 'Token deltas');

  it('emits an anchor-less record for content above the first heading', () => {
    expect(preamble?.anchor).toBeNull();
    expect(preamble?.text).toContain('Intro prose above the first heading');
  });

  it('splits at each heading and anchors it', () => {
    expect(deltas?.anchor).toBe('token-deltas');
    expect(deltas?.text).toContain('The adapter merges');
  });

  it('never indexes frontmatter', () => {
    expect(sections.map((s) => s.text).join(' ')).not.toContain('must not be indexed');
  });

  it('drops fenced code blocks', () => {
    expect(sections.map((s) => s.text).join(' ')).not.toContain('secretCodeToken');
  });

  it('unwraps inline code so API names are searchable as words', () => {
    expect(deltas?.text).toContain('TEXT_MESSAGE_CONTENT');
    expect(deltas?.text).not.toContain('`');
  });

  it('keeps component body prose and caption attributes, not markup', () => {
    const all = sections.map((s) => s.text).join(' ');
    expect(all).toContain('Callout body prose is searchable');
    expect(all).toContain('Backend speaks AG-UI over SSE');
    expect(all).not.toContain('StackDiagram');
    expect(all).not.toContain('data-tone');
  });
});

describe('indexDocSections edge cases', () => {
  it('returns no sections for an empty document', () => {
    expect(indexDocSections('')).toEqual([]);
  });

  it('handles a doc with no headings at all as a single preamble section', () => {
    const sections = indexDocSections('---\ndescription: x\n---\n\nJust prose, no headings anywhere.\n');
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBeNull();
    expect(sections[0].anchor).toBeNull();
    expect(sections[0].text).toContain('Just prose, no headings anywhere');
  });

  it('starts a section at ### when it is the first heading', () => {
    const sections = indexDocSections('Preamble.\n\n### Deep heading\n\nBody text.\n');
    const heading = sections.find((s) => s.heading === 'Deep heading');
    expect(heading?.anchor).toBe('deep-heading');
    expect(heading?.text).toContain('Body text');
  });

  it('does not treat a ## inside a fenced code block as a heading', () => {
    const source = [
      '# Title',
      '',
      '## Real heading',
      '',
      '```md',
      '## not a real heading',
      '```',
      '',
      'Trailing prose.',
    ].join('\n');
    const sections = indexDocSections(source);
    expect(sections.find((s) => s.heading === 'not a real heading')).toBeUndefined();
    const real = sections.find((s) => s.heading === 'Real heading');
    expect(real?.text).toContain('Trailing prose');
  });

  it('tolerates frontmatter with no closing fence', () => {
    const source = '---\ndescription: unterminated\n\n## Heading\n\nBody.\n';
    expect(() => indexDocSections(source)).not.toThrow();
  });

  it('keeps anchor alignment when a heading contains backticks', () => {
    const source = '# Title\n\n## The `useAgent` hook\n\nBody about the hook.\n';
    const sections = indexDocSections(source);
    const headings = extractHeadings(source);
    const heading = sections.find((s) => s.heading === headings[0].text);
    expect(heading?.anchor).toBe(headings[0].id);
    expect(heading?.text).toContain('Body about the hook');
  });

  it('keeps the title attribute of a paired component tag, not just self-closing ones', () => {
    // Real docs wrap steps as `<Step title="Install the package">...</Step>` — a paired
    // tag whose title is the exact phrase a reader would search for. Only extracting
    // caption/title from self-closing tags would silently drop it.
    const source = [
      '# Quick start',
      '',
      '<Steps>',
      '<Step title="Install the package">',
      '',
      'Run the installer.',
      '',
      '</Step>',
      '</Steps>',
    ].join('\n');
    const sections = indexDocSections(source);
    const all = sections.map((s) => s.text).join(' ');
    expect(all).toContain('Install the package');
    expect(all).toContain('Run the installer');
    expect(all).not.toContain('Step');
    expect(all).not.toContain('title=');
  });

  it('keeps underscores inside identifiers while unwrapping emphasis', () => {
    const [section] = indexDocSections('# T\n\nUse **TEXT_MESSAGE_CONTENT** with _care_.\n');
    expect(section.text).toContain('TEXT_MESSAGE_CONTENT');
    expect(section.text).toContain('care');
    expect(section.text).not.toContain('**');
    expect(section.text).not.toContain('_care_');
  });

  it('indexes link text but not link targets', () => {
    const [section] = indexDocSections('# T\n\nSee [Installation](/docs/angular/langgraph/install) first.\n');
    expect(section.text).toContain('Installation');
    expect(section.text).not.toContain('/docs/angular/langgraph/install');
  });

  it('indexes image alt text but not the image target', () => {
    const [section] = indexDocSections('# T\n\n![Architecture diagram](/img/arch.png) shows the flow.\n');
    expect(section.text).toContain('Architecture diagram');
    expect(section.text).not.toContain('/img/arch.png');
  });

  it('unwraps single- and double-asterisk emphasis', () => {
    const [section] = indexDocSections('# T\n\nThis is *italic* and **bold** text.\n');
    expect(section.text).toContain('italic');
    expect(section.text).toContain('bold');
    expect(section.text).not.toContain('*');
  });

  it('unwraps double-underscore emphasis', () => {
    const [section] = indexDocSections('# T\n\nThis is __strongly__ stated.\n');
    expect(section.text).toContain('strongly');
    expect(section.text).not.toContain('__');
  });

  it('leaves multiple links on one line without runaway matching', () => {
    const [section] = indexDocSections(
      '# T\n\nSee [Installation](/docs/a) and [Quickstart](/docs/b) both.\n'
    );
    expect(section.text).toContain('Installation');
    expect(section.text).toContain('Quickstart');
    expect(section.text).not.toContain('/docs/a');
    expect(section.text).not.toContain('/docs/b');
  });

  it('does not let a > inside a quoted attribute value terminate the tag match', () => {
    // A naive [^>]* attribute scan stops at the first >, even inside a quoted value,
    // and leaks the rest of the tag into indexed text as raw markup.
    const source = '# T\n\n<Callout title="a > b" type="tip">\nBody prose.\n</Callout>\n';
    const [section] = indexDocSections(source);
    expect(section.text).toContain('a > b');
    expect(section.text).toContain('Body prose');
    expect(section.text).not.toContain('type="tip"');
    expect(section.text).not.toContain('"');
  });

  it('drops empty sections produced by a heading with no body text', () => {
    const source = '# Title\n\n## Empty section\n\n## Next section\n\nSome text.\n';
    const sections = indexDocSections(source);
    expect(sections.find((s) => s.heading === 'Empty section')).toBeUndefined();
    expect(sections.find((s) => s.heading === 'Next section')?.text).toContain('Some text');
  });

  it('strips an un-fenced import line so it never leaks into a snippet', () => {
    // Real docs never have an un-fenced import today -- every import lives inside a
    // fenced code block, already dropped -- but a doc that imports a component for
    // real JSX use would otherwise leak the import statement into indexed text.
    const source = "# T\n\nimport { Callout } from '@/components/Callout';\n\nActual prose here.\n";
    const [section] = indexDocSections(source);
    expect(section.text).not.toContain('import');
    expect(section.text).not.toContain('Callout');
    expect(section.text).toContain('Actual prose here');
  });
});

describe('indexDocSections derives structure from extractHeadings, not a second scan', () => {
  // This is what makes desync impossible by construction rather than by test: the
  // non-preamble sections, in order, are exactly extractHeadings' own output. There
  // is no second place in this file that decides what a heading is or where a
  // section boundary falls, so the two cannot drift into disagreement -- there is
  // nothing left for them to disagree about.
  it('emits one non-preamble section per heading extractHeadings finds, same order, same heading/anchor', () => {
    const source = [
      '# Title',
      '',
      'Preamble prose.',
      '',
      '## First',
      '',
      'First body.',
      '',
      '### Nested `code`',
      '',
      'Nested body.',
      '',
      '## Nested_underscore section',
      '',
      'Third body.',
    ].join('\n');

    const headings = extractHeadings(source);
    const sections = indexDocSections(source);
    const nonPreamble = sections.filter((s) => s.heading !== null);

    expect(headings.length).toBeGreaterThan(0);
    expect(nonPreamble.map((s) => [s.heading, s.anchor])).toEqual(
      headings.map((h) => [h.text, h.id])
    );
  });
});

describe('anchor parity with the rendered table of contents', () => {
  // The load-bearing test. extract-headings hand-rolls slugification, so the
  // only guarantee that a search deep link resolves is that the index and the
  // TOC derive anchors from the same function over the same source. Running it
  // across real content means a heading either tool sections differently fails
  // here rather than shipping a link to nowhere.
  it('emits only anchors the TOC also produces, for every real doc', () => {
    const mismatches: string[] = [];

    for (const { library, section, slug } of getAllDocSlugs()) {
      const doc = getDocBySlug(library, section, slug);
      if (!doc) continue;
      const tocIds = new Set(extractHeadings(doc.body).map((h) => h.id));
      for (const record of indexDocSections(doc.body)) {
        if (record.anchor && !tocIds.has(record.anchor)) {
          mismatches.push(`${library}/${section}/${slug}#${record.anchor}`);
        }
      }
    }

    expect(mismatches).toEqual([]);
  });
});
