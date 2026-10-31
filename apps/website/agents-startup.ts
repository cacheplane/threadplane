import type { PlaywrightTestConfig } from '@playwright/test';

type WebServer = Exclude<
  PlaywrightTestConfig['webServer'],
  unknown[] | undefined
>;

/** Each original smoke must still succeed before its own runtime starts. */
export function poolAgentServers(servers: WebServer[]): WebServer[] {
  const matches = servers.flatMap((server, index) => {
    const match =
      /^npx nx run cockpit-deep-agents-(planning|filesystem|subagents|skills|memory)-python:smoke && node scripts\/react-cockpit\/serve\.mjs deep-agents-\1 --no-parent$/.exec(
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
      'Agents startup requires the original contiguous five unique smoke/server chains'
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
