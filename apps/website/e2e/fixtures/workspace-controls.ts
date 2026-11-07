import { expect, type Page } from '@playwright/test';

/** Framework narrative routes expose the same mode toolbar at every viewport. */
export const documentationModes = (page: Page) =>
  page.getByRole('navigation', { name: 'Documentation modes', exact: true });

export async function selectWorkspaceMode(
  page: Page,
  mode: 'Docs' | 'Run' | 'Code' | 'API'
) {
  await documentationModes(page)
    .getByRole('button', {
      name: mode === 'Run' ? /^Run(?:,|$)/ : mode,
      exact: mode !== 'Run',
    })
    .click();
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
    'data-workspace-mode',
    mode
  );
}

export async function openWorkspaceTool(
  page: Page,
  tool: 'Activity' | 'Settings'
) {
  await page.getByRole('button', { name: 'Workspace tools', exact: true }).click();
  await page.getByRole('menuitem', {
    name: tool === 'Activity' ? /^Activity\b/ : tool,
    exact: tool !== 'Activity',
  }).click();
}
