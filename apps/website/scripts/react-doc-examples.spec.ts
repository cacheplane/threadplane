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
  'chat/concepts/message-model',
  'render/getting-started/quickstart',
  'render/guides/events',
];

it('compiles the exact self-contained React onboarding examples against public source APIs', () => {
  const directory = mkdtempSync(
    join(tmpdir(), 'threadplane-react-doc-examples-')
  );
  try {
    const files = pages.map((page, index) => {
      const source = readFileSync(
        join(repo, 'apps/website/content/docs/react', `${page}.mdx`),
        'utf8'
      );
      const examples = [...source.matchAll(/^~~~tsx\n([\s\S]*?)^~~~$/gm)];
      expect(examples, page).toHaveLength(1);
      const file = join(directory, `${index}-${page.replaceAll('/', '-')}.tsx`);
      writeFileSync(file, examples[0][1]);
      return file;
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
    if (!parsed) throw new Error('Unable to load the React example compiler configuration');
    const options = {
      ...parsed.options,
      typeRoots: [join(repo, 'node_modules/@types')],
      paths: {
        ...parsed.options.paths,
        react: [join(repo, 'node_modules/@types/react/index.d.ts')],
        'react/jsx-runtime': [
          join(repo, 'node_modules/@types/react/jsx-runtime.d.ts'),
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
