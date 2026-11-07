'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { WorkbenchSeparator } from './WorkbenchSeparator';
import { sourceHref, type LearningSource } from './learning-lesson';

export function LearningSourceView({
  source,
  filesWidth,
  onFilesWidth,
  visible = true,
  focusRequest,
}: {
  readonly source: LearningSource;
  readonly filesWidth: number;
  readonly onFilesWidth: (value: number, persist: boolean) => void;
  readonly visible?: boolean;
  readonly focusRequest?: number;
}) {
  const [selected, setSelected] = useState(source.snippet.path);
  const file =
    source.files.find((item) => item.path === selected) ?? source.files[0];
  const container = useRef<HTMLDivElement>(null);
  const code = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (focusRequest !== undefined) setSelected(source.snippet.path);
  }, [focusRequest, source.snippet.path]);
  useEffect(() => {
    if (!visible) return;
    const pre = code.current;
    const first = pre?.querySelector<HTMLElement>('[data-highlighted]');
    if (pre)
      pre.scrollTop = first
        ? Math.max(
            0,
            first.getBoundingClientRect().top -
              pre.getBoundingClientRect().top +
              pre.scrollTop -
              24
          )
        : 0;
  }, [file, visible, focusRequest]);

  return (
    <div
      ref={container}
      className="tp-learn-source-body"
      style={{ '--learn-files-width': `${filesWidth}px` } as CSSProperties}
    >
      <nav className="tp-learn-source-files" aria-label="Lesson source files">
        {source.files.map((item) => (
          <button
            key={item.path}
            type="button"
            aria-pressed={file.path === item.path}
            title={item.path}
            onClick={() => setSelected(item.path)}
          >
            {item.path.split('/').at(-1)}
          </button>
        ))}
      </nav>
      <WorkbenchSeparator
        label="Resize source file list"
        orientation="vertical"
        value={filesWidth}
        min={140}
        max={320}
        step={16}
        defaultValue={190}
        onChange={onFilesWidth}
        valueFromPointer={(event) =>
          event.clientX - (container.current?.getBoundingClientRect().left ?? 0)
        }
      />
      <section
        className="tp-learn-source-file"
        aria-label="Selected lesson source"
      >
        <div className="tp-learn-pane-heading">
          <strong>{file.path.split('/').at(-1)}</strong>
          <a
            href={sourceHref(source.revision, file.path, file.highlights[0])}
            target="_blank"
            rel="noreferrer"
          >
            View file on GitHub
          </a>
        </div>
        <pre ref={code} aria-label="Lesson source code" tabIndex={0}>
          <code>
            {file.source.split('\n').map((line, index) => {
              const number = index + 1;
              const highlighted = file.highlights.some(
                (range) => number >= range.start && number <= range.end
              );
              return (
                <span
                  key={number}
                  className="tp-learn-source-line"
                  data-highlighted={highlighted || undefined}
                  aria-label={
                    highlighted
                      ? `Highlighted lesson line ${number}`
                      : undefined
                  }
                >
                  <span aria-hidden="true" className="tp-learn-source-number">
                    {number}
                  </span>
                  {line || ' '}
                </span>
              );
            })}
          </code>
        </pre>
        <div className="tp-learn-source-revision">
          Docs source at {source.revision.slice(0, 8)}
        </div>
      </section>
    </div>
  );
}
