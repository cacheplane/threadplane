import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as ts from 'typescript';

function websiteBuildProjects(website: {
  targets: {
    e2e: {
      dependsOn: readonly { target: string; projects?: readonly string[] }[];
    };
  };
}) {
  return website.targets.e2e.dependsOn.find(
    dependency => dependency.target === 'build'
  )?.projects;
}

it('wires native Planning build, fixture and website coverage to the shared Python graph', () => {
  const read = (path: string) => JSON.parse(readFileSync(join(repoRoot, path), 'utf8'));
  const react = read('cockpit/deep-agents/planning/react/project.json');
  expect(react.tags).toEqual(expect.arrayContaining(['framework:react', 'scope:cockpit-e2e', 'scope:cockpit-examples']));
  expect(react.targets.build.options.command).toBe('node scripts/react-cockpit/build.mjs deep-agents-planning');
  expect(react.targets.e2e.dependsOn).toEqual(['build', 'fixture-test']);
  expect(react.targets['fixture-test'].dependsOn).toContainEqual({ target: 'test', projects: ['cockpit-deep-agents-planning-python'] });
  const website = read('apps/website/project.json');
  expect(websiteBuildProjects(website)).toContain('cockpit-deep-agents-planning-react');
  const config = readFileSync(join(repoRoot, 'apps/website/playwright.config.ts'), 'utf8');
  expect(config).toContain('cockpit-deep-agents-planning-python:smoke && node scripts/react-cockpit/serve.mjs deep-agents-planning --no-parent');
  expect(config).toContain("url: 'http://127.0.0.1:4628'");
});
it('wires native Skills build, fixture and website coverage to the shared Python graph', () => {
  const read = (path: string) => JSON.parse(readFileSync(join(repoRoot, path), 'utf8'));
  const react = read('cockpit/deep-agents/skills/react/project.json');
  expect(react.tags).toEqual(expect.arrayContaining(['framework:react', 'scope:cockpit-e2e', 'scope:cockpit-examples']));
  expect(react.targets.build.options.command).toBe('node scripts/react-cockpit/build.mjs deep-agents-skills');
  expect(react.targets.e2e.dependsOn).toEqual(['build', 'fixture-test']);
  expect(react.targets['fixture-test'].dependsOn).toContainEqual({ target: 'test', projects: ['cockpit-deep-agents-skills-python'] });
  expect(react.targets['fixture-test'].dependsOn).toContainEqual({ target: 'build', projects: ['core'] });
  const website = read('apps/website/project.json');
  expect(websiteBuildProjects(website)).toContain('cockpit-deep-agents-skills-react');
  const config = readFileSync(join(repoRoot, 'apps/website/playwright.config.ts'), 'utf8');
  expect(config).toContain('cockpit-deep-agents-skills-python:smoke && node scripts/react-cockpit/serve.mjs deep-agents-skills --no-parent');
  expect(config).toContain("url: 'http://127.0.0.1:4631'");
});
it('wires native Subagents build, fixture and website coverage to the shared Python graph', () => {
  const read = (path: string) => JSON.parse(readFileSync(join(repoRoot, path), 'utf8'));
  const react = read('cockpit/deep-agents/subagents/react/project.json');
  expect(react.tags).toEqual(expect.arrayContaining(['framework:react', 'scope:cockpit-e2e', 'scope:cockpit-examples']));
  expect(react.targets.build.options.command).toBe('node scripts/react-cockpit/build.mjs deep-agents-subagents');
  expect(react.targets.e2e.dependsOn).toEqual(['build', 'fixture-test']);
  expect(react.targets['fixture-test'].dependsOn).toContainEqual({ target: 'test', projects: ['cockpit-deep-agents-subagents-python'] });
  const website = read('apps/website/project.json');
  expect(websiteBuildProjects(website)).toContain('cockpit-deep-agents-subagents-react');
  const config = readFileSync(join(repoRoot, 'apps/website/playwright.config.ts'), 'utf8');
  expect(config).toContain('cockpit-deep-agents-subagents-python:smoke && node scripts/react-cockpit/serve.mjs deep-agents-subagents --no-parent');
  expect(config).toContain("url: 'http://127.0.0.1:4630'");
});
it('wires native Filesystem build, fixture and website coverage to the shared Python graph', () => {
  const read = (path: string) => JSON.parse(readFileSync(join(repoRoot, path), 'utf8'));
  const react = read('cockpit/deep-agents/filesystem/react/project.json');
  expect(react.tags).toEqual(expect.arrayContaining(['framework:react', 'scope:cockpit-e2e', 'scope:cockpit-examples']));
  expect(react.targets.build.options.command).toBe('node scripts/react-cockpit/build.mjs deep-agents-filesystem');
  expect(react.targets.e2e.dependsOn).toEqual(['build', 'fixture-test']);
  expect(react.targets['fixture-test'].dependsOn).toContainEqual({ target: 'test', projects: ['cockpit-deep-agents-filesystem-python'] });
  const website = read('apps/website/project.json');
  expect(websiteBuildProjects(website)).toContain('cockpit-deep-agents-filesystem-react');
  const config = readFileSync(join(repoRoot, 'apps/website/playwright.config.ts'), 'utf8');
  expect(config).toContain('cockpit-deep-agents-filesystem-python:smoke && node scripts/react-cockpit/serve.mjs deep-agents-filesystem --no-parent');
  expect(config).toContain("url: 'http://127.0.0.1:4629'");
});
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capabilities } from '@threadplane/cockpit-registry';
// @ts-expect-error — .mjs ES module without .d.ts; the e2e tsconfig uses
// allowJs:true but this top-level test file doesn't go through that config.
// eslint-disable-next-line @nx/enforce-module-boundaries -- repo-root port registry is intentionally outside an Nx project.
import { portsFor } from '../../cockpit/ports.mjs';

