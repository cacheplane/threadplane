import { Fragment, type CSSProperties } from 'react';
import { codeToTokens } from 'shiki';
import Link from 'next/link';
import type { ApiToken } from '../../../lib/api-reference-model';
import { Pre } from '../mdx/CodeBlock';

/** Highlight exact declaration text, splitting syntax tokens at reference edges. */
export async function ApiCode({ tokens }: { tokens: ApiToken[] }) {
  let position = 0;
  const ranges = tokens.flatMap((token) => {
    const start = position;
    position += token.text.length;
    return token.href ? [{ start, end: position, href: token.href }] : [];
  });
  const code = tokens.map((token) => token.text).join('');
  const highlighted = await codeToTokens(code, {
    lang: 'typescript',
    theme: 'tokyo-night',
  });
  return (
    <Pre
      className="api-reference-code"
      tabIndex={0}
      aria-label="TypeScript declaration"
    >
      <code>
        {highlighted.tokens.map((line, lineIndex) => (
          <Fragment key={lineIndex}>
            {line.map((token, tokenIndex) => {
              const start = token.offset;
              const end = start + token.content.length;
              const boundaries = [
                ...new Set([
                  start,
                  end,
                  ...ranges
                    .flatMap((range) => [range.start, range.end])
                    .filter((edge) => edge > start && edge < end),
                ]),
              ].sort((a, b) => a - b);
              return (
                <Fragment key={tokenIndex}>
                  {boundaries.slice(0, -1).map((edge, segmentIndex) => {
                    const text = token.content.slice(
                      edge - start,
                      boundaries[segmentIndex + 1] - start
                    );
                    const range = ranges.find(
                      (candidate) =>
                        candidate.start <= edge && candidate.end > edge
                    );
                    const content = (
                      <span
                        className="api-reference-highlight"
                        style={
                          { '--api-token-color': token.color } as CSSProperties
                        }
                      >
                        {text}
                      </span>
                    );
                    return range ? (
                      <Link key={edge} href={range.href}>
                        {content}
                      </Link>
                    ) : (
                      <Fragment key={edge}>{content}</Fragment>
                    );
                  })}
                </Fragment>
              );
            })}
            {lineIndex < highlighted.tokens.length - 1 ? '\n' : ''}
          </Fragment>
        ))}
      </code>
    </Pre>
  );
}
