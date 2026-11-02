import { Fragment, type ReactNode } from 'react';
import { marked, type Token, type Tokens } from 'marked';

/** TSDoc comments are Markdown data, never executable MDX or raw HTML. */
function safeLink(href: string): boolean {
  if (
    href.trim() !== href ||
    [...href].some((character) => character.charCodeAt(0) < 32)
  )
    return false;
  if (href.startsWith('#') || (href.startsWith('/') && !href.startsWith('//')))
    return true;
  try {
    return ['https:', 'http:', 'mailto:'].includes(new URL(href).protocol);
  } catch {
    return false;
  }
}

function inline(tokens: Token[] = []): ReactNode {
  return tokens.map((token, index) => {
    const key = index;
    switch (token.type) {
      case 'strong':
        return (
          <strong key={key}>{inline((token as Tokens.Strong).tokens)}</strong>
        );
      case 'em':
        return <em key={key}>{inline((token as Tokens.Em).tokens)}</em>;
      case 'del':
        return <del key={key}>{inline((token as Tokens.Del).tokens)}</del>;
      case 'codespan':
        return <code key={key}>{(token as Tokens.Codespan).text}</code>;
      case 'link': {
        const link = token as Tokens.Link;
        const content = inline(link.tokens);
        return safeLink(link.href) ? (
          <a key={key} href={link.href}>
            {content}
          </a>
        ) : (
          <Fragment key={key}>{content}</Fragment>
        );
      }
      case 'br':
        return <br key={key} />;
      default:
        return (
          <Fragment key={key}>
            {'text' in token ? String(token.text) : token.raw}
          </Fragment>
        );
    }
  });
}

function blocks(tokens: Token[]): ReactNode {
  return tokens.map((token, index) => {
    switch (token.type) {
      case 'paragraph':
        return <p key={index}>{inline((token as Tokens.Paragraph).tokens)}</p>;
      case 'heading':
        return <h4 key={index}>{inline((token as Tokens.Heading).tokens)}</h4>;
      case 'text':
        return (
          <Fragment key={index}>
            {inline((token as Tokens.Text).tokens ?? [token])}
          </Fragment>
        );
      case 'code':
        return (
          <pre key={index} tabIndex={0}>
            <code>{(token as Tokens.Code).text}</code>
          </pre>
        );
      case 'list': {
        const list = token as Tokens.List;
        const children = list.items.map((item, itemIndex) => (
          <li key={itemIndex}>{blocks(item.tokens)}</li>
        ));
        return list.ordered ? (
          <ol key={index} start={list.start || 1}>
            {children}
          </ol>
        ) : (
          <ul key={index}>{children}</ul>
        );
      }
      case 'blockquote':
        return (
          <blockquote key={index}>
            {blocks((token as Tokens.Blockquote).tokens)}
          </blockquote>
        );
      case 'table': {
        const table = token as Tokens.Table;
        return (
          <div className="docs-table-scroll" key={index}>
            <table>
              <thead>
                <tr>
                  {table.header.map((cell, cellIndex) => (
                    <th key={cellIndex}>{inline(cell.tokens)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex}>{inline(cell.tokens)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      case 'space':
        return null;
      case 'hr':
        return <hr key={index} />;
      default:
        return <p key={index}>{token.raw}</p>;
    }
  });
}

export function ApiMarkdown({ source }: { source: string }) {
  return source ? (
    <div className="api-reference-prose">{blocks(marked.lexer(source))}</div>
  ) : null;
}
