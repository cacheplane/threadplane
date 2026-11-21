import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, type ThreadState } from '@langchain/langgraph-sdk';
// eslint-disable-next-line @nx/enforce-module-boundaries -- The harness index also loads browser test helpers; this suite needs only the model replay.
import { startAimock } from '../../e2e-harness/src/aimock-runner';
import { createSession } from '../src/runtime/create-session';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export interface LiveBackendOptions {
  /** Repo-relative path of the Python LangGraph project. */
  readonly python: string;
  /** The graph id the project's `langgraph.json` registers. */
  readonly graph: string;
  /** Repo-relative fixture files, replayed in the order given. */
  readonly fixtures: readonly string[];
}

export interface LiveBackend {
  /** The `langgraph dev` API root. */
  readonly url: string;
  readonly graph: string;
  /** A plain SDK client on the same server, for facts a session cannot see. */
  readonly client: Client;
  /** Creates an empty thread and returns its id. */
  thread(): Promise<string>;
  /** The newest saved state of a thread, as the server holds it. */
  saved(threadId: string): Promise<ThreadState>;
  stop(): Promise<void>;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done, failed) => {
    server.once('error', failed);
    server.listen(0, '127.0.0.1', done);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('No port could be reserved.');
  await new Promise<void>((done) => server.close(() => done()));
  return address.port;
}

/** Ends the whole process group: `uv` starts Python, which starts the server. */
async function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid)
    return;
  const closed = new Promise<void>((done) => child.once('close', () => done()));
  const signal = (name: NodeJS.Signals) => {
    try {
      process.kill(-(child.pid as number), name);
    } catch {
      /* The group is already gone. */
    }
  };
  signal('SIGTERM');
  const forced = setTimeout(() => signal('SIGKILL'), 5000);
  await closed;
  clearTimeout(forced);
}

/**
 * Starts the model replay and a real `langgraph dev` process for one Python
 * graph. Nothing leaves the machine: the graph's OpenAI client is pointed at
 * the replay server, which answers from the recorded fixtures.
 */
export async function startLiveBackend(
  options: LiveBackendOptions
): Promise<LiveBackend> {
  // One fixture file for the replay server, in the order the suite listed.
  const temporary = mkdtempSync(join(tmpdir(), 'langgraph-live-'));
  const fixtures = options.fixtures.flatMap(
    (path) =>
      (
        JSON.parse(readFileSync(join(root, path), 'utf8')) as {
          fixtures: unknown[];
        }
      ).fixtures
  );
  const fixturePath = join(temporary, 'fixtures.json');
  writeFileSync(fixturePath, JSON.stringify({ fixtures }));
  const model = await startAimock({ mode: 'replay', fixturePath });
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  let output = '';
  const child = spawn(
    'uv',
    [
      'run',
      'langgraph',
      'dev',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--no-browser',
      '--no-reload',
    ],
    {
      cwd: join(root, options.python),
      env: {
        ...process.env,
        OPENAI_BASE_URL: model.baseUrl,
        OPENAI_API_KEY: 'test-not-used',
        LANGGRAPH_API_URL: url,
        LANGSMITH_TRACING: 'false',
        LANGCHAIN_TRACING_V2: 'false',
        LANGGRAPH_CLI_NO_ANALYTICS: '1',
      },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  for (const stream of [child.stdout, child.stderr])
    stream?.on('data', (chunk) => {
      output = (output + String(chunk)).slice(-20_000);
    });
  const stop = async () => {
    await Promise.allSettled([terminate(child), model.stop()]);
    rmSync(temporary, { recursive: true, force: true });
  };
  const client = new Client({ apiUrl: url, apiKey: null as never });
  try {
    const deadline = Date.now() + 120_000;
    for (;;) {
      if (child.exitCode !== null)
        throw new Error(`langgraph dev exited (${child.exitCode}).`);
      if (Date.now() > deadline)
        throw new Error('langgraph dev did not become ready in time.');
      try {
        const ok = await fetch(`${url}/ok`, {
          signal: AbortSignal.timeout(1000),
        });
        if (ok.ok) {
          const assistants = await client.assistants.search({ limit: 100 });
          if (assistants.some((entry) => entry.graph_id === options.graph))
            break;
        }
      } catch {
        /* The server is still starting. */
      }
      await new Promise((done) => setTimeout(done, 250));
    }
  } catch (error) {
    await stop();
    throw new Error(
      `${(error as Error).message}\n${options.python}\n${output.slice(-4000)}`
    );
  }
  return {
    url,
    graph: options.graph,
    client,
    async thread() {
      return (await client.threads.create()).thread_id;
    },
    saved: (threadId) => client.threads.getState(threadId),
    stop,
  };
}

type Options = Parameters<typeof createSession>[0];

/** What a live session is created with beside the backend's address. */
export type LiveSessionOptions = Omit<
  Options,
  'assistantId' | 'apiUrl' | 'transport' | 'tools'
>;

/**
 * A real session on the owned SDK transport, as an application creates one.
 * Without a `threadId` the session creates its thread on the first submit.
 */
export function liveSession(
  backend: LiveBackend,
  options: LiveSessionOptions = {}
) {
  return createSession({
    assistantId: backend.graph,
    apiUrl: backend.url,
    ...options,
  });
}

/** Records every snapshot a session publishes, oldest first. */
export function recordSnapshots<S>(session: {
  getSnapshot(): S;
  subscribe(notify: () => void): () => void;
}): { readonly snapshots: readonly S[]; release(): void } {
  const snapshots: S[] = [session.getSnapshot()];
  const release = session.subscribe(() =>
    snapshots.push(session.getSnapshot())
  );
  return { snapshots, release };
}

/** Resolves once the session publishes a snapshot the predicate accepts. */
export function settled<S>(
  session: { getSnapshot(): S; subscribe(notify: () => void): () => void },
  accept: (snapshot: S) => boolean,
  timeoutMs = 60_000
): Promise<S> {
  return new Promise<S>((done, failed) => {
    let release: () => void = () => undefined;
    const timer = setTimeout(() => {
      release();
      failed(
        new Error(
          `The session did not reach the expected state: ${JSON.stringify(
            session.getSnapshot()
          ).slice(0, 2000)}`
        )
      );
    }, timeoutMs);
    const check = () => {
      const snapshot = session.getSnapshot();
      if (!accept(snapshot)) return false;
      clearTimeout(timer);
      release();
      done(snapshot);
      return true;
    };
    release = session.subscribe(check);
    check();
  });
}
