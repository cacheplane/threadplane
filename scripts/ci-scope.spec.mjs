import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFromAffected,
  emptyScope,
  fullScope,
  hasGlobalCiFileChange,
  isAngularCompatibilityChange,
  SCOPE_KEYS,
} from './ci-scope.mjs';

const PUBLISHABLE_LIB_TAGS = [
  'scope:angular-compatibility',
  'scope:library',
  'scope:website',
  'scope:website-e2e',
  'scope:cockpit',
  'scope:cockpit-examples',
  'scope:cockpit-smoke',
  'scope:cockpit-e2e',
  'scope:examples-chat',
];
const COCKPIT_CAP_ANGULAR_TAGS = [
  'scope:cockpit-examples',
  'scope:cockpit-e2e',
];
const COCKPIT_CAP_PYTHON_TAGS = [
  'scope:cockpit-examples',
  'scope:cockpit-e2e',
  'scope:cockpit-smoke',
];
const WEBSITE_TAGS = ['scope:website', 'scope:website-e2e'];
const EXAMPLES_CHAT_TAGS = [
  'scope:angular-compatibility',
  'scope:examples-chat',
];
const POSTHOG_TAGS = ['scope:posthog'];
const GROWTH_LIFECYCLE_TAGS = ['scope:growth-lifecycle'];

describe('React migration baseline scope', () => {
  for (const file of [
    'scripts/react-parity/inventory.mjs',
    'fixtures/react-parity/traces/ag-ui-text-state.sse',
    'libs/core/src/index.ts',
    'libs/angular/src/public-api.ts',
    'libs/react/src/index.ts',
    'scripts/react-parity/package-policy.mjs',
    'fixtures/react-parity/consumers/angular/src/main.ts',
    'fixtures/react-parity/consumers/plain/package.json',
    'libs/ui-react/src/button.tsx',
    'apps/website/content/docs/chat/api/example.mdx',
    'cockpit/chat/messages/angular/src/index.ts',
    'cockpit/chat/new-topic/angular/project.json',
    'scripts/verify-release-versions.mjs',
  ]) {
    it(`runs library gates for ${file} even without Nx ownership`, () => {
      assert.equal(classifyFromAffected([file], []).library, true);
    });
  }

  it('does not send unrelated marketing or backend changes to library gates', () => {
    for (const file of [
      'apps/website/content/blog/post.mdx',
      'cockpit/chat/messages/python/src/graph.py',
    ]) assert.equal(classifyFromAffected([file], []).library, false);
  });
});

function nxAffectedFiles(file) {
  return JSON.parse(
    execFileSync(
      'npx',
      ['nx', 'show', 'projects', '--affected', `--files=${file}`, '--json'],
      { encoding: 'utf8' }
    )
  );
}

function listedOperatorCliTestFiles() {
  return execFileSync(
    'npx',
    [
      'vitest',
      'list',
      '--config',
      'libs/growth/vite.operator-cli.config.mts',
      '--filesOnly',
    ],
    { encoding: 'utf8' }
  )
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((file) => file.replace(`${process.cwd()}/`, ''))
    .sort();
}

describe('Angular compatibility project tags', () => {
  for (const projectFile of [
    'libs/chat/project.json',
    'libs/langgraph/project.json',
    'libs/ag-ui/project.json',
    'libs/render/project.json',
    'libs/a2ui/project.json',
    'libs/telemetry/project.json',
    'examples/chat/angular/project.json',
    'examples/chat/smoke/project.json',
  ]) {
    it(`${projectFile} owns the Angular compatibility scope`, async () => {
      const project = JSON.parse(await readFile(projectFile, 'utf8'));

      assert.ok(project.tags?.includes('scope:angular-compatibility'));
    });
  }
});

describe('classifyFromAffected — short-circuit', () => {
  it('detects global CI files before affected project lookup is needed', () => {
    assert.equal(hasGlobalCiFileChange(['nx.json']), true);
    assert.equal(hasGlobalCiFileChange(['libs/chat/src/foo.ts']), false);
  });

  it('returns full scope when a global CI file changes', () => {
    const scope = classifyFromAffected(['.github/workflows/ci.yml'], []);
    assert.deepEqual(scope, fullScope());
  });

  it('full scope on package.json change', () => {
    assert.deepEqual(classifyFromAffected(['package.json'], []), fullScope());
  });

  it('empty scope when no global file + no affected projects', () => {
    assert.deepEqual(
      classifyFromAffected(['docs/some-readme.md'], []),
      emptyScope()
    );
  });
});

