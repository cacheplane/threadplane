'use client';
import { Fragment, createElement } from 'react';
import {
  markdownUrl,
  type CitationDefinition,
  type MarkdownNode,
  type MarkdownSnapshot,
} from '@threadplane/content/markdown';
import { MarkdownImage } from './markdown-image.js';

export interface MarkdownProps {
  readonly snapshot: MarkdownSnapshot;
}
/** Present an accepted snapshot. Its lifetime belongs to the application. */
export function Markdown({ snapshot }: MarkdownProps) {
  return (
    <div
      style={{
        color: 'var(--ds-text-primary, #142435)',
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
        />
      )}
    </div>
  );
}

function NodeView({
  node,
  citations,
  header = false,
  insideAnchor = false,
}: {
  readonly node: MarkdownNode;
  readonly citations: ReadonlyMap<string, CitationDefinition>;
  readonly header?: boolean;
  readonly insideAnchor?: boolean;
}) {
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
            header={node.type === 'table-row' && node.isHeader}
            insideAnchor={insideAnchor || href !== undefined}
          />
        ))
      : null;
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
        <li>
          {node.task && (
            <input
              type="checkbox"
              checked={node.task.checked}
              disabled
              aria-label={
                node.task.checked ? 'Completed task' : 'Incomplete task'
              }
            />
          )}
          {children}
        </li>
      );
    case 'code-block':
      return (
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          <code>{node.text}</code>
        </pre>
      );
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
        <table>
          <thead>
            {node.children
              .filter((row) => row.isHeader)
              .map((row) => (
                <NodeView
                  key={`${row.type}:${row.id}`}
                  node={row}
                  citations={citations}
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
                  insideAnchor={insideAnchor}
                />
              ))}
          </tbody>
        </table>
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
      // Parser 0.5.8 can overwrite the node's index with its sibling position.
      const definition = citations.get(node.refId);
      return definition ? (
        <sup aria-label={`Citation ${definition.index}`}>
          [{definition.index}]
        </sup>
      ) : (
        <sup aria-label={`Unresolved citation ${node.refId}`}>
          [^{node.refId}]
        </sup>
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
        <span>
          {node.delimiter === '$' ? `$${node.text}$` : `\\(${node.text}\\)`}
        </span>
      );
    case 'math-display':
      return (
        <pre style={{ whiteSpace: 'pre-wrap' }}>
          {node.delimiter === '$$'
            ? `$$\n${node.text}\n$$`
            : `\\[${node.text}\\]`}
        </pre>
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
