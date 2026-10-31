import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPool } from './website-angular-startup.mjs';

const topics = ['planning', 'filesystem', 'subagents', 'skills', 'memory'];
const repoRoot = fileURLToPath(new URL('../', import.meta.url)).replace(
  /\/$/,
  ''
);

/** Validate the complete original Playwright descriptors before launching any chain. */
export function parseAgentServers(value) {
  const invalid = () => {
    throw new Error('Invalid Agents server manifest');
  };
  let servers;
  try {
    servers = JSON.parse(value ?? 'null');
  } catch {
    invalid();
  }
  if (!Array.isArray(servers) || servers.length !== topics.length) invalid();
  const seen = new Set();
  return servers.map((server) => {
    if (
      !server ||
      typeof server !== 'object' ||
      typeof server.command !== 'string' ||
      Object.keys(server).some(
        (key) =>
          !['command', 'cwd', 'url', 'reuseExistingServer', 'timeout'].includes(
            key
          )
      )
    )
      invalid();
    const match =
      /^npx nx run cockpit-deep-agents-(planning|filesystem|subagents|skills|memory)-python:smoke && node scripts\/react-cockpit\/serve\.mjs deep-agents-\1 --no-parent$/.exec(
        server.command
      );
    if (!match) invalid();
    const topic = match[1];
    if (
      seen.has(topic) ||
      server.cwd !== '../..' ||
      server.url !== `http://127.0.0.1:${4628 + topics.indexOf(topic)}` ||
      server.reuseExistingServer !== false ||
      server.timeout !== 180000
    )
      invalid();
    seen.add(topic);
    return {
      command: 'sh',
      args: ['-c', server.command],
      cwd: repoRoot,
      url: server.url,
      timeout: server.timeout,
      name: topic,
    };
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await runPool(parseAgentServers(process.env.WEBSITE_AGENTS_SERVERS), {
      shutdownGraceMs: 1000,
      poolLabel: 'Agents pool',
      readyMessage: 'Website Agents servers ready',
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
