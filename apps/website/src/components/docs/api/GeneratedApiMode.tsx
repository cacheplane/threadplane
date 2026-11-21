import Link from 'next/link';
import { readApiIndex } from '../../../lib/api-reference';
import { resolveNarrativeDocument } from '../../../lib/docs-catalog';
import { ApiIndexView } from './ApiIndexView';

/**
 * The backend packages are framework-neutral: each exports `createSession()`
 * and no framework code. A framework page about one of them also teaches the
 * binding that observes the session (`@threadplane/angular` or
 * `@threadplane/react`), so its reference lists both.
 */
const SESSION_BACKEND_LIBRARIES: readonly string[] = ['langgraph', 'ag-ui'];

/** Use the same extracted declarations as standalone SDK reference pages. */
export function GeneratedApiMode({ docsPath }: { docsPath: string }) {
  const index = readApiIndex();
  const document = resolveNarrativeDocument(docsPath);
  const explicit = document?.apiEntrypointIds;
  const withBinding =
    !!document?.library && SESSION_BACKEND_LIBRARIES.includes(document.library);
  const scoped = index.entrypoints.filter((entry) =>
    explicit?.length
      ? explicit.includes(entry.id)
      : document?.library &&
        (entry.docLibrary === document.library ||
          (withBinding && entry.docLibrary === document.scope)) &&
        (entry.framework === document.scope || entry.framework === 'shared')
  );
  const frameworkEntries =
    document && document.scope !== 'shared'
      ? index.entrypoints.filter(
          (entry) =>
            entry.framework === document.scope || entry.framework === 'shared'
        )
      : index.entrypoints;
  const entrypoints = scoped.length ? scoped : frameworkEntries;
  const ids = new Set(entrypoints.map((entry) => entry.id));
  const scopedIndex = {
    ...index,
    entrypoints,
    symbols: index.symbols.filter((symbol) => ids.has(symbol.entrypointId)),
  };
  return (
    <div className="docs-workspace-article">
      <article className="api-reference-page">
        <h1>API reference</h1>
        <p>Types, signatures, and documentation from the TypeScript source.</p>
        {entrypoints.length < index.entrypoints.length ? (
          <p>
            <Link href="/docs/api">Browse all packages ↗</Link>
          </p>
        ) : null}
        <ApiIndexView
          key={docsPath}
          index={scopedIndex}
          defaultView={document?.library ? 'symbols' : 'entrypoints'}
        />
      </article>
    </div>
  );
}
