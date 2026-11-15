import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMarkdown } from '@threadplane/content/markdown';
import {
  Markdown,
  MarkdownComponentsProvider,
  MarkdownCopyButton,
  type MarkdownComponentProps,
  type MarkdownComponents,
} from './index.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const snapshot = (content: string, phase: 'streaming' | 'complete' = 'complete') =>
  createMarkdown({ generation: 'a', phase, content }).getSnapshot();
const clipboard = (writeText: (text: string) => Promise<void>) =>
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { clipboard: { writeText } }));
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

function Highlighted({ node, defaultView }: MarkdownComponentProps<'code-block'>) {
  if (node.status !== 'complete') return <>{defaultView}</>;
  return (
    <figure data-language={node.language}>
      <span className="hl">{node.text}</span>
      {defaultView}
    </figure>
  );
}
const highlight: MarkdownComponents = { 'code-block': Highlighted };

describe('Markdown code block copy', () => {
  it('copies a closed block and reads Copied for two seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const writeText = vi.fn(async () => undefined);
    clipboard(writeText);
    const view = render(<Markdown snapshot={snapshot('```ts\nconst a = 1;\n```')} />);
    const button = view.getByRole('button', { name: 'Copy code' });
    expect(button.closest('.tp-markdown__code')?.querySelector('pre code')?.textContent).toBe('const a = 1;');
    fireEvent.click(button);
    await settle();
    expect(writeText).toHaveBeenCalledWith('const a = 1;');
    expect(view.getByRole('button', { name: 'Copied' }).hasAttribute('data-copied')).toBe(true);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(view.getByRole('button', { name: 'Copy code' }).hasAttribute('data-copied')).toBe(false);
    vi.useRealTimers();
  });

  it('offers no copy while the block is still streaming, then offers it once the fence closes', () => {
    const owner = createMarkdown({ generation: 'a', phase: 'streaming', content: '```ts\nconst a' });
    const view = render(<Markdown snapshot={owner.getSnapshot()} />);
    expect(view.container.querySelector('pre code')?.textContent).toBe('const a');
    expect(view.queryByRole('button', { name: 'Copy code' })).toBeNull();
    const pre = view.container.querySelector('pre');
    owner.update({ generation: 'a', phase: 'streaming', content: '```ts\nconst a = 1;\n```\n\nAfter' });
    view.rerender(<Markdown snapshot={owner.getSnapshot()} />);
    expect(view.getByRole('button', { name: 'Copy code' })).not.toBeNull();
    expect(view.container.querySelector('pre')).toBe(pre);
  });

  it('lets a replacement that draws its own block keep the Copy button', async () => {
    const writeText = vi.fn(async () => undefined);
    clipboard(writeText);
    function Own({ node }: MarkdownComponentProps<'code-block'>) {
      return (
        <div className="tp-markdown__code">
          <pre className="own">{node.text.toUpperCase()}</pre>
          <MarkdownCopyButton text={node.text} />
        </div>
      );
    }
    const view = render(<Markdown snapshot={snapshot('```\nabc\n```')} components={{ 'code-block': Own }} />);
    expect(view.container.querySelector('pre.own')?.textContent).toBe('ABC');
    fireEvent.click(view.getByRole('button', { name: 'Copy code' }));
    await settle();
    expect(writeText).toHaveBeenCalledWith('abc');
    expect(view.getByRole('button', { name: 'Copied' })).not.toBeNull();
  });

  it('stays quiet when the clipboard and the selection copy both refuse', async () => {
    clipboard(async () => { throw new Error('denied'); });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) });
    const view = render(<Markdown snapshot={snapshot('```\nx\n```')} />);
    fireEvent.click(view.getByRole('button', { name: 'Copy code' }));
    await settle();
    expect(view.queryByRole('button', { name: 'Copied' })).toBeNull();
  });
});

