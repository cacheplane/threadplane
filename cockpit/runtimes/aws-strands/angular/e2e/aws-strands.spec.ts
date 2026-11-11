import { test, expect } from '@playwright/test';
import { submitAndWaitForResponse } from '@threadplane-internal/e2e-harness';

// Second proof outside unit tests that the neutral Agent contract's
// interrupt path works against a genuinely non-LangGraph AG-UI backend: the
// AWS Strands bridge signals interrupts via the protocol-standard
// RUN_FINISHED outcome (never CUSTOM on_interrupt), and resume goes out as
// the top-level `resume` entry array keyed by interruptId.
test.describe('cockpit runtimes/aws-strands: meeting booking approval', () => {
  test('approval card displays the pending book_meeting call', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Book the Q3 roadmap review').click();
    const panel = page.locator('.chat-approval-card--inline');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel).toContainText('Booking approval required');
    await expect(panel).toContainText('Q3 roadmap review');
    await expect(panel).toContainText('Tuesday 10:00');
  });

  test('shared state panel snapshots availability and the pending booking', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Book the Q3 roadmap review').click();
    const panel = page.getByTestId('schedule-state');
    // From check_availability's state_from_result snapshot.
    await expect(panel).toContainText('Tuesday', { timeout: 30_000 });
    await expect(panel).toContainText('10:00');
    // From book_meeting's state_from_args snapshot (fires before the interrupt).
    await expect(panel.getByTestId('booking-state')).toContainText('pending', { timeout: 30_000 });
  });

  test('Approve resumes the run and the meeting is booked', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Book the Q3 roadmap review').click();
    const panel = page.locator('.chat-approval-card--inline');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await panel.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText(/is booked for Tuesday 10:00/i)).toBeVisible({ timeout: 30_000 });
  });
});

// Delegation over the same non-LangGraph bridge: the orchestrator's
// `research_availability` async-generator tool re-yields the specialist's
// stream, and the per-tool ToolBehavior handler (src/subagent_emitter.py)
// translates it into SUBAGENT_STARTED / attributed TEXT_MESSAGE_* /
// SUBAGENT_FINISHED wire events. The @threadplane/ag-ui reducer keys the
// subagent to its spawning toolCallId, so <chat-tool-calls> renders the
// delegation inline as a <chat-subagent-card> instead of a tool-call chip.
test.describe('cockpit runtimes/aws-strands: subagent delegation', () => {
  test('rt-strands: delegated availability research renders a streaming subagent card', async ({ page }) => {
    const bubble = await submitAndWaitForResponse(
      page,
      'Find a slot for Ada and Grace next week — research their availability first',
    );
    await expect(page.locator('chat-subagent-card')).toHaveCount(1);
    await expect(page.locator('chat-subagent-card')).toContainText('availability_researcher');
    await expect(bubble).toContainText(/slot|available/i);
  });
});
