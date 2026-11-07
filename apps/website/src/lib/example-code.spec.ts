import { describe, expect, it } from 'vitest';
import {
  ExampleCodeError,
  exampleTitle,
  fenceFor,
  resolveExampleFile,
  sliceRegion,
  type ExampleCodeContext,
} from './example-code';

const context: ExampleCodeContext = {
  docsPath: '/docs/angular/langgraph/guides/streaming',
  assetPaths: [
    'cockpit/langgraph/streaming/angular/src/app/streaming.component.ts',
    'cockpit/langgraph/streaming/angular/src/app/app.config.ts',
    'cockpit/langgraph/streaming/python/src/graph.py',
  ],
  sources: {
    'cockpit/langgraph/streaming/angular/src/app/streaming.component.ts':
      'export class StreamingComponent {}',
    'cockpit/langgraph/streaming/angular/src/app/app.config.ts':
      'export const appConfig = {};',
    'cockpit/langgraph/streaming/python/src/graph.py': 'graph = None',
  },
};

describe('resolveExampleFile', () => {
  it('resolves a basename to the one asset path that ends with it', () => {
    expect(resolveExampleFile('streaming.component.ts', context)).toBe(
      'cockpit/langgraph/streaming/angular/src/app/streaming.component.ts'
    );
  });

  it('accepts a full repo-relative path', () => {
    expect(
      resolveExampleFile(
        'cockpit/langgraph/streaming/python/src/graph.py',
        context
      )
    ).toBe('cockpit/langgraph/streaming/python/src/graph.py');
  });

  it('throws with the page and file when nothing matches', () => {
    expect(() => resolveExampleFile('missing.ts', context)).toThrow(
      ExampleCodeError
    );
    expect(() => resolveExampleFile('missing.ts', context)).toThrow(
      /\/docs\/angular\/langgraph\/guides\/streaming.*missing\.ts/
    );
  });

  it('throws when a basename is ambiguous', () => {
    const ambiguous: ExampleCodeContext = {
      ...context,
      assetPaths: ['a/index.ts', 'b/index.ts'],
      sources: { 'a/index.ts': '', 'b/index.ts': '' },
    };
    expect(() => resolveExampleFile('index.ts', ambiguous)).toThrow(
      /ambiguous/
    );
  });

  it('throws when the asset is declared but its source was not readable', () => {
    const unread: ExampleCodeContext = { ...context, sources: {} };
    expect(() => resolveExampleFile('graph.py', unread)).toThrow(
      /could not be read/
    );
  });
});

describe('sliceRegion', () => {
  it('slices a TypeScript region, strips the markers, and de-indents', () => {
    const source = [
      'class A {',
      '  // #region submit',
      '  send(text: string) {',
      '    this.agent.submit({ message: text });',
      '  }',
      '  // #endregion',
      '}',
    ].join('\n');
    expect(sliceRegion(source, 'submit', 'x.ts')).toBe(
      [
        'send(text: string) {',
        '  this.agent.submit({ message: text });',
        '}',
      ].join('\n')
    );
  });

  it('accepts the Python and HTML marker forms', () => {
    expect(
      sliceRegion('# region g\ngraph = 1\n# endregion\n', 'g', 'x.py')
    ).toBe('graph = 1');
    expect(
      sliceRegion(
        '<!-- #region t -->\n<p>hi</p>\n<!-- #endregion -->\n',
        't',
        'x.html'
      )
    ).toBe('<p>hi</p>');
  });

  it('throws naming the file when the region is missing or unterminated', () => {
    expect(() => sliceRegion('const a = 1;', 'nope', 'x.ts')).toThrow(
      /x\.ts.*nope/
    );
    expect(() =>
      sliceRegion('// #region open\nconst a = 1;', 'open', 'x.ts')
    ).toThrow(/unterminated/);
  });

  it('drops inner marker lines and ends at the matching endregion', () => {
    const source = [
      '// #region outer',
      'const a = 1;',
      '// #region inner',
      'const b = 2;',
      '// #endregion',
      'const c = 3;',
      '// #endregion',
    ].join('\n');
    expect(sliceRegion(source, 'outer', 'f.ts')).toBe(
      ['const a = 1;', 'const b = 2;', 'const c = 3;'].join('\n')
    );
    expect(sliceRegion(source, 'inner', 'f.ts')).toBe('const b = 2;');
  });

  it('counts an unnamed nested region so the outer slice is not cut short', () => {
    const source = [
      '// #region outer',
      'const a = 1;',
      '// #region',
      'const b = 2;',
      '// #endregion',
      'const c = 3;',
      '// #endregion',
    ].join('\n');
    expect(sliceRegion(source, 'outer', 'f.ts')).toBe(
      ['const a = 1;', 'const b = 2;', 'const c = 3;'].join('\n')
    );
  });

  it('accepts an HTML marker with no space before the comment close', () => {
    expect(
      sliceRegion(
        '<!-- #region t-->\n<p>hi</p>\n<!-- #endregion-->\n',
        't',
        'x.html'
      )
    ).toBe('<p>hi</p>');
  });
});

describe('fenceFor', () => {
  it('maps the extension to a fence language', () => {
    expect(fenceFor('const a = 1;', 'x.ts')).toBe('```ts\nconst a = 1;\n```');
    expect(fenceFor('a = 1', 'x.py')).toBe('```python\na = 1\n```');
    expect(fenceFor('<p/>', 'x.html')).toBe('```html\n<p/>\n```');
  });

  it('uses a longer fence than any backtick run inside the code', () => {
    expect(fenceFor('const s = `a```b`;', 'x.ts')).toBe(
      '````ts\nconst s = `a```b`;\n````'
    );
  });

  it('strips one trailing newline so the fence closes on its own line', () => {
    expect(fenceFor('a = 1\n', 'x.py')).toBe('```python\na = 1\n```');
  });
});

describe('exampleTitle', () => {
  it('is the basename', () => {
    expect(
      exampleTitle('cockpit/langgraph/streaming/python/src/graph.py')
    ).toBe('graph.py');
  });
});
