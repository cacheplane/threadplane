import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import * as angularSupportVerifier from './verify-angular-support.mjs';
import {
  ANGULAR_MANIFESTS,
  ANGULAR_PEER_RANGE,
  verifyPeerRanges,
  verifyWebsiteMajors,
} from './verify-angular-support.mjs';

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value);
}

async function createFixture(t, updateManifest) {
  const root = await mkdtemp(join(tmpdir(), 'threadplane-angular-support-'));
  t.after(() => rm(root, { force: true, recursive: true }));

  for (const manifest of ANGULAR_MANIFESTS) {
    await writeJson(join(root, manifest), {
      peerDependencies: {
        '@angular/core': ANGULAR_PEER_RANGE,
      },
    });
  }

  await updateManifest(root);
  return root;
}

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr, stdout }));
  });
}

function createWebsiteFixture({ supportedMajors = [20, 21, 22] } = {}) {
  return { websiteSupportedAngularMajors: supportedMajors };
}

async function createDocumentationFixture(t, updateDocumentation) {
  const root = await mkdtemp(join(tmpdir(), 'threadplane-angular-docs-'));
  t.after(() => rm(root, { force: true, recursive: true }));

  for (const {
    marker,
    path,
  } of angularSupportVerifier.ANGULAR_SUPPORT_README_BLOCKS ?? []) {
    await writeText(
      join(root, path),
      [
        `<img alt="${angularSupportVerifier.ANGULAR_SUPPORT_BADGE_TEXT}" src="https://img.shields.io/badge/Angular-${angularSupportVerifier.ANGULAR_SUPPORT_BADGE_URL_MESSAGE}-6C8EFF" />`,
        marker,
        '',
        '```',
        `@angular/core ${ANGULAR_PEER_RANGE}`,
        '```',
      ].join('\n')
    );
  }

  for (const page of angularSupportVerifier.ANGULAR_SUPPORT_INSTALLATION_PAGES ??
    []) {
    await writeText(
      join(root, page),
      `${angularSupportVerifier.ACTIVE_INSTALLATION_SUPPORT_STATEMENT}\n${angularSupportVerifier.ACTIVE_INSTALLATION_NODE_GUIDANCE}\n`
    );
  }

  await updateDocumentation(root);
  return root;
}

test('imports without CLI side effects when argv[1] is undefined', async () => {
  const result = await runNode([
    '--input-type=module',
    '-e',
    "await import('./scripts/verify-angular-support.mjs')",
  ]);

  assert.deepEqual(result, { code: 0, stderr: '', stdout: '' });
});

test('uses the expected Angular peer range in every repository manifest', async () => {
  assert.equal(ANGULAR_PEER_RANGE, '^20.0.0 || ^21.0.0 || ^22.0.0');
  await verifyPeerRanges();
});

test('requires Angular 22 in active package docs and installation pages', async () => {
  assert.equal(
    typeof angularSupportVerifier.verifyDocumentation,
    'function',
    'the verifier must expose documentation checks'
  );

  await angularSupportVerifier.verifyDocumentation();
});

test('uses a fully valid active documentation fixture baseline', async (t) => {
  const root = await createDocumentationFixture(t, async () => {});

  await angularSupportVerifier.verifyDocumentation({ root });
});

test('reports all stale active documentation in one pass', async (t) => {
  assert.equal(typeof angularSupportVerifier.verifyDocumentation, 'function');

  const root = await createDocumentationFixture(t, async (fixtureRoot) => {
    await writeText(
      join(fixtureRoot, 'README.md'),
      'Peer dependencies: `@angular/core ^20.0.0 || ^21.0.0`\n'
    );
    await writeText(
      join(
        fixtureRoot,
        'apps/website/content/docs/angular/chat/getting-started/installation.mdx'
      ),
      'Angular 20 and 21\n^20.0.0 || ^21.0.0\n'
    );
  });

  await assert.rejects(
    angularSupportVerifier.verifyDocumentation({ root }),
    (error) => {
      assert.match(
        error.message,
        /README\.md active peer-dependency block must include the Angular peer range "\^20\.0\.0 \|\| \^21\.0\.0 \|\| \^22\.0\.0"\./
      );
      assert.match(
        error.message,
        /apps\/website\/content\/docs\/angular\/chat\/getting-started\/installation\.mdx must contain "Supported Angular majors: 20, 21, and 22\."\./
      );
      assert.match(
        error.message,
        /apps\/website\/content\/docs\/angular\/chat\/getting-started\/installation\.mdx must not retain the stale Angular peer range "\^20\.0\.0 \|\| \^21\.0\.0"\./
      );
      return true;
    }
  );
});

test('rejects a stale active peer block despite an unrelated canonical example', async (t) => {
  const root = await createDocumentationFixture(t, async (fixtureRoot) => {
    await writeText(
      join(fixtureRoot, 'README.md'),
      [
        '**Peer dependencies:** `@angular/core ^20.0.0 || ^21.0.0`',
        '',
        `Example peer range: \`${ANGULAR_PEER_RANGE}\``,
      ].join('\n')
    );
  });

  await assert.rejects(
    angularSupportVerifier.verifyDocumentation({ root }),
    /README\.md active peer-dependency block must include the Angular peer range/
  );
});