describe('classifyFromAffected — lint-only files', () => {
  it('eslint.config.mjs flips only lint-running scopes, NOT e2e/smoke/deploy', () => {
    const scope = classifyFromAffected(['eslint.config.mjs'], []);
    // Lint-running scopes: true
    assert.equal(scope.library, true);
    assert.equal(scope.cockpit, true);
    assert.equal(scope.website, true);
    assert.equal(scope.examples_chat, true);
    assert.equal(scope.growth_lifecycle, true);
    assert.equal(scope.growth_research, true);
    assert.equal(scope.scripts_tests, true);
    // E2e / smoke / deploy / posthog scopes: false
    assert.equal(scope.website_e2e, false);
    assert.equal(scope.cockpit_e2e, false);
    assert.equal(scope.cockpit_smoke, false);
    assert.equal(scope.cockpit_examples, false);
    assert.equal(scope.posthog, false);
  });

  it('eslint.config.mjs alongside an affected project still ORs in the project scopes', () => {
    const scope = classifyFromAffected(
      ['eslint.config.mjs', 'cockpit/chat/messages/python/src/graph.py'],
      [
        {
          name: 'cockpit-chat-messages-python',
          tags: [
            'scope:cockpit-e2e',
            'scope:cockpit-examples',
            'scope:cockpit-smoke',
          ],
        },
      ]
    );
    assert.equal(scope.library, true);
    assert.equal(scope.cockpit_e2e, true);
    assert.equal(scope.cockpit_examples, true);
    assert.equal(scope.cockpit_smoke, true);
  });
});

describe('growth research project ownership', () => {
  it('maps the actual Growth Research project tag to its own CI lane', async () => {
    const project = JSON.parse(
      await readFile('apps/growth-research/project.json', 'utf8')
    );
    const scope = classifyFromAffected(
      ['apps/growth-research/src/company/context.ts'],
      [{ name: project.name, tags: project.tags }]
    );
    assert.deepEqual(scope, { ...emptyScope(), growth_research: true });
  });

  it('Nx selects Growth Research for a pilot source change', () => {
    assert.ok(
      nxAffectedFiles('apps/growth-research/src/company/context.ts').includes(
        'growth-research'
      )
    );
  });

  it('leaves Growth Research out of unrelated website-only scopes', () => {
    const scope = classifyFromAffected(
      ['apps/website/src/app/page.tsx'],
      [{ name: 'website', tags: WEBSITE_TAGS }]
    );
    assert.equal(scope.growth_research, false);
  });
});

describe('growth lifecycle project ownership', () => {
  for (const projectFile of [
    'libs/growth/project.json',
    'apps/lifecycle/project.json',
    'tools/google-mailbox-poller/project.json',
  ]) {
    it(`${projectFile} owns the growth lifecycle scope`, async () => {
      const project = JSON.parse(await readFile(projectFile, 'utf8'));
      assert.ok(project.tags?.includes('scope:growth-lifecycle'));
    });
  }

  for (const [file, owner] of [
    ['libs/growth/src/lib/jobs.ts', 'growth'],
    ['apps/lifecycle/src/dispatcher.ts', 'lifecycle'],
    ['tools/google-mailbox-poller/Code.gs', 'google-mailbox-poller'],
    ['scripts/apply-migrations.mts', 'growth'],
    ['scripts/growth-control.mts', 'growth'],
    ['scripts/growth-observability.mts', 'growth'],
    ['scripts/import-resend-lifecycle.mts', 'growth'],
    ['migrations/0001_rate_limit_events.sql', 'growth'],
    ['migrations/0002_growth_control_plane.sql', 'growth'],
    ['migrations/0003_growth_reporting_views.sql', 'growth'],
    ['migrations/9999_future_growth_feature.sql', 'growth'],
  ]) {
    it(`Nx selects ${owner} when ${file} changes`, () => {
      assert.ok(nxAffectedFiles(file).includes(owner));
    });
  }

  it('runs the database/operator CLI suites in its dedicated target', async () => {
    const project = JSON.parse(
      await readFile('libs/growth/project.json', 'utf8')
    );

    assert.equal(
      project.targets?.['test-operator-cli']?.options?.configFile,
      'libs/growth/vite.operator-cli.config.mts'
    );
    assert.deepEqual(listedOperatorCliTestFiles(), [
      'scripts/apply-migrations.spec.ts',
      'scripts/cancel-resend-lifecycle.spec.ts',
      'scripts/growth-control.spec.ts',
      'scripts/growth-observability.spec.ts',
      'scripts/import-resend-lifecycle.spec.ts',
    ]);
  });

  it('maps an affected growth-lifecycle project to the CI lane', () => {
    const scope = classifyFromAffected(
      ['libs/growth/src/lib/jobs.ts'],
      [{ name: 'growth', tags: GROWTH_LIFECYCLE_TAGS }]
    );

    assert.equal(scope.growth_lifecycle, true);
    assert.equal(scope.website, false);
  });
});