function compiledMemoryBackend(
  project: string | undefined,
  setup: string,
  fixture: string
): string | undefined {
  if (project !== 'cockpit-deep-agents-memory-angular') return undefined;
  const signature = (node: ts.Node): string => {
    const shape = (child: ts.Node): unknown => {
      const children: unknown[] = [];
      ts.forEachChild(child, (nested) => {
        children.push(shape(nested));
      });
      return [child.kind, children.length ? children : child.getText().trim()];
    };
    return JSON.stringify(shape(node));
  };
  const has = (nodes: readonly ts.Node[], expected: string) => {
    const grammar = ts.createSourceFile(
      'grammar.ts',
      expected,
      ts.ScriptTarget.Latest,
      true
    );
    const target = signature(grammar.statements[0]);
    return nodes.filter((node) => signature(node) === target).length === 1;
  };
  const declaration = (
    body: ts.Block,
    name: string
  ): ts.VariableDeclaration | undefined => {
    const matches = body.statements
      .filter(ts.isVariableStatement)
      .flatMap((statement) => [...statement.declarationList.declarations])
      .filter((node) => ts.isIdentifier(node.name) && node.name.text === name);
    return matches.length === 1 ? matches[0] : undefined;
  };
  const setupAst = ts.createSourceFile(
    'setup.ts',
    setup,
    ts.ScriptTarget.Latest,
    true
  );
  const owners = setupAst.statements.filter(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === 'setup'
  );
  if (
    owners.length !== 1 ||
    !owners[0].body ||
    !owners[0].modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword
    )
  )
    return undefined;
  const body = owners[0].body;
  const required = [
    "const { createDeepAgentsMemoryFixture } = await import('../../../../../scripts/react-cockpit/deep-agents-memory-fixture.mjs');",
    'const fixture = createDeepAgentsMemoryFixture();',
    `const backend = createServer(async (req, res) => {
      const path = new URL(req.url!, 'http://localhost:5313').pathname;
      try { if (!await fixture(req, res, path.startsWith('/threads') ? '/api' + path : path)) { res.writeHead(404); res.end(); } }
      catch { res.writeHead(500); res.end(); }
    });`,
  ];
  if (!required.every((grammar) => has(body.statements, grammar)))
    return undefined;
  const startup = body.statements.filter(ts.isTryStatement);
  if (
    startup.length !== 1 ||
    !has(startup[0].tryBlock.statements, 'backend.listen(5313);') ||
    !has(
      startup[0].tryBlock.statements,
      "child = spawn(process.execPath, [resolve(root, 'node_modules/nx/bin/nx.js'), 'serve', 'cockpit-deep-agents-memory-angular', '--configuration=cockpit', '--port=4313', '--host=localhost'], { cwd: root, detached: true, stdio: ['ignore', log, log], env: { ...process.env, NX_DAEMON: 'false' } });"
    )
  )
    return undefined;
  // The actual worker selects the canonical pinned Python project and wire script.
  const parsedFixture = ts.createSourceFile(
    'fixture.mjs',
    fixture,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  const factories = parsedFixture.statements.filter(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) &&
      node.name?.text === 'createDeepAgentsMemoryFixture' &&
      node.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
      ) === true
  );
  if (
    factories.length !== 1 ||
    !factories[0].body ||
    factories[0].parameters.length !== 1
  )
    return undefined;
  const factory = factories[0],
    parameter = factory.parameters[0];
  if (!ts.isObjectBindingPattern(parameter.name)) return undefined;
  const spawnBinding = parameter.name.elements.filter(
    (element) => element.name.getText() === 'spawnWorker'
  );
  const arrow =
    spawnBinding.length === 1 ? spawnBinding[0].initializer : undefined;
  if (
    !arrow ||
    !ts.isArrowFunction(arrow) ||
    arrow.parameters.length !== 0 ||
    !ts.isCallExpression(arrow.body) ||
    arrow.body.expression.getText() !== 'spawn' ||
    arrow.body.arguments[0]?.getText() !== "'uv'"
  )
    return undefined;
  const args = arrow.body.arguments[1];
  if (
    !args ||
    !ts.isArrayLiteralExpression(args) ||
    JSON.stringify(
      args.elements.map((element) =>
        ts.isStringLiteral(element) ? element.text : null
      )
    ) !==
      JSON.stringify([
        'run',
        '--frozen',
        '--python',
        '3.12',
        '--project',
        'cockpit/deep-agents/memory/python',
        'python',
        'scripts/react-cockpit/deep-agents-memory-wire.py',
      ])
  )
    return undefined;
  const factoryBody = factory.body;
  if (!factoryBody || !has(factoryBody.statements, 'return handle;'))
    return undefined;
  const handle = declaration(factoryBody, 'handle')?.initializer;
  const operations = factoryBody.statements.filter(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === 'operate'
  );
  const workers = parsedFixture.statements.filter(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === 'graphWorker'
  );
  if (
    !handle ||
    !ts.isArrowFunction(handle) ||
    !ts.isBlock(handle.body) ||
    operations.length !== 1 ||
    !operations[0].body ||
    workers.length !== 1 ||
    !workers[0].body ||
    !has(workers[0].body.statements, 'const child = spawnWorker();')
  )
    return undefined;
  const queued = declaration(operations[0].body, 'result')?.initializer;
  if (
    !queued ||
    !ts.isCallExpression(queued) ||
    queued.expression.getText() !== 'queue.then' ||
    queued.arguments.length !== 1
  )
    return undefined;
  const execute = queued.arguments[0];
  if (
    !ts.isArrowFunction(execute) ||
    !ts.isBlock(execute.body) ||
    !has(
      execute.body.statements,
      'worker ??= graphWorker(spawnWorker, workerTimeoutMs);'
    ) ||
    !has(
      execute.body.statements,
      'const result = await worker.send(value), proof = result.proof;'
    ) ||
    !has(operations[0].body.statements, 'return result;')
  )
    return undefined;
  // Runtime calls in the returned handler count; nested uncalled helpers do not.
  let operationCalls = 0;
  const visitHandler = (node: ts.Node) => {
    if (
      node !== handle.body &&
      (ts.isFunctionDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node))
    )
      return;
    if (ts.isCallExpression(node) && node.expression.getText() === 'operate')
      operationCalls++;
    ts.forEachChild(node, visitHandler);
  };
  visitHandler(handle.body);
  return operationCalls === 5 ? 'cockpit/deep-agents/memory/python' : undefined;
}

