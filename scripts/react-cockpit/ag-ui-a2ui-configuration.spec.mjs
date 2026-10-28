import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { reactCockpitConfiguration } from './configuration.mjs';
test('native AG-UI A2UI has one closed authored frontend allocation', () => {
  assert.deepEqual(reactCockpitConfiguration('ag-ui-a2ui'), {
    topic: 'a2ui',
    library: 'ag-ui',
    adapter: 'ag-ui',
    appPath: 'cockpit/ag-ui/a2ui/react',
    base: '/ag-ui/a2ui/react/',
    port: 4647,
    project: 'cockpit-ag-ui-a2ui-react',
  });
  assert.ok(Object.isFrozen(reactCockpitConfiguration('ag-ui-a2ui')));
  for (const key of [
    'a2ui',
    '../ag-ui-a2ui',
    'ag-ui-a2ui/../streaming',
    '/ag-ui/a2ui/react/',
    'ag-ui-a2ui-remote',
  ])
    assert.throws(() => reactCockpitConfiguration(key), /Unsupported/);
  assert.equal(reactCockpitConfiguration('chat-a2ui').port, 4646);
});

test('native A2UI owns uncached preparation and exactly one installed proof dependency', () => {
  const project = JSON.parse(
    readFileSync(
      new URL('../../cockpit/ag-ui/a2ui/react/project.json', import.meta.url),
      'utf8'
    )
  );
  for (const target of ['prepare-fixture', 'fixture-test', 'e2e']) {
    assert.ok(project.targets[target], `Missing ${target}`);
    assert.equal(project.targets[target].cache, false);
  }
  assert.equal(
    project.targets['fixture-test'].options.command,
    'node scripts/react-cockpit/prepare-ag-ui-a2ui-fixture.mjs --verify-application'
  );
  assert.deepEqual(project.targets['fixture-test'].dependsOn, [
    { target: 'build', projects: ['core', 'content', 'react', 'a2ui'] },
  ]);
  assert.deepEqual(project.targets.e2e.dependsOn, [
    'prepare-fixture',
    'build',
    'fixture-test',
  ]);
  assert.ok(
    project.namedInputs?.nativeA2uiFixture?.includes(
      '{workspaceRoot}/fixtures/react-parity/native-ag-ui-a2ui/**/*'
    )
  );
});

test('native A2UI capability CI owns one installed proof with retained partial artifacts', () => {
  const workflow = parse(
    readFileSync(
      new URL('../../.github/workflows/ci.yml', import.meta.url),
      'utf8'
    )
  );
  const steps = workflow.jobs['cockpit-e2e'].steps;
  const conditional = steps.filter((step) =>
    step.if?.includes("matrix.cap.angular == 'cockpit-ag-ui-a2ui-react'")
  );
  const preparation = conditional.find(
    (step) => step.name === 'Prepare native A2UI proof ownership'
  );
  assert.ok(preparation, 'Missing native A2UI capability preparation');
  assert.ok(preparation.run.includes('THREADPLANE_AGUI_A2UI_APPLICATION_ROOT'));
  assert.ok(preparation.run.includes('ag-ui-a2ui-preparation.spec.mjs'));
  for (const field of [
    'provenance.json',
    "git('HEAD')",
    "git('HEAD^{tree}')",
    'GITHUB_SHA',
    'GITHUB_RUN_ID',
    'GITHUB_RUN_ATTEMPT',
  ])
    assert.ok(
      preparation.run.includes(field),
      'Missing retained source/run provenance: ' + field
    );
  const artifact = conditional.find((step) =>
    step.uses?.startsWith('actions/upload-artifact@')
  );
  assert.ok(artifact?.if.startsWith('always()'));
  assert.equal(
    artifact.with.name,
    'threadplane-agui-a2ui-application-${{ github.run_attempt }}'
  );
  assert.equal(
    artifact.with.path,
    '${{ runner.temp }}/threadplane-agui-a2ui-application'
  );
  assert.equal(artifact.with['include-hidden-files'], true);
  assert.equal(artifact.with['retention-days'], 7);
  const website = workflow.jobs['website-e2e'].steps;
  assert.ok(
    website.some(
      (step) =>
        step.run === 'node scripts/react-cockpit/prepare-ag-ui-a2ui-fixture.mjs'
    )
  );
  assert.ok(
    !website.some((step) =>
      step.run?.includes('prepare-ag-ui-a2ui-fixture.mjs --verify-application')
    )
  );
});

test('workspace full A2UI regressions provision pinned Python tooling before every suite', () => {
  const workflow = parse(
    readFileSync(
      new URL('../../.github/workflows/ci.yml', import.meta.url),
      'utf8'
    )
  );
  const steps = workflow.jobs.cockpit.steps;
  const suites = [
    'npx nx test cockpit-a2ui-react --skip-nx-cache',
    'npx nx test cockpit-chat-a2ui-react --skip-nx-cache',
    'npx nx test cockpit-ag-ui-a2ui-react --skip-nx-cache',
  ];
  const setupIndex = steps.findIndex((step) =>
    step.uses?.startsWith('astral-sh/setup-uv@')
  );
  assert.ok(setupIndex >= 0, 'Workspace full tests need uv and Python 3.12');
  const setup = steps[setupIndex];
  assert.equal(
    setup.uses,
    'astral-sh/setup-uv@cec208311dfd045dd5311c1add060b2062131d57'
  );
  assert.equal(setup.with['python-version'], '3.12');
  assert.equal(
    Object.hasOwn(setup, 'if'),
    false,
    'Tooling setup is unconditional'
  );
  for (const command of suites) {
    const matches = steps.filter((step) => step.run === command);
    assert.equal(matches.length, 1, `Preserve one complete suite: ${command}`);
    assert.equal(Object.hasOwn(matches[0], 'if'), false);
    assert.ok(
      steps.indexOf(matches[0]) > setupIndex,
      `Provision before ${command}`
    );
  }
});

test('full local Website execution has a finite enclosing Nx step budget', () => {
  const workflow = parse(
    readFileSync(
      new URL('../../.github/workflows/ci.yml', import.meta.url),
      'utf8'
    )
  );
  const job = workflow.jobs['website-e2e'];
  assert.deepEqual(job.strategy.matrix.shard, [1, 2]);
  assert.equal(job.strategy['fail-fast'], false);
  const steps = job.steps;
  const runs = steps.filter(
    (step) =>
      step.run ===
      'npx nx e2e website --skip-nx-cache --skipInstall --shard=${{ matrix.shard }}/2'
  );
  assert.equal(runs.length, 1);
  assert.equal(runs[0]['timeout-minutes'], 45);
  assert.equal(Object.hasOwn(runs[0], 'if'), false);
  // This bound belongs to the local suite, not the independent deployed preview job.
  assert.equal(workflow.jobs['website-preview-e2e']['timeout-minutes'], 40);
});
