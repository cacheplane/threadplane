'use client';
import {
  Fragment,
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import {
  markdownUrl,
  type CitationDefinition,
  type MarkdownNode,
  type MarkdownSnapshot,
} from '@threadplane/content/markdown';
import { MarkdownImage } from './markdown-image.js';
import type { Citation } from '@threadplane/core';
import { InlineCitation } from './inline-citation.js';
import { writeClipboard } from './clipboard.js';

/** Supplies the accepted Markdown snapshot to present, with parser ownership retained by the caller. */
export interface MarkdownProps {
  readonly snapshot: MarkdownSnapshot;
  /** Per-message source metadata; exact IDs take precedence over Markdown definitions. */
  readonly citations?: readonly Citation[];
  /** Show local, connected source details instead of direct citation links. */
  readonly citationPreview?: boolean;
  /**
   * Typesets math. Called with the LaTeX between the delimiters and whether it is display math, it
   * returns an HTML string that is inserted as markup, so return only your renderer's own output,
   * such as KaTeX's `renderToString` with `throwOnError: true`. When it throws or returns nothing,
   * and when it is not set, the source is shown with its delimiters. Keep it stable; a new function
   * typesets every formula again.
   */
  readonly math?: (
    latex: string,
    options: { readonly display: boolean }
  ) => string | null | undefined;
  /**
   * Replaces how chosen node types render, such as `'code-block'` for a highlighter. Entries win
   * over a `MarkdownComponentsProvider` above, type by type; other types keep the built-in view.
   * Define the map and its components outside render: a new component type remounts its nodes.
   */
  readonly components?: MarkdownComponents;
}

/** A node type a `MarkdownComponents` entry can replace. */
export type MarkdownNodeType = MarkdownNode['type'];

/** What a replacement for one node type receives. */
export interface MarkdownComponentProps<
  T extends MarkdownNodeType = MarkdownNodeType
> {
  /** The node, including its streaming `status`; `'complete'` once its source is closed. */
  readonly node: Extract<MarkdownNode, { readonly type: T }>;
  /** The node's children, already rendered (and replaced where an entry asks). Null for a leaf. */
  readonly children: ReactNode;
  /**
   * The link or image URL after the library's URL policy, or undefined when the policy refused it
   * or the node has none. Use it instead of `node.url`.
   */
  readonly url: string | undefined;
  /** The built-in rendering of this node, to wrap or to fall back to while it streams. */
  readonly defaultView: ReactNode;
}

/** Replacement components keyed by node type. */
export type MarkdownComponents = {
  readonly [T in MarkdownNodeType]?: ComponentType<MarkdownComponentProps<T>>;
};

const MarkdownComponentsContext = createContext<MarkdownComponents | undefined>(
  undefined
);

/**
 * Supplies `MarkdownComponents` to every `Markdown` below it, including the ones `Chat` and
 * `MessageList` render. A provider nested inside another adds to the outer one, type by type.
 * Keep `components` stable.
 */
export function MarkdownComponentsProvider({
  components,
  children,
}: {
  readonly components: MarkdownComponents;
  readonly children?: ReactNode;
}) {
  const merged = useMergedComponents(components);
  return (
    <MarkdownComponentsContext.Provider value={merged}>
      {children}
    </MarkdownComponentsContext.Provider>
  );
}

/** The provided components with `own` entries winning, type by type. */
function useMergedComponents(
  own: MarkdownComponents | undefined
): MarkdownComponents | undefined {
  const provided = useContext(MarkdownComponentsContext);
  return useMemo(
    () => (own && provided ? { ...provided, ...own } : own ?? provided),
    [own, provided]
  );
}

/** Present an accepted snapshot. Its lifetime belongs to the application. */
export function Markdown({
  snapshot,
  citations = [],
  citationPreview = false,
  math,
  components: own,
}: MarkdownProps) {
  const components = useMergedComponents(own);
  const sources = new Map(citations.map((citation) => [citation.id, citation]));
  if (sources.size !== citations.length)
    throw new TypeError('Duplicate citation IDs in Markdown.');
  return (
    <div
      dir="auto"
      className="tp-markdown"
      style={{
        color: 'var(--tp-chat-text, var(--ds-text-primary, CanvasText))',
        fontFamily: 'inherit',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
      }}
    >
      {snapshot.root && (
        <NodeView
          key={snapshot.document.generation}
          node={snapshot.root}
          citations={snapshot.root.citations}
          sources={sources}
          citationPreview={citationPreview}
          math={math}
          components={components}
        />
      )}
    </div>
  );
}

/** Typeset math, or null to show the source. Memoized so a streaming reply does not typeset each formula per token. */
function useMath(
  math: MarkdownProps['math'],
  latex: string,
  display: boolean
): string | null {
  return useMemo(() => {
    if (!math) return null;
    try {
      const html = math(latex, { display });
      return typeof html === 'string' && html.length > 0 ? html : null;
    } catch {
      return null;
    }
  }, [math, latex, display]);
}

interface MathProps {
  readonly latex: string;
  readonly math: MarkdownProps['math'];
  readonly source: string;
}

function InlineMath({ latex, math, source }: MathProps) {
  const html = useMath(math, latex, false);
  return html === null ? (
    <span>{source}</span>
  ) : (
    <span
      className="tp-markdown__math"
      style={{ whiteSpace: 'normal' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function DisplayMath({ latex, math, source }: MathProps) {
  const html = useMath(math, latex, true);
  return html === null ? (
    <pre style={{ whiteSpace: 'pre-wrap' }}>{source}</pre>
  ) : (
    // A wide formula scrolls inside its own block instead of widening the message.
    <div
      className="tp-markdown__math tp-markdown__math--display"
      style={{
        whiteSpace: 'normal',
        overflowX: 'auto',
        overflowY: 'hidden',
        maxInlineSize: '100%',
        textAlign: 'center',
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

interface NodeViewProps {
  readonly math?: MarkdownProps['math'];
  readonly components: MarkdownComponents | undefined;
  readonly node: MarkdownNode;
  readonly citations: ReadonlyMap<string, CitationDefinition>;
  readonly sources: ReadonlyMap<string, Citation>;
  readonly header?: boolean;
  readonly insideAnchor?: boolean;
  readonly citationPreview?: boolean;
}

function NodeView({
  node,
  citations,
  sources,
  header = false,
  insideAnchor = false,
  citationPreview = false,
  math,
  components,
}: NodeViewProps) {
  const href =
    !insideAnchor &&
    (node.type === 'link' ||
      node.type === 'autolink' ||
      (node.type === 'link-reference' && node.resolved))
      ? markdownUrl(node.url, 'link')
      : undefined;
  const children =
    'children' in node
      ? node.children.map((child) => (
          <NodeView
            key={`${child.type}:${child.id}`}
            node={child}
            citations={citations}
            sources={sources}
            citationPreview={citationPreview}
            math={math}
            components={components}
            header={node.type === 'table-row' && node.isHeader}
            insideAnchor={insideAnchor || href !== undefined}
          />
        ))
      : null;
  const view = builtInView({
    node,
    citations,
    sources,
    header,
    insideAnchor,
    citationPreview,
    math,
    components,
    href,
    children,
  });
  const Replacement = components?.[node.type] as
    | ComponentType<MarkdownComponentProps>
    | undefined;
  if (!Replacement) return view;
  return (
    <Replacement
      node={node}
      url={
        node.type === 'image'
          ? markdownUrl(node.url, 'image')
          : href || undefined
      }
      defaultView={view}
    >
      {children}
    </Replacement>
  );
}

/** The library's own rendering of one node. */
function builtInView({
  node,
  citations,
  sources,
  header = false,
  insideAnchor = false,
  citationPreview = false,
  math,
  components,
  href,
  children,
}: NodeViewProps & {
  readonly href: string | undefined;
  readonly children: ReactNode;
}): ReactNode {
  switch (node.type) {
    case 'document':
      return <Fragment>{children}</Fragment>;
    case 'paragraph':
      return <p>{children}</p>;
    case 'heading':
      return createElement(`h${node.level}`, null, children);
    case 'blockquote':
      return <blockquote>{children}</blockquote>;
    case 'list':
      return node.ordered ? (
        <ol start={node.start ?? undefined}>{children}</ol>
      ) : (
        <ul>{children}</ul>
      );
    case 'list-item':
      return (
        <li className={node.task ? 'tp-markdown__task' : undefined}>
          {node.task && (
            <span className="tp-markdown__task-check">
              <input
                className="tp-markdown__task-input"
                type="checkbox"
                checked={node.task.checked}
                disabled
                aria-label={
                  node.task.checked ? 'Completed task' : 'Incomplete task'
                }
              />
              <span
                className="tp-markdown__task-box"
                data-checked={node.task.checked}
                aria-hidden="true"
              >
                {node.task.checked && (
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    focusable="false"
                  >
                    <path
                      d="m2 6 2.5 2.5L10 3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
            </span>
          )}
          {children}
        </li>
      );
    case 'code-block':
      return <CodeBlock node={node} />;
    case 'thematic-break':
      return <hr />;
    case 'text':
      return node.text;
    case 'emphasis':
      return <em>{children}</em>;
    case 'strong':
      return <strong>{children}</strong>;
    case 'strikethrough':
      return <del>{children}</del>;
    case 'inline-code':
      return <code>{node.text}</code>;
    case 'link': {
      return href ? (
        <a href={href} title={node.title || undefined}>
          {children}
        </a>
      ) : (
        <Fragment>{children}</Fragment>
      );
    }
    case 'autolink': {
      return href ? <a href={href}>{node.text}</a> : node.text;
    }
    case 'image': {
      const src = markdownUrl(node.url, 'image');
      return (
        <MarkdownImage key={src} src={src} alt={node.alt} title={node.title} />
      );
    }
    case 'soft-break':
      return '\n';
    case 'hard-break':
      return <br />;
    case 'table':
      return (
        <div
          className="tp-markdown__table-scroll"
          role="group"
          aria-label="Table"
          tabIndex={0}
        >
          <table>
            <thead>
              {node.children
                .filter((row) => row.isHeader)
                .map((row) => (
                  <NodeView
                    key={`${row.type}:${row.id}`}
                    node={row}
                    citations={citations}
                    sources={sources}
                    citationPreview={citationPreview}
                    math={math}
                    components={components}
                    insideAnchor={insideAnchor}
                  />
                ))}
            </thead>
            <tbody>
              {node.children
                .filter((row) => !row.isHeader)
                .map((row) => (
                  <NodeView
                    key={`${row.type}:${row.id}`}
                    node={row}
                    citations={citations}
                    sources={sources}
                    citationPreview={citationPreview}
                    math={math}
                    components={components}
                    insideAnchor={insideAnchor}
                  />
                ))}
            </tbody>
          </table>
        </div>
      );
    case 'table-row':
      return <tr>{children}</tr>;
    case 'table-cell':
      return header ? (
        <th style={{ textAlign: node.alignment ?? undefined }}>{children}</th>
      ) : (
        <td style={{ textAlign: node.alignment ?? undefined }}>{children}</td>
      );
    case 'citation-reference': {
      return (
        <InlineCitation
          refId={node.refId}
          sources={sources}
          definitions={citations}
          insideAnchor={insideAnchor}
          preview={citationPreview}
        />
      );
    }
    case 'link-reference': {
      if (node.resolved)
        return href ? (
          <a href={href} title={node.title || undefined}>
            {children}
          </a>
        ) : (
          <Fragment>{children}</Fragment>
        );
      return (
        <Fragment>
          [{children}]
          {node.form === 'full'
            ? `[${node.label}]`
            : node.form === 'collapsed'
            ? '[]'
            : ''}
        </Fragment>
      );
    }
    case 'math-inline':
      return (
        <InlineMath
          latex={node.text}
          math={math}
          source={
            node.delimiter === '$' ? `$${node.text}$` : `\\(${node.text}\\)`
          }
        />
      );
    case 'math-display':
      return (
        <DisplayMath
          latex={node.text}
          math={math}
          source={
            node.delimiter === '$$'
              ? `$$\n${node.text}\n$$`
              : `\\[${node.text}\\]`
          }
        />
      );
    case 'html-inline':
      return node.raw;
    case 'html-block':
      return <pre style={{ whiteSpace: 'pre-wrap' }}>{node.raw}</pre>;
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

/** A fenced or indented block, with a Copy button once its source is closed. */
function CodeBlock({
  node,
}: {
  readonly node: Extract<MarkdownNode, { readonly type: 'code-block' }>;
}) {
  return (
    <div className="tp-markdown__code" style={{ position: 'relative' }}>
      <pre
        dir="ltr"
        style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
      >
        <code className={languageClass(node.language)}>{node.text}</code>
      </pre>
      {node.status === 'complete' && <MarkdownCopyButton text={node.text} />}
    </div>
  );
}

/**
 * The code block's Copy button, for a replacement `'code-block'` that draws its own `<pre>`. Put it
 * in the same `tp-markdown__code` element as that `<pre>`: the chat stylesheet places it at the
 * element's top inline-end corner and shows it on hover and focus.
 */
export function MarkdownCopyButton({ text }: { readonly text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  const label = copied ? 'Copied' : 'Copy code';
  return (
    <button
      type="button"
      className="tp-markdown__code-copy"
      aria-label={label}
      title={label}
      data-copied={copied ? '' : undefined}
      onClick={(event) => {
        writeClipboard(event.currentTarget.ownerDocument, text).then(
          (written) => {
            if (!written || !mounted.current) return;
            setCopied(true);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 2000);
          },
          () => undefined
        );
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {copied ? (
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        ) : (
          <>
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </>
        )}
      </svg>
    </button>
  );
}

/**
 * The conventional `language-*` class for a fenced block, so an application's
 * highlighter can find it. The language is the author's text, so only its first
 * word is used, and only when it is a plain identifier.
 */
function languageClass(language: unknown): string | undefined {
  if (typeof language !== 'string') return undefined;
  const name = /^[A-Za-z0-9_+#.-]{1,32}$/.exec(
    language.trim().split(/\s/, 1)[0]
  )?.[0];
  return name === undefined ? undefined : `language-${name}`;
}
