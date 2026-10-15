import { spawnSync } from 'child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { minimatch } from 'minimatch';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { capabilities } from '@threadplane/cockpit-registry';

const root = resolve(__dirname, '..');
const sharedUrl =
  'https://cockpit-dev-free-6957db75280055dcbbf2a4916c04b66f.us.langgraph.app';
const workflow = readFileSync(
  resolve(root, '.github/workflows/deploy-langgraph.yml'),
  'utf8'
);
// Read the push filter itself: paths mentioned in jobs or comments must not
// satisfy trigger coverage. These positive globs use GitHub's ** semantics.
const parsedWorkflow = parse(workflow) as {
  on: { push: { paths: string[] } };
  jobs: {
    deploy: { steps: { name?: string; run?: string; shell?: string }[] };
  };
};
const pushPaths = parsedWorkflow.on.push.paths;
const deploySteps = parsedWorkflow.jobs.deploy.steps;
const triggersDeployment = (file: string): boolean =>
  pushPaths.some((pattern) => minimatch(file, pattern, { dot: true }));
// Keep this selection aligned with generate-shared-deployment-config.ts.
const sharedCapabilities = capabilities.filter(
  (capability) =>
    capability.pythonDir &&
    capability.product !== 'ag-ui' &&
    capability.product !== 'runtimes'
);

describe('shared free deployment routing', () => {
  it.each(sharedCapabilities)(
    'redeploys for staged Python inputs of $id ($product)',
    (capability) => {
      const manifestPath = `${capability.pythonDir}/langgraph.json`;
      const manifest = JSON.parse(
        readFileSync(resolve(root, manifestPath), 'utf8')
      ) as { graphs: Record<string, string> };
      const files = [
        manifestPath,
        ...Object.values(manifest.graphs).map(
          (entrypoint) =>
            `${capability.pythonDir}/${entrypoint
              .split(':')[0]
              .replace(/^\.\//, '')}`
        ),
      ];
      for (const file of files) {
        expect(existsSync(resolve(root, file)), file).toBe(true);
        expect(triggersDeployment(file), file).toBe(true);
      }
    }
  );

  it.each([
    'examples/chat/python/langgraph.json',
    'examples/chat/python/src/graph.py',
    '.github/workflows/deploy-langgraph.yml',
    'scripts/generate-shared-deployment-config.ts',
    'libs/cockpit-registry/src/lib/capability-registry.ts',
    'deployments/shared-dev/langgraph.json',
  ])('redeploys when shared deployment input %s changes', (file) => {
    expect(existsSync(resolve(root, file)), file).toBe(true);
    expect(triggersDeployment(file), file).toBe(true);
  });

  it.each(
    capabilities.filter(
      (capability) =>
        capability.pythonDir &&
        (capability.product === 'ag-ui' || capability.product === 'runtimes')
    )
  )('excludes separately deployed Python inputs of $id', (capability) => {
    const file = `${capability.pythonDir}/pyproject.toml`;
    expect(existsSync(resolve(root, file)), file).toBe(true);
    expect(triggersDeployment(file), file).toBe(false);
  });

  it('routes every active capability and both production proxy defaults to the free deployment', () => {
    const urls = JSON.parse(
      readFileSync(resolve(root, 'deployment-urls.json'), 'utf8')
    );
    expect(Object.keys(urls).length).toBeGreaterThan(0);
    expect([...new Set(Object.values(urls))]).toEqual([sharedUrl]);
    for (const file of [
      'scripts/examples-middleware.ts',
      'scripts/langgraph-proxy.ts',
    ]) {
      const source = readFileSync(resolve(root, file), 'utf8');
      expect(source).toContain(sharedUrl);
      expect(source).not.toContain(
        'cockpit-dev-219a15942c545a00a03a9a41905d7fc2'
      );
    }
  });

  it('updates only the pinned existing deployment and redeploys when its workflow changes', () => {
    const command = deploySteps.find(
      (step) => step.name === 'Update existing cockpit-dev-free'
    )!.run!;
    expect(command).toContain('--with langgraph-cli==0.4.21');
    expect(command).toContain(
      '--deployment-id 6d350054-14ea-4031-8463-010ec27f9059'
    );
    expect(command).not.toMatch(/--name\b|--deployment-type\b/);
    expect(command).toContain('--no-wait');
    expect(command).toContain('--tag "$GITHUB_SHA"');
    expect(workflow).toContain("- '.github/workflows/deploy-langgraph.yml'");
  });
});