it.each(['setup', 'fixture'])(
  'rejects unused canonical Memory %s subtrees',
  (owner) => {
    let setup = readRepoFile(
      'cockpit/deep-agents/memory/angular/e2e/global-setup-impl.ts'
    );
    let fixture = readRepoFile(
      'scripts/react-cockpit/deep-agents-memory-fixture.mjs'
    );
    if (owner === 'setup')
      setup = setup
        .replace(
          'export default async function setup() {',
          'export default async function setup() { async function neverCalled() {'
        )
        .trimEnd()
        .replace(/}$/, '} }');
    else
      fixture =
        fixture.replace(
          'export function createDeepAgentsMemoryFixture(',
          'function unusedFixture('
        ) +
        '\nexport function createDeepAgentsMemoryFixture() { return async () => true; }';
    expect(
      compiledMemoryBackend(
        'cockpit-deep-agents-memory-angular',
        setup,
        fixture
      )
    ).toBeUndefined();
  }
);

it('recognizes the actual compiled Memory backend and rejects project, fixture, port and proxy drift', () => {
  const setup = readRepoFile(
    'cockpit/deep-agents/memory/angular/e2e/global-setup-impl.ts'
  );
  const fixture = readRepoFile(
    'scripts/react-cockpit/deep-agents-memory-fixture.mjs'
  );
  const parse = (
    text = setup,
    implementation = fixture,
    project = 'cockpit-deep-agents-memory-angular'
  ) => compiledMemoryBackend(project, text, implementation);
  expect(parse()).toBe('cockpit/deep-agents/memory/python');
  expect(
    parse(setup, fixture, 'cockpit-deep-agents-skills-angular')
  ).toBeUndefined();
  for (const changed of [
    setup.replace('deep-agents-memory-fixture.mjs', 'generic-fixture.mjs'),
    setup.replace(
      'const fixture = createDeepAgentsMemoryFixture();',
      'const fixture = createGenericFixture();'
    ),
    setup.replace('backend.listen(5313)', 'backend.listen(9999)'),
    setup.replace(
      'const backend = createServer',
      'const unused = createServer'
    ),
    setup.replace(
      'export default async function setup()',
      'async function deadSetup()'
    ),
    setup.replace("'/api' + path", 'path'),
    setup.replace("'--port=4313'", "'--port=9999'"),
  ])
    expect(parse(changed)).toBeUndefined();
  expect(
    parse(
      setup,
      fixture.replace(
        "'cockpit/deep-agents/memory/python'",
        "'cockpit/deep-agents/skills/python'"
      )
    )
  ).toBeUndefined();
});