test('rejects a stale Shields badge message despite correct alt text', async (t) => {
  const root = await createDocumentationFixture(t, async (fixtureRoot) => {
    await writeText(
      join(fixtureRoot, 'README.md'),
      [
        '<img alt="Angular 20 | 21 | 22" src="https://img.shields.io/badge/Angular-20%20%7C%2021-6C8EFF" />',
        '',
        `**Peer dependencies:** \`@angular/core ${ANGULAR_PEER_RANGE}\``,
      ].join('\n')
    );
  });

  await assert.rejects(
    angularSupportVerifier.verifyDocumentation({ root }),
    (error) => {
      assert.deepEqual(
        error.message
          .split('\n')
          .filter((message) => message.includes('Angular support badge')),
        [
          'README.md Angular support badge must encode the message "20%20%7C%2021%20%7C%2022" in the same <img> tag.',
        ]
      );
      return true;
    }
  );
});

test('uses the registry Angular majors in website support data', async () => {
  await verifyWebsiteMajors();
});

test('reports website support data that omits Angular 22', async () => {
  await assert.rejects(
    verifyWebsiteMajors(createWebsiteFixture({ supportedMajors: [20, 21] })),
    /website supported Angular majors expected "20, 21, 22" but found "20, 21"/
  );
});

test('reports website support data that advertises Angular 23', async () => {
  await assert.rejects(
    verifyWebsiteMajors(
      createWebsiteFixture({ supportedMajors: [20, 21, 22, 23] })
    ),
    /website supported Angular majors expected "20, 21, 22" but found "20, 21, 22, 23"/
  );
});

test('reports a peer range that omits Angular 22', async (t) => {
  const root = await createFixture(t, async (fixtureRoot) => {
    await writeJson(join(fixtureRoot, 'libs/chat/package.json'), {
      peerDependencies: {
        '@angular/core': '^20.0.0 || ^21.0.0',
      },
    });
  });

  await assert.rejects(
    verifyPeerRanges({ root }),
    /libs\/chat\/package\.json peerDependencies\["@angular\/core"\] expected "\^20\.0\.0 \|\| \^21\.0\.0 \|\| \^22\.0\.0" but found "\^20\.0\.0 \|\| \^21\.0\.0"/
  );
});

test('reports a peer range that unexpectedly includes Angular 23', async (t) => {
  const root = await createFixture(t, async (fixtureRoot) => {
    await writeJson(join(fixtureRoot, 'libs/langgraph/package.json'), {
      peerDependencies: {
        '@angular/core': '^20.0.0 || ^21.0.0 || ^22.0.0 || ^23.0.0',
      },
    });
  });

  await assert.rejects(
    verifyPeerRanges({ root }),
    /libs\/langgraph\/package\.json peerDependencies\["@angular\/core"\] expected "\^20\.0\.0 \|\| \^21\.0\.0 \|\| \^22\.0\.0" but found "\^20\.0\.0 \|\| \^21\.0\.0 \|\| \^22\.0\.0 \|\| \^23\.0\.0"/
  );
});

test('checks optional Angular peers', async (t) => {
  const root = await createFixture(t, async (fixtureRoot) => {
    await writeJson(join(fixtureRoot, 'libs/telemetry/package.json'), {
      peerDependencies: {
        '@angular/core': '^20.0.0 || ^21.0.0',
      },
      peerDependenciesMeta: {
        '@angular/core': {
          optional: true,
        },
      },
    });
  });

  await assert.rejects(
    verifyPeerRanges({ root }),
    /libs\/telemetry\/package\.json peerDependencies\["@angular\/core"\]/
  );
});

test('aggregates every incorrect Angular peer field in a manifest', async (t) => {
  const root = await createFixture(t, async (fixtureRoot) => {
    await writeJson(join(fixtureRoot, 'libs/chat/package.json'), {
      peerDependencies: {
        '@angular/core': '^20.0.0 || ^21.0.0',
        '@angular/common': '^20.0.0 || ^21.0.0 || ^22.0.0 || ^23.0.0',
      },
    });
  });

  await assert.rejects(verifyPeerRanges({ root }), (error) => {
    assert.match(
      error.message,
      /libs\/chat\/package\.json peerDependencies\["@angular\/core"\]/
    );
    assert.match(
      error.message,
      /libs\/chat\/package\.json peerDependencies\["@angular\/common"\]/
    );
    return true;
  });
});

test('aggregates peer errors and unreadable manifests', async (t) => {
  const root = await createFixture(t, async (fixtureRoot) => {
    await writeJson(join(fixtureRoot, 'libs/chat/package.json'), {
      peerDependencies: {
        '@angular/core': '^20.0.0 || ^21.0.0',
      },
    });
    await writeJson(join(fixtureRoot, 'libs/langgraph/package.json'), {
      peerDependencies: {
        '@angular/core': '^20.0.0 || ^21.0.0 || ^22.0.0 || ^23.0.0',
      },
    });
    await rm(join(fixtureRoot, 'libs/render/package.json'));
  });

  await assert.rejects(verifyPeerRanges({ root }), (error) => {
    assert.match(
      error.message,
      /libs\/chat\/package\.json peerDependencies\["@angular\/core"\]/
    );
    assert.match(
      error.message,
      /libs\/langgraph\/package\.json peerDependencies\["@angular\/core"\]/
    );
    assert.match(
      error.message,
      /libs\/render\/package\.json could not be read:/
    );
    return true;
  });
});
