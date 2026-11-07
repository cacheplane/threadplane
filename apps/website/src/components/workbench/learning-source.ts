import type { LearningSource, SourceRange } from './learning-lesson';

/** Exact excerpts fail at build time when the actual cockpit source changes. */
export function findSourceExcerpt(
  source: string,
  excerpt: string,
  path: string
): SourceRange {
  const index = source.indexOf(excerpt);
  if (index < 0)
    throw new Error(`${path}: learning excerpt could not be found: ${excerpt}`);
  if (source.indexOf(excerpt, index + 1) >= 0)
    throw new Error(`${path}: ambiguous learning excerpt: ${excerpt}`);
  const start = source.slice(0, index).split('\n').length;
  return { start, end: start + excerpt.split('\n').length - 1 };
}

export function createLearningSource(
  framework: 'angular' | 'react',
  sources: Readonly<Record<string, string>>,
  revision: string
): LearningSource {
  if (!/^[a-f0-9]{40}$/.test(revision))
    throw new Error('Learning source requires a full docs build revision.');
  const directory = `cockpit/langgraph/streaming/${framework}/src/`;
  const paths =
    framework === 'react'
      ? ['app.tsx', 'application.ts', 'connection.ts'].map(
          (file) => directory + file
        )
      : ['streaming.component.ts', 'app.config.ts'].map(
          (file) => directory + 'app/' + file
        );
  const excerpt =
    framework === 'react'
      ? 'const snapshot = useAgent(application);'
      : 'private readonly sourceAgent = injectAgent(STREAMING_AGENT);';
  const files = paths.map((path, index) => {
    const source = sources[path];
    if (source === undefined)
      throw new Error(
        `${path}: learning source is missing from the cockpit content bundle.`
      );
    return {
      path,
      source,
      highlights: index === 0 ? [findSourceExcerpt(source, excerpt, path)] : [],
    };
  });
  const [file] = files;
  const range = file.highlights[0];
  return {
    revision,
    files,
    snippet: {
      path: file.path,
      ...range,
      code: file.source
        .split('\n')
        .slice(range.start - 1, range.end)
        .join('\n'),
    },
  };
}