it('wires native Memory build, compiled fixture and website coverage to the shared Python graph', () => {
  const read = (path: string) => JSON.parse(readRepoFile(path));
  const react = read('cockpit/deep-agents/memory/react/project.json');
  expect(react.tags).toEqual(
    expect.arrayContaining([
      'framework:react',
      'scope:cockpit-e2e',
      'scope:cockpit-examples',
    ])
  );
  expect(react.targets.build.options.command).toBe(
    'node scripts/react-cockpit/build.mjs deep-agents-memory'
  );
  expect(react.targets.e2e.dependsOn).toEqual([
    { target: 'build', projects: ['cockpit-deep-agents-memory-react'] },
    { target: 'fixture-test', projects: ['cockpit-deep-agents-memory-react'] },
  ]);
  expect(react.targets['fixture-test'].dependsOn).toEqual([
    { target: 'test', projects: ['cockpit-deep-agents-memory-python'] },
  ]);
  expect(react.targets['fixture-test'].options.command).toBe(
    'node --test scripts/react-cockpit/deep-agents-memory-fixture.spec.mjs scripts/react-cockpit/deep-agents-memory-configuration.spec.mjs'
  );
  expect(
    websiteBuildProjects(read('apps/website/project.json'))
  ).toContain('cockpit-deep-agents-memory-react');
  expect(
    read('cockpit/deep-agents/memory/angular/project.json').targets.e2e
      .dependsOn
  ).toContain('lifecycle-test');
  const config = readRepoFile('apps/website/playwright.config.ts');
  expect(config).toContain(
    'cockpit-deep-agents-memory-python:smoke && node scripts/react-cockpit/serve.mjs deep-agents-memory --no-parent'
  );
  expect(config).toContain("url: 'http://127.0.0.1:4632'");
});

