import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { basename, resolve } from 'path';
import { capabilities, type CapabilityFramework } from '@threadplane/cockpit-registry';

/**
 * Bridge-agent detection (langgraph topics only).
 *
 * A langgraph topic normally mounts the stock `LangGraphAgent` wrapper. Some
 * topics subclass it — e.g. `subagents` mounts `SubagentEmittingAgent`, which
 * expands the graph's `subagent_activity` CUSTOM events into standard
 * SUBAGENT_* events. The aggregated server must mount the same subclass or
 * production serves the raw CUSTOM events (no subagent cards).
 *
 * Convention: the topic's own `src/server.py` is the source of truth. The
 * generator reads it and looks for
 *
 *     from .<module> import <Cls>      # package-relative, inside src/
 *     agent = <Cls>(name=..., graph=...)
 *
 * If `<Cls>` is anything other than `LangGraphAgent`, the generated server
 * imports `<Cls>` from `deps.<mod>.src.<module>` and constructs it with the
 * same `name`/`graph` arguments it already uses for the stock wrapper. A
 * topic that constructs the wrapper inline in `add_langgraph_fastapi_endpoint`
 * (no `agent = ...` line) keeps the plain `LangGraphAgent`. A subclass that is
 * mounted but not imported package-relatively is a generation error, because
 * the aggregated server could not re-import it from the staged deps tree.
 */

const GENERATED_HEADER = '# GENERATED — do not edit. Source: scripts/generate-ag-ui-deployment-config.ts';

/**
 * Frameworks hosted by the aggregated Python deployments. 'mastra' is
 * excluded: it is the Node hosting lane (deployments/ag-ui-mastra) and by
 * construction has no pythonDir, so it never reaches this generator.
 */
export type PythonHostedFramework = Exclude<CapabilityFramework, 'mastra'>;

export interface GenerateOptions {
  repoRoot: string;
  outDir: string;
  /** Frameworks this deployment hosts. Omitted means every Python-hosted framework. */
  frameworks?: readonly PythonHostedFramework[];
}

/**
 * A `LangGraphAgent` subclass the topic mounts instead of the stock wrapper.
 * `module` is dotted and relative to the topic's `src/` package
 * (e.g. `streaming.subagent_emitting_agent`).
 */
export interface BridgeAgent {
  module: string;
  cls: string;
}

export interface AgUiTopic {
  topic: string;
  pythonDir: string;
  framework: PythonHostedFramework;
  /** langgraph only; undefined means mount the plain `LangGraphAgent`. */
  bridgeAgent?: BridgeAgent;
}

const STOCK_LANGGRAPH_AGENT = 'LangGraphAgent';

/**
 * Parse a topic's `src/server.py` for a mounted `LangGraphAgent` subclass.
 * See the header comment for the convention. Exported for unit tests.
 */
