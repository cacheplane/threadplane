import { test, expect } from '@playwright/test';
import { submitAndWaitForResponse } from '@threadplane-internal/e2e-harness';

// Matches the welcome suggestion in skills.component.ts and the fixture in
// e2e/fixtures/da-skills.json.
const PROMPT = 'Can a mid-size jet operate out of KASE?';

test('da-skills: the index loads up front and only the matching skill is opened', async ({
  page,
}) => {
  const bubble = await submitAndWaitForResponse(page, PROMPT);

  // Both skills are in the index. That index is `skills_metadata`, which is
  // PrivateStateAttr and therefore absent from the `values` stream — it is here
  // only because the graph republishes it as a custom stream event.
  await expect(page.locator('[data-testid="skill"]')).toHaveCount(2);
  await expect(page.getByTestId('skills-source')).toHaveAttribute('data-source', 'live');
  await expect(page.locator('[data-testid="skill"][data-name="runway-analysis"]')).toContainText(
    /runway suitability/i,
  );

  // Progressive disclosure: the request matched runway-analysis, so the agent
  // read that skill's files and left weather-brief's body on disk. A demo that
  // pasted every skill into the prompt would open both, or neither.
  await expect(
    page.locator('[data-testid="skill"][data-name="runway-analysis"]'),
  ).toHaveAttribute('data-opened', 'true');
  await expect(
    page.locator('[data-testid="skill"][data-name="weather-brief"]'),
  ).toHaveAttribute('data-opened', 'false');

  // Two reads inside the matched skill: the SKILL.md, then the reference table
  // it points at. The second read is the part that does not happen unless the
  // agent is genuinely following the skill's procedure.
  const opened = page
    .locator('[data-testid="skill"][data-name="runway-analysis"]')
    .locator('[data-testid="skill-open"]');
  await expect(opened).toHaveCount(2);
  await expect(opened.nth(0)).toHaveText('/skills/runway-analysis/SKILL.md');
  await expect(opened.nth(1)).toHaveText('/skills/runway-analysis/reference/margins.md');

  // The answer used the margin table rather than a guess: 4,800 x (1 + 0.14 x
  // 7.82) rounds to 10,055 ft, which is longer than KASE's 8,006 ft runway.
  const finalText = await bubble.innerText();
  expect(finalText).toMatch(/10,?055/);
  expect(finalText.toLowerCase()).toContain('runway-analysis');
});
