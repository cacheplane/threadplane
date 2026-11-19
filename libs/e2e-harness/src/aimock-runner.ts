// The aimock package is declared via an npm alias in the root package.json so
// application code refers to it by its neutral name only.
import { LLMock } from 'aimock';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface AimockHandle {
  /** Port the mock server is listening on. */
  readonly port: number;
  /** Full base URL the OpenAI SDK should target (includes /v1 suffix). */
  readonly baseUrl: string;
  /** Tear down the server. Safe to call multiple times. */
  stop(): Promise<void>;
}

export interface AimockStartOptions {
  mode: 'replay' | 'record';
  /** Replay: path to a fixture file or directory. Ignored in record mode. */
  fixturePath?: string;
  /** Record: directory where captured fixtures are written. Required in record mode. */
  recordDir?: string;
  /**
   * Replay: a fixed port, for tests that read aimock's request journal
   * (`GET /__aimock/journal`). Default: any free port.
   */
  port?: number;
}

// Raw JSON entry shape passes through to aimock's FixtureFileEntry — the
// `match` block can carry richer discriminators (toolName, hasToolResult,
// turnIndex, etc.) that are needed to distinguish a parent LLM's first call
// from its continuation after a tool round. We don't narrow the shape here;
// aimock's `addFixturesFromJSON` validates structure at load time.
type FixtureFileEntry = Record<string, unknown>;

function loadFixtureEntries(fixturePath: string): FixtureFileEntry[] {
  const stats = statSync(fixturePath);
  const out: FixtureFileEntry[] = [];
  const readFile = (full: string): void => {
    const raw = readFileSync(full, 'utf-8');
    const parsed = JSON.parse(raw) as { fixtures: FixtureFileEntry[] };
    for (const fx of parsed.fixtures) out.push(fx);
  };
  if (stats.isDirectory()) {
    const files = readdirSync(fixturePath)
      .filter((f) => f.endsWith('.json'))
      .sort();
    for (const file of files) readFile(join(fixturePath, file));
    return out;
  }
  readFile(fixturePath);
  return out;
}

export async function startAimock(opts: AimockStartOptions): Promise<AimockHandle> {
  let mock: LLMock;
  if (opts.mode === 'record') {
    if (!opts.recordDir) throw new Error('[aimock-harness] record mode requires recordDir');
    // Proxy unmatched requests to the real provider and capture fixtures.
    // Requests carry the caller's Authorization header upstream, so the
    // spawning process must hold a real OPENAI_API_KEY (see the setup
    // factories / resolveAimockLaunch).
    mock = new LLMock({
      port: 0,
      chunkSize: 4096,
      record: {
        providers: { openai: 'https://api.openai.com' },
        fixturePath: opts.recordDir,
      },
    });
  } else {
    if (!opts.fixturePath) throw new Error('[aimock-harness] replay mode requires fixturePath');
    const entries = loadFixtureEntries(opts.fixturePath);
    // Use a large default chunkSize so ordinary fixture responses arrive in 1-2
    // SSE deltas: most e2e assertions measure the final rendered DOM, and big
    // chunks keep them deterministic. This is a determinism default, not a
    // workaround — streaming-progressive behavior is covered by the unit
    // variance tables and by fixtures that opt into small per-fixture
    // chunkSize/latency values (see the fence fixture in
    // cockpit/chat/messages/angular/e2e/fixtures/c-messages.json).
    mock = new LLMock({ port: opts.port ?? 0, chunkSize: 4096 });
    if (entries.length > 0) {
      mock.addFixturesFromJSON(entries as never);
    }
  }
  await mock.start();

  const port = mock.port;
  const baseUrl = `${mock.url}/v1`;
  let stopped = false;

  return {
    port,
    baseUrl,
    async stop() {
      if (stopped) return;
      stopped = true;
      await mock.stop();
    },
  };
}