export function detectBridgeAgent(serverPy: string): BridgeAgent | undefined {
  const assignment = serverPy.match(/^agent\s*=\s*([A-Za-z_]\w*)\s*\(/m);
  if (!assignment) return undefined;
  const cls = assignment[1];
  if (cls === STOCK_LANGGRAPH_AGENT) return undefined;
  const importRe = /^from\s+\.([\w.]+)\s+import\s+([^\n]+)$/gm;
  for (const m of serverPy.matchAll(importRe)) {
    const names = m[2].split(',').map((n) => n.trim().split(/\s+as\s+/)[0]);
    if (names.includes(cls)) return { module: m[1], cls };
  }
  throw new Error(
    `server.py mounts \`agent = ${cls}(...)\` but does not import ${cls} package-relatively ` +
      `(\`from .<module> import ${cls}\`); the aggregated server cannot re-import it from deps/.`,
  );
}

/**
 * Per-framework adapter: how a topic's staged module is imported and mounted
 * on the aggregated FastAPI app. Adding a runtime means adding one entry here
 * plus a `framework` discriminator on its registry capability — nothing else
 * in the generator is framework-aware.
 *
 * Module contract per framework:
 * - langgraph: `deps/<mod>/src/graph.py` exposes a compiled `graph`; mounted
 *   via ag-ui-langgraph's LangGraphAgent wrapper.
 * - microsoft-agent-framework: `deps/<mod>/src/agent.py` exposes an `agent`
 *   object (agent_framework Agent / AgentFrameworkAgent); the bridge mounts
 *   the agent object directly — there is no wrapper class.
 * - aws-strands: `deps/<mod>/src/agent.py` exposes an `agent` object that is
 *   already a configured ag_ui_strands.StrandsAgent (per-tool ToolBehavior
 *   config must ride with the example module, so the generator mounts the
 *   wrapped instance rather than constructing the wrapper itself).
 */
interface FrameworkAdapter {
  /** Module-level import line for the framework's AG-UI bridge package. */
  bridgeImport: string;
  /** Per-topic import of the staged module's exported object. */
  topicImport(mod: string, topic: AgUiTopic): string;
  /** Per-topic FastAPI mount block. */
  mount(topic: string, mod: string, t: AgUiTopic): string;
}

/**
 * Declaration order is emission order for bridge imports in server.py:
 * langgraph stays first so a langgraph-only registry generates byte-identical
 * output to the pre-adapter generator.
 */
const FRAMEWORK_ADAPTERS: Record<PythonHostedFramework, FrameworkAdapter> = {
  langgraph: {
    bridgeImport: 'from ag_ui_langgraph import add_langgraph_fastapi_endpoint, LangGraphAgent',
    topicImport: (mod, t) => {
      const graphImport = `from deps.${mod}.src.graph import graph as ${mod}_graph`;
      if (!t.bridgeAgent) return graphImport;
      return `${graphImport}\nfrom deps.${mod}.src.${t.bridgeAgent.module} import ${t.bridgeAgent.cls}`;
    },
    mount: (topic, mod, t) =>
      `add_langgraph_fastapi_endpoint(\n` +
      `    app,\n` +
      `    ${t.bridgeAgent?.cls ?? STOCK_LANGGRAPH_AGENT}(name="${topic}", graph=${mod}_graph),\n` +
      `    path="/agent/${topic}",\n` +
      `)`,
  },
  'microsoft-agent-framework': {
    bridgeImport: 'from agent_framework_ag_ui import add_agent_framework_fastapi_endpoint',
    topicImport: (mod) => `from deps.${mod}.src.agent import agent as ${mod}_agent`,
    mount: (topic, mod) =>
      `add_agent_framework_fastapi_endpoint(\n` +
      `    app,\n` +
      `    ${mod}_agent,\n` +
      `    path="/agent/${topic}",\n` +
      `)`,
  },
  'aws-strands': {
    bridgeImport: 'from ag_ui_strands import add_strands_fastapi_endpoint',
    topicImport: (mod) => `from deps.${mod}.src.agent import agent as ${mod}_agent`,
    // path is positional in add_strands_fastapi_endpoint(app, agent, path).
    mount: (topic, mod) =>
      `add_strands_fastapi_endpoint(\n` +
      `    app,\n` +
      `    ${mod}_agent,\n` +
      `    "/agent/${topic}",\n` +
      `)`,
  },
};

/**
 * A topic is a URL slug and may contain hyphens (e.g. `tool-views`,
 * `json-render`). Python package/module names cannot, so the staged deps
 * directory and the `from deps.<module>...` import must use an underscore
 * form. The `/agent/<topic>` route and the LangGraphAgent `name` keep the
 * original hyphenated slug.
 */
function pyModule(topic: string): string {
  return topic.replace(/-/g, '_');
}

function collectTopics(repoRoot: string): AgUiTopic[] {
  const topics = capabilities
    // 'ag-ui' and 'runtimes' products are both AG-UI-served FastAPI backends
    // aggregated into the single ag-ui-dev deployment.
    .filter((c) => (c.product === 'ag-ui' || c.product === 'runtimes') && c.pythonDir)
    .map<AgUiTopic>((c) => {
      if (c.framework === 'mastra') {
        // Node hosting lane: a mastra capability must not declare a
        // pythonDir — its backend is deployments/ag-ui-mastra.
        throw new Error(`Capability ${c.id} declares framework 'mastra' with a pythonDir; mastra topics are Node-hosted.`);
      }
      const framework = c.framework ?? 'langgraph';
      const serverPy = resolve(repoRoot, c.pythonDir!, 'src/server.py');
      const bridgeAgent =
        framework === 'langgraph' && existsSync(serverPy)
          ? detectBridgeAgent(readFileSync(serverPy, 'utf8'))
          : undefined;
      return {
        topic: c.topic,
        pythonDir: c.pythonDir!,
        framework,
        ...(bridgeAgent ? { bridgeAgent } : {}),
      };
    });
  topics.sort((a, b) => a.topic.localeCompare(b.topic));
  if (topics.length === 0) {
    throw new Error('No AG-UI topics with pythonDir found in capability registry');
  }
  return topics;
}

function stageDeps(repoRoot: string, outDir: string, topics: AgUiTopic[]): void {
  const depsDir = resolve(outDir, 'deps');
  rmSync(depsDir, { recursive: true, force: true });
  mkdirSync(depsDir, { recursive: true });
  for (const topic of topics) {
    const src = resolve(repoRoot, topic.pythonDir);
    const dst = resolve(depsDir, pyModule(topic.topic));
    cpSync(src, dst, {
      recursive: true,
      // Exclude virtualenvs / bytecode, plus repo-metadata files (nx project.json,
      // tsconfig*) that would create cross-tree duplicates if mirrored into deps/.
      filter: (s) => {
        if (s.includes('.venv') || s.includes('__pycache__') || s.includes('.pytest_cache') || s.endsWith('.pyc')) return false;
        const basename = s.split('/').pop() ?? '';
        if (basename === 'project.json') return false;
        if (basename.startsWith('tsconfig') && basename.endsWith('.json')) return false;
        return true;
      },
    });
  }
}

export function buildServerPy(topics: AgUiTopic[], options: { title?: string } = {}): string {
  const title = options.title ?? 'ag-ui-dev';
  const usedFrameworks = (Object.keys(FRAMEWORK_ADAPTERS) as CapabilityFramework[]).filter(
    (framework) => topics.some((t) => t.framework === framework),
  );
  const bridgeImports = usedFrameworks
    .map((framework) => FRAMEWORK_ADAPTERS[framework].bridgeImport)
    .join('\n');
  const imports = topics
    .map((t) => FRAMEWORK_ADAPTERS[t.framework].topicImport(pyModule(t.topic), t))
    .join('\n');
  const mounts = topics
    .map((t) => FRAMEWORK_ADAPTERS[t.framework].mount(t.topic, pyModule(t.topic), t))
    .join('\n');
  return `${GENERATED_HEADER}
# Multi-topic AG-UI FastAPI server. Aggregates each AG-UI-served python topic
# (cockpit/ag-ui/*/python and cockpit/runtimes/*/python) at /agent/<topic>.
# Health route /ok is unauthenticated; /agent/* requires X-Internal-Token
# matching the AG_UI_INTERNAL_TOKEN env var.
import os
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
${bridgeImports}

${imports}

AG_UI_INTERNAL_TOKEN = os.environ["AG_UI_INTERNAL_TOKEN"]

app = FastAPI(title="${title}")


@app.middleware("http")
async def require_internal_token(request: Request, call_next):
    # NOTE: HTTPException raised inside a Starlette BaseHTTPMiddleware bubbles
    # past FastAPI's handler and surfaces as 500. Return a JSONResponse
    # directly instead — that's the only way to emit a proper 4xx from here.
    if request.url.path == "/ok":
        return await call_next(request)
    if request.headers.get("x-internal-token") != AG_UI_INTERNAL_TOKEN:
        return JSONResponse(status_code=401, content={"detail": "unauthorized"})
    return await call_next(request)


@app.get("/ok")
def ok() -> dict:
    return {"ok": True}


${mounts}
`;
}

/**
 * Build a combined requirements.txt by extracting only the DIRECT dependencies
 * of each example (those whose `# via` comment names the cockpit project itself)
 * and letting pip resolve transitives at install time.
 *
 * We previously took the union with "highest version wins" across both examples'
 * full uv-exported requirements.txt. That produced internally-inconsistent sets:
 * one example's resolved transitive could be a higher version than what the
 * other example's direct dep accepted. Stripping to direct deps avoids that.
 */
export interface UnionConstraints {
  /** Package upper bounds a topic's own dependency carries that the union
   *  cannot see (a transitive requirement such as agent-framework-ag-ui's
   *  `ag-ui-protocol<0.2`). Keyed by package; value is `<X.Y` form. */
  caps?: Record<string, string>;
}

const KNOWN_CAPS: Record<PythonHostedFramework, Record<string, string>> = {
  langgraph: {},
  'aws-strands': {},
  // `agent-framework-ag-ui` 1.2.1 (the pinned release; 1.4.0 still caps the same way)
  // declares ag-ui-protocol>=0.1.19,<0.2.
  // Only the caps listed here are enforced; a new transitive cap elsewhere surfaces at the
  // deploy workflow's pip boot gate instead.
  'microsoft-agent-framework': { 'ag-ui-protocol': '<0.2' },
};

function capsFor(topics: AgUiTopic[]): Record<string, string> {
  return Object.assign({}, ...topics.map((t) => KNOWN_CAPS[t.framework]));
}

export function buildRequirementsTxt(
  repoRoot: string,
  topics: AgUiTopic[],
  constraints: UnionConstraints = {},
): string {
  const directVersions = new Map<string, string>();
  const directUrls = new Map<string, string>();
  for (const topic of topics) {
    const reqPath = resolve(repoRoot, topic.pythonDir, 'requirements.txt');
    const content = readFileSync(reqPath, 'utf8');
    for (const pkg of parseDirectDeps(content)) {
      if (pkg.url !== undefined) {
        const existingUrl = directUrls.get(pkg.name);
        if (existingUrl !== undefined && existingUrl !== pkg.url) {
          throw new Error(
            `Conflicting direct-URL pins for ${pkg.name}:\n  ${existingUrl}\n  ${pkg.url}\n` +
              'Align the examples on one ref before regenerating.',
          );
        }
        directUrls.set(pkg.name, pkg.url);
        continue;
      }
      const existing = directVersions.get(pkg.name);
      if (!existing || compareVersions(pkg.version!, existing) > 0) {
        directVersions.set(pkg.name, pkg.version!);
      }
    }
  }
  for (const name of directUrls.keys()) {
    if (directVersions.has(name)) {
      throw new Error(
        `${name} is pinned as a direct URL by one example and as ==${directVersions.get(name)} by another. ` +
          'Align the examples on one source before regenerating.',
      );
    }
  }
  for (const [name, cap] of Object.entries(constraints.caps ?? {})) {
    const chosen = directVersions.get(name);
    if (chosen !== undefined && compareVersions(chosen, cap.replace(/^</, '')) >= 0) {
      throw new Error(
        `${name}==${chosen} is in the union but a topic requires ${name}${cap}. ` +
          'Split that topic into its own deployment (see deployments/ag-ui-maf) before regenerating.',
      );
    }
  }
  const sortedNames = [...new Set([...directVersions.keys(), ...directUrls.keys()])].sort();
  const lines = sortedNames.map((n) =>
    directUrls.has(n) ? `${n} @ ${directUrls.get(n)}` : `${n}==${directVersions.get(n)}`,
  );
  return `${GENERATED_HEADER}\n${lines.join('\n')}\n`;
}

interface DirectDep {
  name: string;
  /** Present for `name==version` pins. */
  version?: string;
  /** Present for direct-URL requirements (`name @ git+https://...`). */
  url?: string;
}

/**
 * Parse uv-exported requirements.txt and return only entries whose `# via`
 * block names a cockpit-* project (i.e., the package was directly declared
 * by the example, not pulled in transitively).
 *
 * uv export format:
 *   <name>==<version> [; <marker>]
 *       # via <single-via>
 * or:
 *   <name>==<version>
 *       # via
 *       #   <via-a>
 *       #   <via-b>
 */
function parseDirectDeps(content: string): DirectDep[] {
  const lines = content.split('\n');
  const out: DirectDep[] = [];
  let current: DirectDep | null = null;
  let viaList: string[] = [];

  const flush = () => {
    if (current && viaList.some((v) => v.startsWith('cockpit-'))) {
      out.push(current);
    }
    current = null;
    viaList = [];
  };

  for (const rawLine of lines) {
    if (rawLine.startsWith('-e ') || rawLine.startsWith('#')) {
      flush();
      continue;
    }
    const isIndented = rawLine.startsWith(' ') || rawLine.startsWith('\t');
    if (!isIndented) {
      flush();
      const line = rawLine.trim();
      if (!line) continue;
      const semi = line.indexOf(';');
      const beforeMarker = semi >= 0 ? line.slice(0, semi).trim() : line;
      const match = beforeMarker.match(/^([A-Za-z0-9_.-]+)==([A-Za-z0-9_.+-]+)$/);
      if (match) {
        current = { name: match[1], version: match[2] };
        continue;
      }
      // Direct-URL requirement (PEP 508), e.g. a git-pinned bridge:
      //   ag-ui-strands @ git+https://github.com/...@<sha>#subdirectory=...
      // uv export emits these for [tool.uv.sources] git/url dependencies.
      const urlMatch = beforeMarker.match(/^([A-Za-z0-9_.-]+) @ (\S+)$/);
      if (urlMatch) {
        current = { name: urlMatch[1], url: urlMatch[2] };
      }
      continue;
    }
    // Indented line: part of a `# via ...` block for the current package.
    const trimmed = rawLine.trim();
    if (trimmed.startsWith('# via ')) {
      viaList.push(trimmed.slice(6).trim());
    } else if (trimmed.startsWith('#')) {
      viaList.push(trimmed.replace(/^#\s*/, '').trim());
    }
  }
  flush();
  return out;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((s) => parseInt(s, 10) || 0);
  const pb = b.split('.').map((s) => parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

export function generateAgUiDeployment(options: GenerateOptions): void {
  const all = collectTopics(options.repoRoot);
  const topics = options.frameworks
    ? all.filter((t) => options.frameworks!.includes(t.framework))
    : all;
  if (topics.length === 0) {
    throw new Error(`No topics match frameworks ${JSON.stringify(options.frameworks)}`);
  }
  mkdirSync(options.outDir, { recursive: true });
  // stageDeps clears deps/ first, so topics that left the deployment disappear.
  stageDeps(options.repoRoot, options.outDir, topics);
  writeFileSync(resolve(options.outDir, 'server.py'), buildServerPy(topics, { title: basename(options.outDir) }));
  writeFileSync(
    resolve(options.outDir, 'requirements.txt'),
    buildRequirementsTxt(options.repoRoot, topics, { caps: capsFor(topics) }),
  );
}

/**
 * The deployments the repo ships. MAF is alone because its bridge caps
 * ag-ui-protocol below 1.0 while every other Python runtime is on 1.0.
 */
export const DEPLOYMENTS: ReadonlyArray<{ dir: string; frameworks: readonly PythonHostedFramework[] }> = [
  { dir: 'deployments/ag-ui-dev', frameworks: ['langgraph', 'aws-strands'] },
  { dir: 'deployments/ag-ui-maf', frameworks: ['microsoft-agent-framework'] },
];

if (require.main === module) {
  const repoRoot = resolve(__dirname, '..');
  for (const { dir, frameworks } of DEPLOYMENTS) {
    generateAgUiDeployment({ repoRoot, outDir: resolve(repoRoot, dir), frameworks });
    console.log(`Generated ${dir}/{server.py,requirements.txt,deps/}`);
  }
}
