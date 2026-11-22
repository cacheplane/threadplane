import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { Spec } from '@json-render/core';
import { createContentClassifier, type ContentClassifier } from './content-classifier';

describe('ContentClassifier', () => {
  function setup(): ContentClassifier {
    let classifier!: ContentClassifier;
    TestBed.runInInjectionContext(() => {
      classifier = createContentClassifier();
    });
    return classifier;
  }

  describe('initial state', () => {
    it('type is pending', () => {
      const c = setup();
      expect(c.type()).toBe('pending');
    });

    it('markdown is empty', () => {
      const c = setup();
      expect(c.markdown()).toBe('');
    });

    it('spec is null', () => {
      const c = setup();
      expect(c.spec()).toBeNull();
    });

    it('elementStates is empty', () => {
      const c = setup();
      expect(c.elementStates().size).toBe(0);
    });

    it('streaming is false', () => {
      const c = setup();
      expect(c.streaming()).toBe(false);
    });
  });

  describe('markdown detection', () => {
    it('detects plain text as markdown', () => {
      const c = setup();
      c.update('Hello world');
      expect(c.type()).toBe('markdown');
      expect(c.markdown()).toBe('Hello world');
    });

    it('accumulates markdown across updates', () => {
      const c = setup();
      c.update('Hello');
      c.update('Hello world');
      expect(c.markdown()).toBe('Hello world');
    });

    it('spec remains null for markdown', () => {
      const c = setup();
      c.update('# Some heading\nSome text');
      expect(c.spec()).toBeNull();
    });
  });

  describe('json-render detection', () => {
    it('detects leading { as json-render', () => {
      const c = setup();
      c.update('{');
      expect(c.type()).toBe('json-render');
    });

    it('produces spec from streamed JSON', () => {
      const c = setup();
      const json = JSON.stringify({
        root: 'el-1',
        elements: {
          'el-1': { type: 'card', props: { title: 'Hello' } },
        },
      });
      c.update(json);
      const spec = c.spec() as Spec;
      expect(spec).not.toBeNull();
      expect(spec.root).toBe('el-1');
      expect(spec.elements['el-1'].type).toBe('card');
    });

    it('streams incrementally', () => {
      const c = setup();
      c.update('{"root":');
      expect(c.type()).toBe('json-render');
      expect(c.spec()).not.toBeNull();

      c.update('{"root":"el-1","elements":{}}');
      const spec = c.spec() as Spec;
      expect(spec.root).toBe('el-1');
    });

    it('markdown is empty for pure JSON', () => {
      const c = setup();
      c.update('{"root":"el-1","elements":{}}');
      expect(c.markdown()).toBe('');
    });
  });

  describe('delta processing', () => {
    it('only processes new characters', () => {
      const c = setup();
      c.update('{"root":');
      const spec1 = c.spec();

      // Same content — no delta to process
      c.update('{"root":');
      const spec2 = c.spec();

      // Same reference since nothing changed
      expect(spec2).toBe(spec1);
    });

    it('handles empty delta (same content twice)', () => {
      const c = setup();
      c.update('Hello');
      c.update('Hello');
      expect(c.markdown()).toBe('Hello');
      expect(c.type()).toBe('markdown');
    });
  });

  describe('type transitions', () => {
    it('reclassifies a longer A2UI replacement after a streamed introduction', () => {
      const c = setup();
      c.update("I'll render a compact cleanup report UI now.");
      expect(c.type()).toBe('markdown');

      c.update('---a2ui_JSON---\n' + JSON.stringify({
        version: 'v0.9',
        createSurface: { surfaceId: 'cleanup', catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json' },
      }) + '\n' + JSON.stringify({
        version: 'v0.9',
        updateComponents: { surfaceId: 'cleanup', components: [{ id: 'root', component: 'Text', text: 'Cleanup report' }] },
      }) + '\n');

      expect(c.type()).toBe('a2ui');
      expect(c.a2uiSource()).toContain('"surfaceId":"cleanup"');
      expect(c.a2uiSource().startsWith('\n')).toBe(true);
      expect(c.markdown()).toBe('');
    });

    it('reparses an equal-length JSON replacement instead of keeping stale elements', () => {
      const c = setup();
      c.update('{"root":"first","elements":{}}');
      c.update('{"root":"other","elements":{}}');
      expect(c.spec()?.root).toBe('other');
    });

    it('never downgrades from markdown', () => {
      const c = setup();
      c.update('Hello');
      expect(c.type()).toBe('markdown');

      // Even if subsequent content looks like JSON, type doesn't downgrade
      c.update('Hello {"root":"el-1"}');
      expect(c.type()).not.toBe('json-render');
    });

    it('never downgrades from json-render', () => {
      const c = setup();
      c.update('{"root":"el-1"}');
      expect(c.type()).toBe('json-render');

      // Stays json-render even with more content
      c.update('{"root":"el-1","elements":{}}');
      expect(c.type()).toBe('json-render');
    });
  });

  describe('streaming state', () => {
    it('is true while content is arriving for json-render', () => {
      const c = setup();
      c.update('{"root":');
      expect(c.streaming()).toBe(true);
    });

    it('is false after complete JSON', () => {
      const c = setup();
      c.update('{"root":"el-1","elements":{}}');
      expect(c.streaming()).toBe(false);
    });

    it('transitions from true to false when JSON completes', () => {
      const c = setup();
      c.update('{"root":"el-1"');
      expect(c.streaming()).toBe(true);

      c.update('{"root":"el-1","elements":{}}');
      expect(c.streaming()).toBe(false);
    });
  });

  describe('a2ui detection', () => {
    it('detects ---a2ui_JSON--- prefix', () => {
      const c = setup();
      c.update('---a2ui_JSON---{"root":"el-1","elements":{}}');
      expect(c.type()).toBe('a2ui');
    });
  });

  // The classifier recognizes A2UI and hands its source on; the renderer in
  // @threadplane/angular/a2ui parses it (see message-surfaces.component.spec).
  describe('a2ui source', () => {
    const create = JSON.stringify({ version: 'v0.9', createSurface: { surfaceId: 's1', catalogId: 'basic' } }) + '\n';
    const update = JSON.stringify({ version: 'v0.9', updateComponents: { surfaceId: 's1', components: [
      { id: 'root', component: 'Text', text: 'Hi' },
    ] } }) + '\n';

    it('exposes the content after the marker without parsing it', () => {
      const c = setup();
      c.update('---a2ui_JSON---' + create);
      expect(c.type()).toBe('a2ui');
      expect(c.a2uiSource()).toBe(create);
      expect(c.errors()).toEqual([]);
    });

    it('grows with the streamed content, and a non-A2UI message has none', () => {
      const c = setup();
      c.update('---a2ui_JSON---' + create);
      c.update('---a2ui_JSON---' + create + update);
      expect(c.a2uiSource()).toBe(create + update);
      const markdown = setup();
      markdown.update('Plain text');
      expect(markdown.a2uiSource()).toBe('');
    });

    it('resets the source when a replacement does not extend it', () => {
      const c = setup();
      c.update('---a2ui_JSON---' + create + update);
      c.update('Replaced with prose.');
      expect(c.type()).toBe('markdown');
      expect(c.a2uiSource()).toBe('');
    });
  });

  describe('error handling', () => {
    it('errors signal starts empty', () => {
      const c = setup();
      expect(c.errors()).toEqual([]);
    });

    it('continues working after encountering non-JSON content mid-stream', () => {
      const c = setup();
      // Start with valid JSON detection
      c.update('{"root":"r1"');
      expect(c.type()).toBe('json-render');
      // The spec should have a partial result
      expect(c.spec()).not.toBeNull();
    });
  });

  describe('dispose', () => {
    it('can be called without errors', () => {
      const c = setup();
      c.update('Hello');
      expect(() => c.dispose()).not.toThrow();
    });

    it('can be called on fresh instance', () => {
      const c = setup();
      expect(() => c.dispose()).not.toThrow();
    });
  });
});

describe('ContentClassifier — A2UI prefix patience', () => {
  it('stays pending on a single dash (partial A2UI prefix)', () => {
    const c = createContentClassifier();
    c.update('-');
    expect(c.type()).toBe('pending');
  });

  it('stays pending on partial A2UI prefix like --- or ---a or ---a2u', () => {
    const c1 = createContentClassifier();
    c1.update('---');
    expect(c1.type()).toBe('pending');
    const c2 = createContentClassifier();
    c2.update('---a');
    expect(c2.type()).toBe('pending');
    const c3 = createContentClassifier();
    c3.update('---a2u');
    expect(c3.type()).toBe('pending');
  });

  it('transitions to a2ui when the full A2UI prefix arrives', () => {
    const c = createContentClassifier();
    c.update('-');
    c.update('---a2ui_JSON---');
    expect(c.type()).toBe('a2ui');
  });

  it('commits to markdown when content starting with - is disproven early', () => {
    const c = createContentClassifier();
    c.update('-x');
    expect(c.type()).toBe('markdown');
  });

  it('commits to markdown once enough chars are seen without matching prefix', () => {
    const c = createContentClassifier();
    c.update('-this is just dashes leading text');
    expect(c.type()).toBe('markdown');
  });

  it('commits to json-render on a single { with no patience needed', () => {
    const c = createContentClassifier();
    c.update('{');
    expect(c.type()).toBe('json-render');
  });

  it('initial state is pending (renamed from undetermined)', () => {
    const c = createContentClassifier();
    expect(c.type()).toBe('pending');
  });
});
