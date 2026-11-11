import { test, expect } from '@playwright/test';
import { submitAndWaitForResponse } from '@threadplane-internal/e2e-harness';

// First proof outside unit tests that the neutral Agent contract's interrupt
// path works against a genuinely non-LangGraph AG-UI backend: the Microsoft
// Agent Framework bridge signals interrupts via the protocol-standard
// RUN_FINISHED outcome (never CUSTOM on_interrupt), and resume goes out as
// the top-level `resume` entry array.
test.describe('cockpit runtimes/microsoft-agent-framework: expense approval', () => {
  test('approval card displays the pending submit_expense call', async ({ page }) => {
    await page.goto('/');
    await page.getByText('File a team dinner expense').click();
    const panel = page.locator('.chat-approval-card--inline');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel).toContainText('Expense approval required');
    await expect(panel).toContainText('Blue Finch Bistro');
    await expect(panel).toContainText('meals');
  });

  test('shared state panel mirrors the drafted expense', async ({ page }) => {
    await page.goto('/');
    await page.getByText('File a team dinner expense').click();
    const panel = page.getByTestId('expense-state');
    await expect(panel).toContainText('Blue Finch Bistro', { timeout: 30_000 });
    await expect(panel).toContainText('$220.00');
  });

  test('Approve resumes the run and the expense is submitted', async ({ page }) => {
    await page.goto('/');
    await page.getByText('File a team dinner expense').click();
    const panel = page.locator('.chat-approval-card--inline');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await panel.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText(/has been submitted for reimbursement/i)).toBeVisible({ timeout: 30_000 });
  });
});

// Delegation over the same non-LangGraph bridge: the orchestrator's
// `research_policy` tool streams the tool-less `policy_researcher`
// specialist, and the queue-merge emitter (src/subagent_emitter.py)
// translates its deltas into SUBAGENT_STARTED / attributed TEXT_MESSAGE_* /
// SUBAGENT_FINISHED wire events. The @threadplane/ag-ui reducer keys the
// subagent to its spawning toolCallId, so <chat-tool-calls> renders the
// delegation inline as a <chat-subagent-card> instead of a tool-call chip.
test.describe('cockpit runtimes/microsoft-agent-framework: subagent delegation', () => {
  test('rt-maf: delegated policy research renders a streaming subagent card', async ({ page }) => {
    const bubble = await submitAndWaitForResponse(
      page,
      'Should I submit a $900 conference travel expense? Research the policy first',
    );
    await expect(page.locator('chat-subagent-card')).toHaveCount(1);
    await expect(page.locator('chat-subagent-card')).toContainText('policy_researcher');
    await expect(bubble).toContainText(/policy|expense/i);
  });
});