interface E2eWiring {
  angularPort: number;
  langgraphCwd: string;
  langgraphPort: number;
  project: string;
  projectRoot: string;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const workflows = ['.github/workflows/ci.yml'] as const;

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8');
}

function listProjectJsonFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];

  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name === 'project.json') {
        out.push(fullPath);
      }
    }
  }

  return out.sort();
}

function listFiles(
  root: string,
  predicate: (filePath: string) => boolean,
  excludeDirNames: readonly string[] = []
): string[] {
  const out: string[] = [];
  const stack = [root];

  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && excludeDirNames.includes(entry.name)) {
        continue;
      }
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && predicate(fullPath)) {
        out.push(fullPath);
      }
    }
  }

  return out.sort();
}

function parseStringProperty(source: string, key: string): string | undefined {
  const match = source.match(new RegExp(`${key}:\\s*['"]([^'"]+)['"]`));
  return match?.[1];
}

function activeCockpitE2eWiring(): E2eWiring[] {
  return listProjectJsonFiles(join(repoRoot, 'cockpit'))
    .map((projectJsonPath) => {
      const project = JSON.parse(readFileSync(projectJsonPath, 'utf8')) as {
        name?: string;
        targets?: Record<string, unknown>;
      };
      return { project, projectJsonPath };
    })
    .filter(({ project, projectJsonPath }) => {
      return (
        project.name?.startsWith('cockpit-') &&
        projectJsonPath.includes('/angular/') &&
        Boolean(project.targets?.['e2e'])
      );
    })
    .map(({ project, projectJsonPath }) => {
      const projectRoot = dirname(projectJsonPath);
      const globalSetupPath = join(projectRoot, 'e2e/global-setup-impl.ts');
      const globalSetup = readFileSync(globalSetupPath, 'utf8');
      // langgraph-shaped global-setup uses `langgraphCwd`; ag-ui-shaped
      // global-setup (createAgUiGlobalSetup) uses `pythonCwd`; a Node-hosted
      // backend (rt-mastra's hand-rolled setup spawning
      // deployments/ag-ui-mastra) uses `backendCwd`. All name the backend
      // project's cwd — accept any.
      const langgraphCwd =
        parseStringProperty(globalSetup, 'langgraphCwd') ??
        parseStringProperty(globalSetup, 'pythonCwd') ??
        parseStringProperty(globalSetup, 'backendCwd') ??
        compiledMemoryBackend(
          project.name,
          globalSetup,
          readRepoFile('scripts/react-cockpit/deep-agents-memory-fixture.mjs')
        );

      // Post-port-registry migration: ports are imported from
      // cockpit/ports.mjs rather than living as literals in
      // global-setup-impl.ts. Look them up by project name.
      const ports = portsFor(project.name) as {
        angular: number;
        langgraph: number;
      };
      const langgraphPort = ports.langgraph;
      const angularPort = ports.angular;

      if (!project.name || !langgraphCwd || !langgraphPort || !angularPort) {
        throw new Error(
          `Unable to parse e2e wiring for ${relative(
            repoRoot,
            projectJsonPath
          )}`
        );
      }

      return {
        angularPort,
        langgraphCwd,
        langgraphPort,
        project: project.name,
        projectRoot,
      };
    });
}

