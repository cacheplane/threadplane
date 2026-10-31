import type { PlaywrightTestConfig } from '@playwright/test';

type WebServer = Exclude<
  PlaywrightTestConfig['webServer'],
  unknown[] | undefined
>;

/** Keep the original startup barriers around the contiguous Angular block. */
export function poolAngularServers(servers: WebServer[]): WebServer[] {
  const indices = servers.flatMap((server, index) =>
    /^npx nx run cockpit-[a-z0-9-]+-angular:serve:cockpit --port \d+$/.test(
      server.command
    )
      ? [index]
      : []
  );
  if (
    indices.length !== 9 ||
    indices.some((index, i) => index !== indices[0] + i)
  ) {
    throw new Error(
      'Angular startup requires the original contiguous nine dev servers'
    );
  }
  const angular = servers.slice(indices[0], indices[0] + indices.length);
  return [
    ...servers.slice(0, indices[0]),
    {
      command: 'exec node scripts/website-angular-startup.mjs',
      cwd: '../..',
      env: { WEBSITE_ANGULAR_SERVERS: JSON.stringify(angular) },
      wait: { stdout: /Website Angular servers ready/ },
      timeout: angular.reduce(
        (sum, server) => sum + (server.timeout ?? 60_000),
        0
      ),
      gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 },
    },
    ...servers.slice(indices[0] + indices.length),
  ];
}
