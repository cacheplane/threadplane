import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import {
  buildRequirementsTxt,
  buildServerPy,
  DEPLOYMENTS,
  detectBridgeAgent,
  generateAgUiDeployment,
  type AgUiTopic,
} from './generate-ag-ui-deployment-config';

const REPO_ROOT = resolve(__dirname, '..');
const DEV_FRAMEWORKS = DEPLOYMENTS[0].frameworks;

describe('generateAgUiDeployment', () => {
  let outDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), 'ag-ui-deploy-'));
  });

  it('stages each AG-UI python tree under deps/<topic>/', () => {
    generateAgUiDeployment({ repoRoot: REPO_ROOT, outDir, frameworks: DEV_FRAMEWORKS });
    expect(statSync(join(outDir, 'deps/interrupts/src/graph.py')).isFile()).toBe(true);
    expect(statSync(join(outDir, 'deps/streaming/src/graph.py')).isFile()).toBe(true);
  });

  it('writes server.py with GENERATED header and one endpoint per topic', () => {
    generateAgUiDeployment({ repoRoot: REPO_ROOT, outDir, frameworks: DEV_FRAMEWORKS });
    const server = readFileSync(join(outDir, 'server.py'), 'utf8');
    expect(server).toMatch(/^# GENERATED/);
    expect(server).toContain('from deps.interrupts.src.graph import graph as interrupts_graph');
    expect(server).toContain('from deps.streaming.src.graph import graph as streaming_graph');
    expect(server).toContain('path="/agent/interrupts"');
    expect(server).toContain('path="/agent/streaming"');
    expect(server).toContain('@app.get("/ok")');
  });

  it('emits valid Python module names for hyphenated topics (deps dir + import underscored, URL path hyphenated)', () => {
    // Regression: topics like `tool-views`/`json-render` are URL slugs with
    // hyphens, which are illegal in Python module paths. The generator must
    // stage them under an underscored deps dir and import them with
    // underscores, while keeping the hyphenated `/agent/<topic>` route. A
    // hyphen in a `from deps.<...>` line is a SyntaxError and breaks the
    // whole server (which is what shipped before this fix).
    generateAgUiDeployment({ repoRoot: REPO_ROOT, outDir, frameworks: DEV_FRAMEWORKS });
    const server = readFileSync(join(outDir, 'server.py'), 'utf8');
    expect(server).toContain('from deps.json_render.src.graph import graph as json_render_graph');
    expect(server).toContain('from deps.tool_views.src.graph import graph as tool_views_graph');
    expect(server).toContain('path="/agent/json-render"');
    expect(server).toContain('path="/agent/tool-views"');
    expect(server).toContain('LangGraphAgent(name="json-render"');
    // No hyphen may ever appear inside a `from deps.<module>` import path.
    for (const line of server.split('\n').filter((l) => l.startsWith('from deps.'))) {
      const modulePath = line.slice('from deps.'.length).split(' ')[0];
      expect(modulePath).not.toContain('-');
    }
    // The underscored deps dir must exist for the import to resolve.
    expect(statSync(join(outDir, 'deps/json_render/src/graph.py')).isFile()).toBe(true);
    expect(statSync(join(outDir, 'deps/tool_views/src/graph.py')).isFile()).toBe(true);
  });

  it('mounts a topic\'s own LangGraphAgent subclass when its src/server.py declares one', () => {
    // The subagents demo mounts SubagentEmittingAgent (a LangGraphAgent
    // subclass that expands `subagent_activity` CUSTOM events into standard
    // SUBAGENT_* events). The aggregated Railway server must mount the same
    // class or production serves raw CUSTOM events and no subagent cards.
    generateAgUiDeployment({ repoRoot: REPO_ROOT, outDir, frameworks: DEV_FRAMEWORKS });
    const server = readFileSync(join(outDir, 'server.py'), 'utf8');
    expect(server).toContain(
      'from deps.subagents.src.streaming.subagent_emitting_agent import SubagentEmittingAgent',
    );
    expect(server).toContain('SubagentEmittingAgent(name="subagents", graph=subagents_graph)');
    expect(server).not.toContain('LangGraphAgent(name="subagents"');
    // Topics without a subclass keep the plain bridge wrapper.
    expect(server).toContain('LangGraphAgent(name="interrupts", graph=interrupts_graph)');
    // The subclass module must be staged so the import resolves from the deployment root.
    expect(
      statSync(join(outDir, 'deps/subagents/src/streaming/subagent_emitting_agent.py')).isFile(),
    ).toBe(true);
  });

  it('server.py enforces X-Internal-Token on /agent/*', () => {
    generateAgUiDeployment({ repoRoot: REPO_ROOT, outDir, frameworks: DEV_FRAMEWORKS });
    const server = readFileSync(join(outDir, 'server.py'), 'utf8');
    expect(server).toContain('AG_UI_INTERNAL_TOKEN');
    expect(server).toContain('x-internal-token');
    expect(server).toMatch(/if request\.url\.path == "\/ok":\s*\n\s*return await call_next\(request\)/);
  });

  it('writes requirements.txt with GENERATED header and union of example deps', () => {
    generateAgUiDeployment({ repoRoot: REPO_ROOT, outDir, frameworks: DEV_FRAMEWORKS });
    const reqs = readFileSync(join(outDir, 'requirements.txt'), 'utf8');
    expect(reqs).toMatch(/^# GENERATED/);
    expect(reqs).toContain('ag-ui-langgraph==');
    expect(reqs).toContain('fastapi==');
    expect(reqs).toContain('uvicorn==');
    expect(reqs).not.toMatch(/^-e \./m);
  });

  it('carries direct-URL (git-pinned) requirements through the union', () => {
    // uv exports a git source as a PEP 508 direct-URL line
    // (`name @ git+https://...@<sha>#subdirectory=...`), which the union must
    // carry verbatim. Synthetic topic: no real topic pins a git ref any more.
    const root = mkdtempSync(join(tmpdir(), 'agui-direct-url-'));
    const line =
      'pkg @ git+https://example.test/repo.git@0123456789abcdef0123456789abcdef01234567#subdirectory=x';
    mkdirSync(join(root, 'x/python'), { recursive: true });
    writeFileSync(
      join(root, 'x/python/requirements.txt'),
      `# This file was autogenerated by uv via the following command:\n#    uv export --no-hashes -o requirements.txt\n-e .\n${line}\n    # via cockpit-x\n`,
    );
    const reqs = buildRequirementsTxt(root, [
      { topic: 'x', pythonDir: 'x/python', framework: 'langgraph' as const },
    ]);
    expect(reqs).toContain(`${line}\n`);
    // Never emit a version-pin form for a direct-URL dep.
    expect(reqs).not.toContain('pkg==');
  });

  for (const { dir, frameworks } of DEPLOYMENTS) {
    it(`matches the committed ${dir} artifacts byte-for-byte (drift check)`, () => {
      // The deploy-ag-ui workflow regenerates and fails on `git diff` drift.
      // This is the same guarantee, runnable locally without touching the
      // committed artifacts.
      generateAgUiDeployment({ repoRoot: REPO_ROOT, outDir, frameworks });
      const committedDir = join(REPO_ROOT, dir);
      for (const file of ['server.py', 'requirements.txt']) {
        const committed = join(committedDir, file);
        if (!existsSync(committed)) {
          throw new Error(
            `${dir}/${file} is not committed yet; run \`npx tsx scripts/generate-ag-ui-deployment-config.ts\``,
          );
        }
        expect(readFileSync(join(outDir, file), 'utf8')).toBe(readFileSync(committed, 'utf8'));
      }
    });
  }

  it('writes a MAF-only deployment when filtered to microsoft-agent-framework', () => {
    generateAgUiDeployment({ repoRoot: REPO_ROOT, outDir, frameworks: ['microsoft-agent-framework'] });
    const server = readFileSync(join(outDir, 'server.py'), 'utf8');
    expect(server).toContain('from agent_framework_ag_ui import add_agent_framework_fastapi_endpoint');
    expect(server).not.toContain('from ag_ui_langgraph import');
    expect(server).not.toContain('from ag_ui_strands import');
    const reqs = readFileSync(join(outDir, 'requirements.txt'), 'utf8');
    expect(reqs).toContain('agent-framework-ag-ui==');
    expect(reqs).not.toContain('ag-ui-langgraph==');
    expect(readdirSync(join(outDir, 'deps'))).toEqual(['microsoft_agent_framework']);
  });

  it('excludes microsoft-agent-framework from the shared deployment', () => {
    generateAgUiDeployment({ repoRoot: REPO_ROOT, outDir, frameworks: ['langgraph', 'aws-strands'] });
    const server = readFileSync(join(outDir, 'server.py'), 'utf8');
    expect(server).not.toContain('agent_framework_ag_ui');
    expect(readdirSync(join(outDir, 'deps'))).not.toContain('microsoft_agent_framework');
  });

  it('removes staged deps that no longer belong to the deployment', () => {
    generateAgUiDeployment({ repoRoot: REPO_ROOT, outDir, frameworks: ['microsoft-agent-framework'] });
    expect(readdirSync(join(outDir, 'deps'))).toContain('microsoft_agent_framework');
    generateAgUiDeployment({ repoRoot: REPO_ROOT, outDir, frameworks: ['langgraph', 'aws-strands'] });
    expect(readdirSync(join(outDir, 'deps'))).not.toContain('microsoft_agent_framework');
  });

  it('produces byte-identical output across runs (idempotent)', () => {
    generateAgUiDeployment({ repoRoot: REPO_ROOT, outDir, frameworks: DEV_FRAMEWORKS });
    const firstServer = readFileSync(join(outDir, 'server.py'), 'utf8');
    const firstReqs = readFileSync(join(outDir, 'requirements.txt'), 'utf8');
    generateAgUiDeployment({ repoRoot: REPO_ROOT, outDir, frameworks: DEV_FRAMEWORKS });
    expect(readFileSync(join(outDir, 'server.py'), 'utf8')).toBe(firstServer);
    expect(readFileSync(join(outDir, 'requirements.txt'), 'utf8')).toBe(firstReqs);
  });
});