describe('cockpit e2e wiring', () => {
  it('keeps production platform smoke under Website ownership', () => {
    const smoke = readRepoFile(
      'apps/website/e2e/platform-production-smoke.spec.ts'
    );
    const websiteConfig = readRepoFile('apps/website/playwright.config.ts');

    // Assert this against the whole tree, not just the retired
    // apps/cockpit path: any `production-smoke.spec.ts` anywhere else would
    // be an undetected duplicate of the one file Website is meant to own.
    // Website's file is named `platform-production-smoke.spec.ts` (a
    // different basename), so it never matches this exact-name check.
    const productionSmokeSpecs = listFiles(
      repoRoot,
      (filePath) => basename(filePath) === 'production-smoke.spec.ts',
      ['node_modules', 'dist', '.next', '.git']
    ).map((filePath) => relative(repoRoot, filePath));

    expect(productionSmokeSpecs).toEqual([]);
    expect(smoke).toContain('getWorkspaceDestinationPath');
    expect(smoke).toContain('EXAMPLES_URL');
    expect(smoke).toContain('DEMO_URL');
    expect(smoke).toContain('AG_UI_TOPICS');
    expect(smoke).not.toMatch(/Cockpit navigation|Recheck|runtime_ready/);
    expect(websiteConfig).toContain("environment['PRODUCTION_SMOKE']");
    expect(websiteConfig).toContain(
      'environment: WebsitePlaywrightEnvironment = process.env'
    );
    expect(websiteConfig).toContain('platform-production-smoke.spec.ts');
  });

  it('does not leave cockpit e2e spec files outside Nx e2e targets', () => {
    const projects = new Map(
      listProjectJsonFiles(join(repoRoot, 'cockpit')).map((projectJsonPath) => {
        const project = JSON.parse(readFileSync(projectJsonPath, 'utf8')) as {
          name?: string;
          targets?: Record<string, unknown>;
        };
        return [dirname(projectJsonPath), project] as const;
      })
    );
    const orphanSpecs: string[] = [];

    for (const specPath of listFiles(
      join(repoRoot, 'cockpit'),
      (filePath) =>
        filePath.includes('/angular/e2e/') && filePath.endsWith('.spec.ts')
    )) {
      const projectRoot = specPath.slice(0, specPath.indexOf('/e2e/'));
      const project = projects.get(projectRoot);
      if (!project?.targets?.['e2e']) {
        orphanSpecs.push(relative(repoRoot, specPath));
      }
    }

    expect(orphanSpecs).toEqual([]);
  });

  it('keeps active cockpit e2e backends aligned across registry, proxy, recorders, and workflows', () => {
    const errors: string[] = [];
    const activeE2e = activeCockpitE2eWiring();

    for (const wiring of activeE2e) {
      const capability = capabilities.find(
        (c) => c.angularProject === wiring.project
      );
      if (!capability) {
        errors.push(`${wiring.project}: missing capability registry entry`);
        continue;
      }

      if (capability.port !== wiring.angularPort) {
        errors.push(
          `${wiring.project}: registry port ${capability.port} != global setup angularPort ${wiring.angularPort}`
        );
      }
      if (
        capability.pythonPort !== undefined &&
        capability.pythonPort !== wiring.langgraphPort
      ) {
        errors.push(
          `${wiring.project}: registry pythonPort ${capability.pythonPort} != global setup langgraphPort ${wiring.langgraphPort}`
        );
      }
      if (
        capability.pythonDir !== undefined &&
        capability.pythonDir !== wiring.langgraphCwd
      ) {
        errors.push(
          `${wiring.project}: registry pythonDir ${capability.pythonDir} != global setup langgraphCwd ${wiring.langgraphCwd}`
        );
      }

      // Post-port-registry: proxy.conf.mjs templates the target from
      // cockpit/ports.mjs at runtime. Drift is impossible because the
      // value comes from the same registry the test already checks via
      // wiring.langgraphPort. So we just assert the .mjs file exists +
      // imports portsFor with this cap's name.
      const proxyMjs = join(wiring.projectRoot, 'proxy.conf.mjs');
      const proxyJson = join(wiring.projectRoot, 'proxy.conf.json');
      if (existsSync(proxyMjs)) {
        const text = readFileSync(proxyMjs, 'utf8');
        if (!text.includes(`portsFor('${wiring.project}')`)) {
          errors.push(
            `${wiring.project}: proxy.conf.mjs does not call portsFor('${wiring.project}')`
          );
        }
      } else if (existsSync(proxyJson)) {
        // Legacy (allowed for AG-UI exception only); not expected for any
        // cap reaching this code path.
        const proxy = JSON.parse(readFileSync(proxyJson, 'utf8')) as Record<
          string,
          { target?: string }
        >;
        const target = proxy['/api']?.target;
        const expectedTarget = `http://localhost:${wiring.langgraphPort}`;
        if (target !== expectedTarget) {
          errors.push(
            `${wiring.project}: proxy target ${target} != ${expectedTarget}`
          );
        }
      } else {
        errors.push(`${wiring.project}: missing proxy.conf (no .mjs or .json)`);
      }

      const scriptsDir = join(wiring.projectRoot, 'e2e/scripts');
      if (existsSync(scriptsDir)) {
        for (const script of readdirSync(scriptsDir).filter((name) =>
          name.startsWith('record-')
        )) {
          const scriptPath = join(scriptsDir, script);
          const text = readFileSync(scriptPath, 'utf8');
          if (!text.includes(wiring.langgraphCwd)) {
            errors.push(
              `${wiring.project}: ${relative(
                repoRoot,
                scriptPath
              )} does not reference ${wiring.langgraphCwd}`
            );
          }
          if (
            wiring.langgraphCwd !== 'cockpit/langgraph/streaming/python' &&
            text.includes('cockpit/langgraph/streaming/python')
          ) {
            errors.push(
              `${wiring.project}: ${relative(
                repoRoot,
                scriptPath
              )} still references cockpit/langgraph/streaming/python`
            );
          }
        }
      }

      for (const workflowPath of workflows) {
        const workflow = readRepoFile(workflowPath);
        // Dispatcher pattern (post-2026-05-23): the cockpit-e2e job's matrix
        // is emitted at runtime by scripts/cockpit-matrix.mjs via
        // `cap: ${{ fromJson(needs.cockpit-e2e-dispatcher.outputs.caps) }}`.
        // Every cap with an e2e target is covered by definition — no per-cap
        // literal needed in ci.yml.
        const dispatcherCoversAllCaps = workflow.includes(
          'fromJson(needs.cockpit-e2e-dispatcher.outputs.caps)'
        );
        if (dispatcherCoversAllCaps) {
          continue;
        }
        if (!workflow.includes(wiring.project)) {
          errors.push(
            `${wiring.project}: ${workflowPath} does not run the e2e target`
          );
        }
        // Matrix-migrated jobs (cockpit-e2e) template the working-directory via
        // `${{ matrix.cap.python }}`; the python path appears in the matrix
        // entry (e.g. `python: cockpit/chat/foo/python`) instead. Accept either
        // form so matrix and non-matrix jobs both pass.
        const literalUvSync = workflow.includes(
          `working-directory: ${wiring.langgraphCwd}`
        );
        const matrixEntry = workflow.includes(`python: ${wiring.langgraphCwd}`);
        if (!literalUvSync && !matrixEntry) {
          errors.push(
            `${wiring.project}: ${workflowPath} does not pre-sync ${wiring.langgraphCwd}`
          );
        }
      }
    }

    expect(errors).toEqual([]);
  });

  it('keeps capability-registry ports aligned with cockpit/ports.mjs', async () => {
    const mismatches: string[] = [];
    for (const cap of capabilities) {
      const ports = portsFor(cap.angularProject) as {
        angular: number;
        langgraph: number;
      };
      if (cap.port !== ports.angular) {
        mismatches.push(
          `${cap.id}: registry.port ${cap.port} !== ports.angular ${ports.angular}`
        );
      }
      if (cap.pythonPort !== undefined && cap.pythonPort !== ports.langgraph) {
        mismatches.push(
          `${cap.id}: registry.pythonPort ${cap.pythonPort} !== ports.langgraph ${ports.langgraph}`
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('every cockpit cap project declares the expected scope:* tags', () => {
    // Drift guard for the ci-scope thin-shim migration (PR #503/#507).
    // The shim reads scope:* tags off projects nx considers affected to
    // decide which CI gates to fire. A future contributor adding a new
    // cap could silently forget the tags — their changes would
    // underfire CI. This test catches that at build/test time.
    const errors: string[] = [];

    const capProjects = listProjectJsonFiles(join(repoRoot, 'cockpit'))
      .filter((p) => !p.includes('/ag-ui/')) // AG-UI has no python; out of scope
      .filter((p) => p.includes('/angular/') || p.includes('/python/'))
      .map((p) => ({
        path: p,
        project: JSON.parse(readFileSync(p, 'utf8')) as {
          name?: string;
          tags?: string[];
          targets?: Record<string, unknown>;
        },
      }));

    for (const { path: p, project } of capProjects) {
      const tags = new Set(project.tags ?? []);
      const relPath = relative(repoRoot, p);

      // Every cap project (angular or python) must trigger cockpit_e2e
      // + cockpit_examples.
      for (const required of ['scope:cockpit-e2e', 'scope:cockpit-examples']) {
        if (!tags.has(required)) {
          errors.push(`${relPath}: missing required tag ${required}`);
        }
      }

      // Python caps with a smoke target must also trigger cockpit_smoke.
      if (p.includes('/python/') && project.targets?.['smoke']) {
        if (!tags.has('scope:cockpit-smoke')) {
          errors.push(
            `${relPath}: has smoke target but missing scope:cockpit-smoke`
          );
        }
      }
    }

    expect(errors).toEqual([]);
  });

  it('smoke job represents every cockpit product with a real smoke target', () => {
    const ci = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
    const smokeLine =
      ci.split('\n').find((l) => l.includes('-t smoke --projects=')) ?? '';
    const listed = (smokeLine.match(/--projects=(\S+)/)?.[1] ?? '')
      .split(',')
      .filter(Boolean);

    // Every listed cockpit python project must actually declare a smoke target.
    const missingTarget = listed.filter((name) => {
      const cap = capabilities.find(
        (c) => c.angularProject.replace('-angular', '-python') === name
      );
      if (!cap?.pythonDir) return true; // listed a project not backed by a registry cap with python
      const pj = JSON.parse(
        readFileSync(join(repoRoot, cap.pythonDir, 'project.json'), 'utf8')
      );
      return !pj.targets?.smoke;
    });
    expect(missingTarget).toEqual([]);

    // Every product must be represented by a listed project.
    const products = [...new Set(capabilities.map((c) => c.product))];
    const uncovered = products.filter(
      (product) =>
        !capabilities.some(
          (c) =>
            c.product === product &&
            listed.includes(c.angularProject.replace('-angular', '-python'))
        )
    );
    expect(uncovered).toEqual([]);
  });
});
