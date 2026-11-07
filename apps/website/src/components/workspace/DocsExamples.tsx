'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { DocsExample } from '../../lib/docs-examples';
import { AngularMark, ReactMark } from '../ui/FrameworkMarks';

export function DocsExamples({
  examples,
  framework = 'all',
}: {
  examples: readonly DocsExample[];
  framework?: 'angular' | 'react' | 'all';
}) {
  const [query, setQuery] = useState('');
  const [selectedFramework, setFramework] = useState(framework);
  const [library, setLibrary] = useState('all');
  const libraries = [
    ...new Set(examples.map((example) => example.library)),
  ].sort();
  const filtered = examples.filter(
    (example) =>
      (selectedFramework === 'all' ||
        example.framework === selectedFramework) &&
      (library === 'all' || example.library === library) &&
      `${example.title} ${example.description} ${example.library}`
        .toLowerCase()
        .includes(query.trim().toLowerCase())
  );
  return (
    <div className="docs-workspace-article">
      <section className="docs-examples" aria-labelledby="examples-heading">
        <header>
          <h1 id="examples-heading">See it in action.</h1>
          <p>
            Explore working examples. Pick a capability, run it, and make it
            yours.
          </p>
        </header>
        <div className="docs-examples-filters">
          <label>
            Find an example
            <input
              type="search"
              placeholder="Streaming, tools, approvals…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label>
            Framework
            <select
              value={selectedFramework}
              onChange={(event) =>
                setFramework(event.target.value as typeof framework)
              }
            >
              <option value="all">All frameworks</option>
              <option value="angular">Angular</option>
              <option value="react">React</option>
            </select>
          </label>
          <label>
            Library
            <select
              value={library}
              onChange={(event) => setLibrary(event.target.value)}
            >
              <option value="all">All libraries</option>
              {libraries.map((item) => (
                <option key={item} value={item}>
                  {examples.find((example) => example.library === item)
                    ?.libraryLabel ?? item}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="docs-examples-count" role="status">
          {filtered.length} {filtered.length === 1 ? 'example' : 'examples'}
        </p>
        {filtered.length ? (
          <div className="docs-examples-grid">
            {filtered.map((example) => (
              <Link
                href={example.href}
                className="docs-example-card"
                key={example.href}
              >
                <span className="docs-example-meta">
                  {example.framework === 'angular' ? (
                    <AngularMark />
                  ) : (
                    <ReactMark />
                  )}
                  {example.framework === 'angular' ? 'Angular' : 'React'}
                  <span>{example.libraryLabel}</span>
                </span>
                <h2>{example.title}</h2>
                <p>{example.description}</p>
                <span className="docs-example-action">
                  Run example <ArrowUpRight size={17} aria-hidden="true" />
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="docs-examples-empty">
            <h2>No examples match.</h2>
            <p>Try another search or clear the filters.</p>
            <button
              onClick={() => {
                setQuery('');
                setFramework('all');
                setLibrary('all');
              }}
            >
              Show all examples
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
