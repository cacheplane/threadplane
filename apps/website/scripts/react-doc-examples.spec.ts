import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

const repo = resolve(__dirname, '../../..');
const pages = [
  'langgraph/concepts/agent-contract',
  'chat/components/chat',
  'chat/components/chat-message-list',
  'chat/components/chat-popup',
  'chat/components/chat-reasoning',
  'chat/components/chat-error',
  'chat/components/typing-indicator',
  'chat/components/scroll-bubble',
  'chat/components/chat-message',
  'chat/components/chat-select',
  'chat/a2ui/surface-component',
  'chat/concepts/message-model',
  'render/getting-started/quickstart',
  'render/guides/events',
];

it('compiles the exact self-contained React onboarding examples against public source APIs', () => {
  const directory = mkdtempSync(
    join(tmpdir(), 'threadplane-react-doc-examples-')
  );
  try {
    // Every tsx example on a listed page compiles on its own.
    const files = pages.flatMap((page, index) => {
      const source = readFileSync(
        join(repo, 'apps/website/content/docs/react', `${page}.mdx`),
        'utf8'
      );
      const examples = [...source.matchAll(/^~~~tsx\n([\s\S]*?)^~~~$/gm)];
      expect(examples.length, page).toBeGreaterThan(0);
      return examples.map((example, position) => {
        const file = join(
          directory,
          `${index}-${position}-${page.replaceAll('/', '-')}.tsx`
        );
        writeFileSync(file, example[1]);
        return file;
      });
    });
    const configPath = join(
      repo,
      'apps/website/scripts/whitepapers/tsconfig.react.json'
    );
    const parsed = ts.getParsedCommandLineOfConfigFile(
      configPath,
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
          throw new Error(
            ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
          );
        },
      }
    );
    expect(parsed).toBeDefined();
    if (!parsed)
      throw new Error(
        'Unable to load the React example compiler configuration'
      );
    const options = {
      ...parsed.options,
      typeRoots: [join(repo, 'node_modules/@types')],
      paths: {
        ...parsed.options.paths,
        react: [join(repo, 'node_modules/@types/react/index.d.ts')],
        'react/jsx-runtime': [
          join(repo, 'node_modules/@types/react/jsx-runtime.d.ts'),
        ],
        // Testing examples import their runner and renderer.
        vitest: [join(repo, 'node_modules/vitest')],
        '@testing-library/react': [
          join(repo, 'node_modules/@testing-library/react'),
        ],
      },
    };
    const program = ts.createProgram(files, options);
    const diagnostics = [
      ...parsed.errors,
      ...ts.getPreEmitDiagnostics(program),
    ];
    expect(
      ts.formatDiagnostics(diagnostics, {
        getCurrentDirectory: () => repo,
        getCanonicalFileName: (file) => file,
        getNewLine: () => '\n',
      })
    ).toBe('');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 90_000);
