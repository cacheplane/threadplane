'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { DocsExample } from '../../lib/docs-examples';
import { DocsSelect } from '../docs/DocsSelect';
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
          <DocsSelect
            label="Framework"
            value={selectedFramework}
            onChange={setFramework}
            options={[
              { value: 'all', label: 'All frameworks' },
              { value: 'angular', label: 'Angular' },
              { value: 'react', label: 'React' },
            ]}
          />
          <DocsSelect
            label="Library"
            value={library}
            onChange={setLibrary}
            options={[
              { value: 'all', label: 'All libraries' },
              ...libraries.map((item) => ({
                value: item,
                label:
                  examples.find((example) => example.library === item)
                    ?.libraryLabel ?? item,
              })),
            ]}
          />
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