describe('classifyFromAffected — rootless cockpit specs', () => {
  // These specs live at cockpit/<product>/ — outside every project root — so
  // `nx affected` reports only the untagged `root` project for them. Without
  // the path rule they produced an empty scope and skipped the cockpit job
  // that actually runs them.
  for (const file of [
    'cockpit/deep-agents/footprint.spec.ts',
    'cockpit/chat/footprint.spec.ts',
    'cockpit/render/footprint.spec.ts',
    'cockpit/chat/matrix.spec.ts',
    'cockpit/langgraph/matrix.spec.ts',
  ]) {
    it(`${file} flips the cockpit scope even when nx reports only \`root\``, () => {
      const scope = classifyFromAffected(
        [file],
        [{ name: 'root', tags: ['npm:private'] }]
      );
      assert.equal(scope.cockpit, true);
    });
  }

  it('does not flip cockpit for specs that already live inside a project root', () => {
    const scope = classifyFromAffected(
      ['cockpit/chat/messages/angular/e2e/c-messages.spec.ts'],
      [{ name: 'root', tags: ['npm:private'] }]
    );
    assert.equal(scope.cockpit, false);
  });

  it('leaves the e2e / smoke / deploy scopes alone', () => {
    const scope = classifyFromAffected(
      ['cockpit/deep-agents/footprint.spec.ts'],
      [{ name: 'root', tags: ['npm:private'] }]
    );
    assert.equal(scope.cockpit_e2e, false);
    assert.equal(scope.cockpit_smoke, false);
    assert.equal(scope.cockpit_examples, false);
  });
});

describe('classifyFromAffected — publishable lib broadcast', () => {
  it('publishable lib triggers its existing scopes plus angular compatibility', () => {
    const scope = classifyFromAffected(
      ['libs/chat/src/foo.ts'],
      [{ name: 'chat', tags: PUBLISHABLE_LIB_TAGS }]
    );
    assert.equal(scope.library, true);
    assert.equal(scope.website, true);
    assert.equal(scope.website_e2e, true);
    assert.equal(scope.cockpit, true);
    assert.equal(scope.cockpit_examples, true);
    assert.equal(scope.cockpit_smoke, true);
    assert.equal(scope.cockpit_e2e, true);
    assert.equal(scope.examples_chat, true);
    assert.equal(scope.angular_compatibility, true);
    assert.equal(scope.posthog, false);
  });
});

describe('classifyFromAffected — cockpit runtime bridge', () => {
  it('selects Cockpit, examples, and browser coverage through existing scopes', async () => {
    const project = JSON.parse(
      await readFile('libs/cockpit-runtime-bridge/project.json', 'utf8')
    );
    const scope = classifyFromAffected(
      ['libs/cockpit-runtime-bridge/src/index.ts'],
      [{ name: project.name, tags: project.tags }]
    );

    assert.equal(scope.cockpit, true);
    assert.equal(scope.cockpit_examples, true);
    assert.equal(scope.cockpit_e2e, true);
  });
});