describe('buildServerPy framework adapters', () => {
  const lg = (topic: string): AgUiTopic => ({ topic, pythonDir: `x/${topic}/python`, framework: 'langgraph' });
  const maf = (topic: string): AgUiTopic => ({
    topic,
    pythonDir: `x/${topic}/python`,
    framework: 'microsoft-agent-framework',
  });

  it('langgraph topics import graph and mount via LangGraphAgent, with no MAF bridge import', () => {
    const server = buildServerPy([lg('interrupts')]);
    expect(server).toContain('from ag_ui_langgraph import add_langgraph_fastapi_endpoint, LangGraphAgent');
    expect(server).toContain('from deps.interrupts.src.graph import graph as interrupts_graph');
    expect(server).toContain('LangGraphAgent(name="interrupts", graph=interrupts_graph)');
    expect(server).not.toContain('agent_framework_ag_ui');
  });

  it('microsoft-agent-framework topics import agent and mount the agent object directly', () => {
    const server = buildServerPy([maf('microsoft-agent-framework')]);
    expect(server).toContain('from agent_framework_ag_ui import add_agent_framework_fastapi_endpoint');
    expect(server).toContain(
      'from deps.microsoft_agent_framework.src.agent import agent as microsoft_agent_framework_agent',
    );
    expect(server).toContain(
      'add_agent_framework_fastapi_endpoint(\n' +
        '    app,\n' +
        '    microsoft_agent_framework_agent,\n' +
        '    path="/agent/microsoft-agent-framework",\n' +
        ')',
    );
    // No LangGraph machinery when no langgraph topic is present.
    expect(server).not.toContain('ag_ui_langgraph');
    expect(server).not.toContain('LangGraphAgent');
  });

  it('aws-strands topics import the wrapped StrandsAgent and mount it with a positional path', () => {
    const strands: AgUiTopic = {
      topic: 'aws-strands',
      pythonDir: 'x/aws-strands/python',
      framework: 'aws-strands',
    };
    const server = buildServerPy([strands]);
    expect(server).toContain('from ag_ui_strands import add_strands_fastapi_endpoint');
    expect(server).toContain('from deps.aws_strands.src.agent import agent as aws_strands_agent');
    expect(server).toContain(
      'add_strands_fastapi_endpoint(\n' +
        '    app,\n' +
        '    aws_strands_agent,\n' +
        '    "/agent/aws-strands",\n' +
        ')',
    );
    // No LangGraph machinery when no langgraph topic is present.
    expect(server).not.toContain('ag_ui_langgraph');
    expect(server).not.toContain('LangGraphAgent');
  });

  it('langgraph topics with a bridgeAgent import the subclass and construct it with name/graph', () => {
    const server = buildServerPy([
      { ...lg('subagents'), bridgeAgent: { module: 'streaming.subagent_emitting_agent', cls: 'SubagentEmittingAgent' } },
      lg('interrupts'),
    ]);
    expect(server).toContain('from deps.subagents.src.graph import graph as subagents_graph');
    expect(server).toContain(
      'from deps.subagents.src.streaming.subagent_emitting_agent import SubagentEmittingAgent',
    );
    expect(server).toContain(
      'add_langgraph_fastapi_endpoint(\n' +
        '    app,\n' +
        '    SubagentEmittingAgent(name="subagents", graph=subagents_graph),\n' +
        '    path="/agent/subagents",\n' +
        ')',
    );
    expect(server).toContain('LangGraphAgent(name="interrupts", graph=interrupts_graph)');
    expect(server).not.toContain('LangGraphAgent(name="subagents"');
  });

  it('mixed sets emit both bridge imports (langgraph first) and per-topic mounts', () => {
    const server = buildServerPy([lg('interrupts'), maf('microsoft-agent-framework')]);
    const lgImport = server.indexOf('from ag_ui_langgraph import');
    const mafImport = server.indexOf('from agent_framework_ag_ui import');
    expect(lgImport).toBeGreaterThan(-1);
    expect(mafImport).toBeGreaterThan(lgImport);
    expect(server).toContain('path="/agent/interrupts"');
    expect(server).toContain('path="/agent/microsoft-agent-framework"');
    // Framework routing is per-topic: the langgraph topic must not be
    // mounted through the MAF bridge or vice versa.
    expect(server).toContain('LangGraphAgent(name="interrupts"');
    expect(server).not.toContain('LangGraphAgent(name="microsoft-agent-framework"');
  });
});