// Offline command tests execute the YAML shell with fake local commands. They
// establish neither a real Docker push nor provider revision readiness.
describe('shared deployment image evidence (offline command tests)', () => {
  const sha = '1234567890abcdef1234567890abcdef12345678';
  const repository =
    'us-central1-docker.pkg.dev/langchain-prod/cockpit-dev-free-6957db75280055dcbbf2a4916c04b66f/shared-dev';
  const image = `${repository}@sha256:${'a'.repeat(64)}`;

  function runEvidence(
    dockerOutput: string,
    checkoutSha = sha,
    dockerStatus = 0
  ) {
    const step = deploySteps.find(
      (candidate) =>
        candidate.name === 'Record shared deployment image evidence'
    );
    expect(
      step,
      'workflow must capture immutable image evidence'
    ).toBeDefined();
    expect(step!.shell).toBe('bash');
    expect(deploySteps.indexOf(step!)).toBeGreaterThan(
      deploySteps.findIndex(
        (candidate) => candidate.name === 'Update existing cockpit-dev-free'
      )
    );
    const directory = mkdtempSync(resolve(tmpdir(), 'shared-image-evidence-'));
    try {
      writeFileSync(
        resolve(directory, 'docker'),
        '#!/bin/bash\nprintf "%s\\n" "$@" > "$DOCKER_ARGS"\nprintf "%s" "$DOCKER_OUTPUT"\nexit "$DOCKER_STATUS"\n',
        { mode: 0o755 }
      );
      writeFileSync(
        resolve(directory, 'git'),
        '#!/bin/bash\n[[ "$*" == "rev-parse HEAD" ]] || exit 99\nprintf "%s\\n" "$CHECKOUT_SHA"\n',
        { mode: 0o755 }
      );
      const argsPath = resolve(directory, 'docker-args');
      const result = spawnSync(
        '/bin/bash',
        ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', step!.run!],
        {
          cwd: directory,
          encoding: 'utf8',
          env: {
            PATH: `${directory}:/usr/bin:/bin`,
            GITHUB_SHA: sha,
            CHECKOUT_SHA: checkoutSha,
            DOCKER_OUTPUT: dockerOutput,
            DOCKER_STATUS: String(dockerStatus),
            DOCKER_ARGS: argsPath,
          },
        }
      );
      expect(result.error).toBeUndefined();
      return {
        ...result,
        dockerArgs: existsSync(argsPath)
          ? readFileSync(argsPath, 'utf8').trim().split('\n')
          : [],
      };
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  it('prints only exact source and one immutable image from a read-only SHA-filtered listing', () => {
    const result = runEvidence(`${image}\n`);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(`source_sha=${sha}\nimage_uri=${image}\n`);
    expect(result.dockerArgs).toEqual([
      'image',
      'ls',
      '--digests',
      '--filter',
      `reference=${repository}:${sha}`,
      '--format',
      '{{.Repository}}@{{.Digest}}',
    ]);
  });

  it.each([
    ['missing image', ''],
    ['ambiguous images', `${image}\n${image}\n`],
    ['missing digest', `${repository}@<none>\n`],
    ['short digest', `${repository}@sha256:abc\n`],
    ['uppercase digest', `${repository}@sha256:${'A'.repeat(64)}\n`],
    ['wrong registry', `other.example/shared-dev@sha256:${'a'.repeat(64)}\n`],
    [
      'wrong deployment repository',
      `${repository}-other@sha256:${'a'.repeat(64)}\n`,
    ],
  ])('fails closed for %s', (_name, output) => {
    const result = runEvidence(output);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
  });

  it('fails before listing images when checkout differs from the workflow source', () => {
    const result = runEvidence(`${image}\n`, 'b'.repeat(40));
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.dockerArgs).toEqual([]);
  });

  it('fails closed when Docker fails even with valid-looking output', () => {
    const result = runEvidence(`${image}\n`, sha, 1);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
  });
});