describe('classifyFromAffected — Angular compatibility', () => {
  for (const projectName of ['examples-chat-angular', 'examples-chat-smoke']) {
    it(`${projectName} triggers Angular compatibility without unrelated scopes`, () => {
      const scope = classifyFromAffected(
        [
          `examples/chat/${
            projectName === 'examples-chat-angular'
              ? 'angular/src/app/app.ts'
              : 'smoke/cli.mjs'
          }`,
        ],
        [{ name: projectName, tags: EXAMPLES_CHAT_TAGS }]
      );

      assert.equal(scope.angular_compatibility, true);
      assert.equal(scope.examples_chat, true);
      for (const key of SCOPE_KEYS) {
        if (key === 'angular_compatibility' || key === 'examples_chat')
          continue;
        assert.equal(scope[key], false, `${key} should remain false`);
      }
    });
  }

  it('website-only and PostHog changes leave Angular compatibility false', () => {
    const websiteScope = classifyFromAffected(
      ['apps/website/src/app/page.tsx'],
      [{ name: 'website', tags: WEBSITE_TAGS }]
    );
    const posthogScope = classifyFromAffected(
      ['tools/posthog/src/dashboards.ts'],
      [{ name: 'posthog-tools', tags: POSTHOG_TAGS }]
    );

    assert.equal(websiteScope.angular_compatibility, false);
    assert.equal(posthogScope.angular_compatibility, false);
  });

  it('global CI files include Angular compatibility in full scope', () => {
    assert.equal(
      classifyFromAffected(['.github/workflows/ci.yml'], [])
        .angular_compatibility,
      true
    );
  });
});

describe('isAngularCompatibilityChange', () => {
  const exactFiles = [
    'scripts/verify-angular-support.mjs',
    'scripts/verify-angular-support.spec.mjs',
    'libs/chat/package.json',
    'libs/langgraph/package.json',
    'libs/ag-ui/package.json',
    'libs/render/package.json',
    'libs/telemetry/package.json',
    'libs/cockpit-telemetry/package.json',
    'libs/example-layouts/package.json',
    'apps/website/src/components/pricing/angular-support.mjs',
    'apps/website/src/components/pricing/CompatibilityMatrix.tsx',
    'apps/website/src/components/pricing/PricingDetails.tsx',
    'README.md',
    'libs/chat/README.md',
    'libs/langgraph/README.md',
    'libs/ag-ui/README.md',
    'libs/render/README.md',
    'libs/telemetry/README.md',
    'apps/website/content/docs/chat/getting-started/installation.mdx',
    'apps/website/content/docs/langgraph/getting-started/installation.mdx',
    'apps/website/content/docs/ag-ui/getting-started/installation.mdx',
    'apps/website/content/docs/render/getting-started/installation.mdx',
  ];

  for (const file of exactFiles) {
    it(`directly selects Angular compatibility for ${file}`, () => {
      assert.equal(isAngularCompatibilityChange([file]), true);
      assert.equal(
        classifyFromAffected([file], []).angular_compatibility,
        true
      );
    });
  }

  for (const file of [
    'examples/chat/smoke/template/package.json',
    'examples/chat/angular/src/app/app.ts',
  ]) {
    it(`selects Angular compatibility for files below ${file}`, () => {
      assert.equal(isAngularCompatibilityChange([file]), true);
      assert.equal(
        classifyFromAffected([file], []).angular_compatibility,
        true
      );
    });
  }

  it('does not select unrelated files', () => {
    assert.equal(
      isAngularCompatibilityChange(['apps/website/src/app/page.tsx']),
      false
    );
  });
});

describe('classifyFromAffected — cockpit cap projects', () => {
  it('cockpit cap python triggers cockpit_e2e + cockpit_examples + cockpit_smoke', () => {
    const scope = classifyFromAffected(
      ['cockpit/chat/messages/python/src/graph.py'],
      [{ name: 'cockpit-chat-messages-python', tags: COCKPIT_CAP_PYTHON_TAGS }]
    );
    assert.equal(scope.cockpit_e2e, true);
    assert.equal(scope.cockpit_examples, true);
    assert.equal(scope.cockpit_smoke, true);
    assert.equal(scope.cockpit, false);
    assert.equal(scope.library, false);
  });

  it('cockpit cap angular triggers cockpit_e2e + cockpit_examples only', () => {
    const scope = classifyFromAffected(
      ['cockpit/chat/messages/angular/src/main.ts'],
      [
        {
          name: 'cockpit-chat-messages-angular',
          tags: COCKPIT_CAP_ANGULAR_TAGS,
        },
      ]
    );
    assert.equal(scope.cockpit_e2e, true);
    assert.equal(scope.cockpit_examples, true);
    assert.equal(scope.cockpit_smoke, false);
  });
});

