'use strict';
const { join } = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const https = require('node:https');
const { disabled, packageManager, environment } = require('./policy.cjs');
const { readBounded } = require('./files.cjs');
const { installationIdentity } = require('./identity.cjs');
const { discoverGit } = require('./git-context.cjs');
const { writeBridge } = require('./bridge.cjs');
const ENDPOINT = 'https://threadplane.ai/api/growth/collect/v1/install';
const PACKAGES = new Set([
  '@threadplane/angular',
  '@threadplane/langgraph',
  '@threadplane/ag-ui',
]);
function sendBatch(batch, { timeoutMs = 2500 } = {}) {
  return new Promise((resolve) => {
    let request, timer;
    const finish = () => {
      clearTimeout(timer);
      resolve();
    };
    try {
      const body = JSON.stringify(batch);
      request = https.request(
        ENDPOINT,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
          },
          agent: false,
        },
        (response) => {
          // No redirect following, response identity, or remote configuration.
          response.destroy();
          request.destroy();
          finish();
        }
      );
      request.on('error', finish);
      timer = setTimeout(() => {
        request.destroy();
        finish();
      }, Math.max(1, timeoutMs));
      request.end(body);
    } catch {
      request?.destroy();
      finish();
    }
  });
}
async function collectInstall({
  packageRoot,
  env = process.env,
  getHome = () => os.homedir(),
  readPackage = async (root) =>
    JSON.parse(await readBounded(join(root, 'package.json'))),
  identify = installationIdentity,
  discover = discoverGit,
  send = sendBatch,
  interactive = Boolean(process.stdin.isTTY || process.stdout.isTTY),
  deadline = Date.now() + 4500,
}) {
  try {
    // Clear copied/reinstalled state even when collection is disabled. If the
    // package is read-only, an old token may remain; never register it anew.
    const bridgeReset = await writeBridge(packageRoot, null);
    if (disabled(env) || Date.now() >= deadline) return;
    const pkg = await readPackage(packageRoot);
    if (
      !pkg ||
      !PACKAGES.has(pkg.name) ||
      typeof pkg.version !== 'string' ||
      !/^[0-9][a-zA-Z0-9.+-]{0,63}$/.test(pkg.version)
    )
      return;
    const home = getHome();
    const subject = await identify(home);
    const context = await discover({ home, packageRoot, env });
    if (Date.now() >= deadline) return;
    const manager = packageManager(env.npm_config_user_agent);
    const installEnvironment = environment(
      env,
      interactive,
      manager.packageManager
    );
    let installationToken;
    if (bridgeReset && installEnvironment.environment !== 'ci') {
      const candidate = randomUUID();
      if (await writeBridge(packageRoot, candidate))
        installationToken = candidate;
    }
    if (Date.now() >= deadline) return;
    const event = {
      eventId: randomUUID(),
      kind: 'package.installed',
      occurredAt: new Date().toISOString(),
      collectorVersion: 'install-v1',
      subject: { ...subject, namespace: 'installation' },
      ...(installationToken ? { installationToken } : {}),
      properties: {
        packageName: pkg.name,
        packageVersion: pkg.version,
        osFamily: os.platform(),
        architecture: os.arch(),
        nodeVersion: process.versions.node,
        ...manager,
        ...installEnvironment,
        consumerContext: context.consumerContext,
      },
    };
    if (Object.keys(context.identity).length) event.identity = context.identity;
    await send(
      { schemaVersion: 1, events: [event] },
      { timeoutMs: Math.min(2500, deadline - Date.now()) }
    );
  } catch {
    /* Neither discovery nor transport may fail an installation. */
  }
}
module.exports = { collectInstall, sendBatch };
