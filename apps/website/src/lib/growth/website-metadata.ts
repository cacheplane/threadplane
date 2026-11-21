export type WebsiteTopic =
  | 'getting_started'
  | 'architecture'
  | 'comparison'
  | 'pricing'
  | 'security'
  | 'deployment'
  | 'other';
export type WebsiteContent = { contentId: string; topic: WebsiteTopic };
export type WebsiteCatalog = Readonly<Record<string, WebsiteContent>>;
export function contentForPath(
  pathname: string,
  catalog: WebsiteCatalog
): WebsiteContent | null {
  return Object.hasOwn(catalog, pathname) ? catalog[pathname] : null;
}
export function acquisitionProperties(
  search: string,
  referrer: string
): Record<string, string> {
  const properties: Record<string, string> = {};
  const params = new URLSearchParams(search.slice(0, 4096));
  for (const [parameter, key] of [
    ['utm_source', 'campaignSource'],
    ['utm_medium', 'campaignMedium'],
    ['utm_campaign', 'campaignName'],
  ]) {
    const token = params.get(parameter)?.trim().toLowerCase();
    if (token && /^[a-z0-9][a-z0-9_-]{0,119}$/u.test(token))
      properties[key] = token;
  }
  try {
    const url = new URL(referrer);
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      url.hostname.length <= 253 &&
      /^[a-z0-9.-]+$/u.test(url.hostname)
    )
      properties.referrerHost = url.hostname;
  } catch {
    /* An absent or invalid referrer contributes no evidence. */
  }
  return properties;
}
// `@threadplane/chat` and `@threadplane/render` moved into `@threadplane/angular`;
// older pages and posts still show install commands that name them.
const PACKAGES = [
  '@threadplane/angular',
  '@threadplane/chat',
  '@threadplane/langgraph',
  '@threadplane/ag-ui',
  '@threadplane/render',
];
export function installedPackages(command: string): string[] {
  if (
    command.length > 4096 ||
    !/^\s*(?:npm\s+(?:install|i)|(?:pnpm|yarn|bun)\s+add)\s/u.test(command)
  )
    return [];
  const tokens = command.trim().split(/\s+/u).slice(2);
  return PACKAGES.filter((name) =>
    tokens.some((token) => token === name || token.startsWith(name + '@'))
  );
}