describe('detectBridgeAgent', () => {
  it('returns undefined for the plain bridge wrapper', () => {
    expect(
      detectBridgeAgent(
        'from ag_ui_langgraph import add_langgraph_fastapi_endpoint, LangGraphAgent\n' +
          'from .graph import graph\n' +
          'agent = LangGraphAgent(name="interrupts", graph=graph)\n',
      ),
    ).toBeUndefined();
  });

  it('returns undefined when the wrapper is constructed inline in the mount call', () => {
    expect(
      detectBridgeAgent(
        'add_langgraph_fastapi_endpoint(app, LangGraphAgent(name="x", graph=graph), path="/agent")\n',
      ),
    ).toBeUndefined();
  });

  it('resolves a subclass to its package-relative module', () => {
    expect(
      detectBridgeAgent(
        'from .graph import graph\n' +
          'from .streaming.subagent_emitting_agent import SubagentEmittingAgent\n' +
          'agent = SubagentEmittingAgent(name="subagents", graph=graph)\n',
      ),
    ).toEqual({ module: 'streaming.subagent_emitting_agent', cls: 'SubagentEmittingAgent' });
  });

  it('throws when a subclass is mounted but not imported from the topic package', () => {
    // A class the generator cannot re-import from deps/<mod>/src would emit a
    // server.py that fails at boot; fail at generation time instead.
    expect(() =>
      detectBridgeAgent('from somewhere import FancyAgent\nagent = FancyAgent(name="x", graph=graph)\n'),
    ).toThrow(/FancyAgent/);
  });
});

describe('buildRequirementsTxt union constraints', () => {
  it("refuses a union where one topic caps a package below another topic's pin", () => {
    const root = mkdtempSync(join(tmpdir(), 'agui-conflict-'));
    const write = (dir: string, body: string) => {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(
        join(root, dir, 'requirements.txt'),
        `# This file was autogenerated by uv via the following command:\n#    uv export --no-hashes -o requirements.txt\n-e .\n${body}`,
      );
      return { topic: dir.split('/')[0], pythonDir: dir, framework: 'langgraph' as const };
    };
    const a = write('a/python', 'ag-ui-protocol==1.0.0\n    # via cockpit-a\n');
    const b = write(
      'b/python',
      'ag-ui-protocol==0.1.22\n    # via cockpit-b\nagent-framework-ag-ui==1.4.0\n    # via cockpit-b\n',
    );
    expect(() => buildRequirementsTxt(root, [a, b], { caps: { 'ag-ui-protocol': '<0.2' } })).toThrow(
      /ag-ui-protocol.*1\.0\.0.*<0\.2/,
    );
  });
});
