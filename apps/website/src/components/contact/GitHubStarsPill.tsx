import React from 'react';
import { Pill } from '../ui/Pill';
import { getGitHubStars } from '../../lib/github';

const REPO = 'cacheplane/threadplane';
const REPO_URL = `https://github.com/${REPO}`;

export async function GitHubStarsPill() {
  const stars = await getGitHubStars(REPO);
  const label = stars != null ? `★ ${stars.toLocaleString()} on GitHub` : 'GitHub';
  return (
    <a
      href={REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="gh-stars-pill-link"
    >
      <Pill variant="neutral">{label}</Pill>
    </a>
  );
}
