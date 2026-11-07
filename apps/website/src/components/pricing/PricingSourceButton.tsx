'use client';

import { Button } from '../ui/Button';
import { GitHubIcon } from '../ui/GitHubIcon';
import { GITHUB_REPO_URL } from '../../lib/positioning';
import { trackCtaClick } from '../../lib/analytics/client';

export function PricingSourceButton() {
  return (
    <Button
      href={GITHUB_REPO_URL}
      variant="primary"
      size="lg"
      target="_blank"
      rel="noopener noreferrer"
      leadingIcon={<GitHubIcon />}
      onClick={() =>
        trackCtaClick({
          surface: 'pricing',
          cta_id: 'pricing_tier_community',
          destination_url: GITHUB_REPO_URL,
          cta_text: 'Take the code',
        })
      }
    >
      Take the code
    </Button>
  );
}
