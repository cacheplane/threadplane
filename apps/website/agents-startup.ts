import type { PlaywrightTestConfig } from '@playwright/test';

type WebServer = Exclude<
  PlaywrightTestConfig['webServer'],
  unknown[] | undefined
>;

/** The five Deep Agents preview servers start as one pool with one readiness budget. */
export function poolAgentServers(servers: WebServer[]): WebServer[] {
  const matches = servers.flatMap((server, index) => {
    const match =
      /^node scripts\/react-cockpit\/serve\.mjs deep-agents-(planning|filesystem|subagents|skills|memory) --no-parent --backend$/.exec(
        server.command
      );
    return match ? [{ index, topic: match[1] }] : [];
  });
  if (
    matches.length !== 5 ||
    new Set(matches.map((m) => m.topic)).size !== 5 ||
    matches.some((match, i) => match.index !== matches[0].index + i)
  ) {
    throw new Error(
      'Agents startup requires the original contiguous five unique preview servers'
    );
  }
  const first = matches[0].index;
  const agents = servers.slice(first, first + matches.length);
  return [
    ...servers.slice(0, first),
    {
      command: 'exec node scripts/website-agents-startup.mjs',
      cwd: '../..',
      env: { WEBSITE_AGENTS_SERVERS: JSON.stringify(agents) },
      wait: { stdout: /Website Agents servers ready/ },
      timeout: agents.reduce(
        (sum, server) => sum + (server.timeout ?? 60_000),
        0
      ),
      gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 },
    },
    ...servers.slice(first + matches.length),
  ];
}