describe('classifyFromAffected — apps + fallback paths via namedInputs', () => {
  it('vercel.json change marks apps/website affected → website + website_e2e', () => {
    const scope = classifyFromAffected(
      ['vercel.json'],
      [{ name: 'website', tags: WEBSITE_TAGS }]
    );
    assert.equal(scope.website, true);
    assert.equal(scope.website_e2e, true);
    assert.equal(scope.cockpit, false);
  });

  it('capability-registry.ts change marks cockpit-registry affected → cockpit scopes', () => {
    const scope = classifyFromAffected(
      ['libs/cockpit-registry/src/lib/capability-registry.ts'],
      [
        {
          name: 'cockpit-registry',
          tags: [
            'scope:cockpit',
            'scope:cockpit-e2e',
            'scope:cockpit-examples',
          ],
        },
      ]
    );
    assert.equal(scope.cockpit, true);
    assert.equal(scope.cockpit_examples, true);
    assert.equal(scope.cockpit_e2e, true);
  });

  it('the Website-owned platform smoke selects Website browser coverage', () => {
    const scope = classifyFromAffected(
      ['apps/website/e2e/platform-production-smoke.spec.ts'],
      [{ name: 'website', tags: WEBSITE_TAGS }]
    );

    assert.equal(scope.website, true);
    assert.equal(scope.website_e2e, true);
    assert.equal(scope.cockpit_e2e, false);
  });

  it('examples/chat change → examples_chat only', () => {
    const scope = classifyFromAffected(
      ['examples/chat/angular/src/main.ts'],
      [{ name: 'examples-chat-angular', tags: EXAMPLES_CHAT_TAGS }]
    );
    assert.equal(scope.examples_chat, true);
    assert.equal(scope.cockpit, false);
  });

  it('tools/posthog change → posthog only', () => {
    const scope = classifyFromAffected(
      ['tools/posthog/src/dashboards.ts'],
      [{ name: 'posthog-tools', tags: POSTHOG_TAGS }]
    );
    assert.equal(scope.posthog, true);
    assert.equal(scope.library, false);
  });
});

describe('classifyFromAffected — tag isolation', () => {
  it('marketing operator changes select the job that runs their boundary checks', async () => {
    for (const name of ['assets', 'channels']) {
      const project = JSON.parse(await readFile(`marketing/${name}/project.json`, 'utf8'));
      const scope = classifyFromAffected(
        [`marketing/${name}/src/index.ts`],
        [{ name: project.name, tags: project.tags }]
      );
      assert.equal(scope.scripts_tests, true);
      assert.equal(scope.growth_lifecycle, false);
    }
    const workflow = await readFile('.github/workflows/ci.yml', 'utf8');
    const job = workflow.split('  scripts-tests:')[1].split('\n  library:')[0];
    assert.match(job, /nx run-many -t lint test --projects=marketing-assets,marketing-channels/);
  });
  it('tags not prefixed with "scope:" are ignored', () => {
    const scope = classifyFromAffected(
      ['some.ts'],
      [{ name: 'x', tags: ['type:app', 'rotation:weekly'] }]
    );
    assert.deepEqual(scope, emptyScope());
  });

  it('unknown scope tags are ignored (no key collision)', () => {
    const scope = classifyFromAffected(
      ['some.ts'],
      [{ name: 'x', tags: ['scope:not-a-real-scope'] }]
    );
    assert.deepEqual(scope, emptyScope());
  });
});