describe('Markdown components', () => {
  it('replaces only the chosen type, with the node, its rendered children and the built-in view', () => {
    const view = render(
      <Markdown snapshot={snapshot('Intro **bold**\n\n```ts\nconst a = 1;\n```')} components={highlight} />
    );
    const figure = view.container.querySelector('figure');
    expect(figure?.getAttribute('data-language')).toBe('ts');
    expect(figure?.querySelector('.hl')?.textContent).toBe('const a = 1;');
    // The built-in block, Copy included, is there to wrap.
    expect(figure?.querySelector('.tp-markdown__code pre code')?.className).toBe('language-ts');
    expect(figure?.querySelector('button')?.getAttribute('aria-label')).toBe('Copy code');
    // Everything else keeps the built-in rendering.
    expect(view.container.querySelector('p > strong')?.textContent).toBe('bold');
  });

  it('hands a replacement the policy-checked URL, not a refused one', () => {
    const seen: (string | undefined)[] = [];
    function Link({ url, children }: MarkdownComponentProps<'link'>) {
      seen.push(url);
      return url ? <a data-app="" href={url}>{children}</a> : <span data-refused="">{children}</span>;
    }
    function Image({ url, node }: MarkdownComponentProps<'image'>) {
      seen.push(url);
      return <span data-image={url ?? 'refused'}>{node.alt}</span>;
    }
    const view = render(
      <Markdown
        snapshot={snapshot('[ok](https://example.com/a) [bad](javascript:alert(1)) ![pic](/p.png)')}
        components={{ link: Link, image: Image }}
      />
    );
    expect(view.container.querySelector('a[data-app]')?.getAttribute('href')).toBe('https://example.com/a');
    expect(view.container.querySelector('[data-refused]')?.textContent).toBe('bad');
    expect(view.container.querySelector('[data-image]')?.getAttribute('data-image')).toBe('/p.png');
    expect(seen).toEqual(['https://example.com/a', undefined, '/p.png']);
  });

  it('takes components from a provider, with nested providers and the prop winning type by type', () => {
    function Heading({ children }: MarkdownComponentProps<'heading'>) {
      return <h2 data-outer="">{children}</h2>;
    }
    function Quote({ children }: MarkdownComponentProps<'blockquote'>) {
      return <aside data-outer="">{children}</aside>;
    }
    function InnerQuote({ children }: MarkdownComponentProps<'blockquote'>) {
      return <aside data-inner="">{children}</aside>;
    }
    function OwnHeading({ children }: MarkdownComponentProps<'heading'>) {
      return <h3 data-own="">{children}</h3>;
    }
    const outer: MarkdownComponents = { heading: Heading, blockquote: Quote };
    const inner: MarkdownComponents = { blockquote: InnerQuote };
    const own: MarkdownComponents = { heading: OwnHeading };
    const content = snapshot('# Title\n\n> quoted');
    const view = render(
      <MarkdownComponentsProvider components={outer}>
        <div data-surface="provider"><Markdown snapshot={content} /></div>
        <MarkdownComponentsProvider components={inner}>
          <div data-surface="nested"><Markdown snapshot={content} /></div>
          <div data-surface="own"><Markdown snapshot={content} components={own} /></div>
        </MarkdownComponentsProvider>
      </MarkdownComponentsProvider>
    );
    const surface = (name: string) => view.container.querySelector(`[data-surface="${name}"]`)!;
    expect(surface('provider').querySelector('h2[data-outer]')?.textContent).toBe('Title');
    expect(surface('provider').querySelector('aside[data-outer]')).not.toBeNull();
    expect(surface('nested').querySelector('h2[data-outer]')).not.toBeNull();
    expect(surface('nested').querySelector('aside[data-inner]')).not.toBeNull();
    expect(surface('own').querySelector('h3[data-own]')).not.toBeNull();
    expect(surface('own').querySelector('aside[data-inner]')).not.toBeNull();
  });

  it('keeps replaced nodes mounted while a reply streams around them', () => {
    const owner = createMarkdown({ generation: 'a', phase: 'streaming', content: '```ts\nconst a = 1;\n```\n\nMore' });
    const view = render(<Markdown snapshot={owner.getSnapshot()} components={highlight} />);
    const figure = view.container.querySelector('figure');
    expect(figure).not.toBeNull();
    owner.update({ generation: 'a', phase: 'streaming', content: owner.getSnapshot().document.content + ' text' });
    view.rerender(<Markdown snapshot={owner.getSnapshot()} components={highlight} />);
    expect(view.container.querySelector('figure')).toBe(figure);
  });
});