describe('classifyFromAffected — examples/ag-ui', () => {
  // examples/ag-ui/{,angular/}project.json already carried
  // `scope:examples-ag-ui`, but `examples_ag_ui` was missing from SCOPE_KEYS,
  // so classifyFromAffected read the tag and dropped it on the floor. The
  // examples-ag-ui-e2e job therefore had no scope to gate on and ran on every
  // PR — a 35-minute-timeout Playwright job on docs-only changes.
  it('an affected examples/ag-ui project selects examples_ag_ui only', async () => {
    const project = JSON.parse(
      await readFile('examples/ag-ui/angular/project.json', 'utf8')
    );
    const scope = classifyFromAffected(
      ['examples/ag-ui/angular/src/app/app.ts'],
      [{ name: project.name, tags: project.tags }]
    );

    assert.equal(scope.examples_ag_ui, true);
    assert.equal(scope.examples_chat, false);
    assert.equal(scope.cockpit_e2e, false);
    assert.equal(scope.website, false);
  });

  it('the python backend the e2e job uv-syncs owns the scope too', async () => {
    // The examples-ag-ui-e2e job runs `uv sync` in examples/ag-ui/python and
    // then drives the Angular app against it. An untagged backend would mean
    // a python-only change silently skips the suite — scoping that buys speed
    // by dropping coverage.
    const project = JSON.parse(
      await readFile('examples/ag-ui/python/project.json', 'utf8')
    );

    assert.ok(
      project.tags?.includes('scope:examples-ag-ui'),
      'examples/ag-ui/python must select the ag-ui e2e suite'
    );

    const scope = classifyFromAffected(
      ['examples/ag-ui/python/src/agent.py'],
      [{ name: project.name, tags: project.tags }]
    );
    assert.equal(scope.examples_ag_ui, true);
  });

  it('a website-only change leaves examples_ag_ui false', () => {
    const scope = classifyFromAffected(
      ['apps/website/src/app/layout.tsx'],
      [{ name: 'website', tags: WEBSITE_TAGS }]
    );
    assert.equal(scope.examples_ag_ui, false);
  });
});

describe('SCOPE_KEYS export', () => {
  it('contains the 14 documented scope keys', () => {
    assert.deepEqual(SCOPE_KEYS, [
      'library',
      'angular_compatibility',
      'website',
      'website_e2e',
      'cockpit',
      'cockpit_examples',
      'cockpit_smoke',
      'cockpit_e2e',
      'examples_chat',
      'examples_ag_ui',
      'posthog',
      'scripts_tests',
      'growth_lifecycle',
      'growth_research',
    ]);
  });
});

describe('classifyFromAffected — cockpit e2e matrix stays scoped to its own caps', () => {
  // The cockpit-e2e matrix dispatches `nx e2e` for the standalone Angular cap
  // apps under cockpit/**. A website-only change must not incidentally flip
  // cockpit_e2e just because some sibling cockpit library is also nx-affected
  // (PR #932 regressed this when a now-retired app statically imported from
  // the Website, so a website-only PR ran the whole cap matrix).
  it('a website-only change leaves cockpit_e2e false', async () => {
    const cockpitRegistry = JSON.parse(
      await readFile('libs/cockpit-registry/project.json', 'utf8')
    );
    const website = JSON.parse(
      await readFile('apps/website/project.json', 'utf8')
    );

    // libs/cockpit-registry is not affected by a website-only change, so it
    // must not appear in the affected set here — only `website` does.
    const scope = classifyFromAffected(
      [
        'apps/website/src/app/layout.tsx',
        'apps/website/src/components/shared/SiteFooter.tsx',
      ],
      [{ name: 'website', tags: website.tags }]
    );

    assert.equal(scope.cockpit_e2e, false);
    assert.equal(scope.website, true);
    // cockpit-registry legitimately owns cockpit-e2e when it IS affected —
    // this just confirms it was not swept in here.
    assert.ok(cockpitRegistry.tags.includes('scope:cockpit-e2e'));
  });

  it('a registry change does flip cockpit_e2e, so the negative case above is not vacuous', async () => {
    const cockpitRegistry = JSON.parse(
      await readFile('libs/cockpit-registry/project.json', 'utf8')
    );
    const website = JSON.parse(
      await readFile('apps/website/project.json', 'utf8')
    );

    const scope = classifyFromAffected(
      ['libs/cockpit-registry/src/lib/manifest.ts'],
      [
        { name: 'website', tags: website.tags },
        { name: 'cockpit-registry', tags: cockpitRegistry.tags },
      ]
    );

    assert.equal(scope.cockpit_e2e, true);
  });
});
