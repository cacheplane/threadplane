#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ANGULAR_PEER_RANGE,
  SUPPORTED_ANGULAR_MAJORS,
} from '../examples/chat/smoke/angular-versions.mjs';
import { WEBSITE_SUPPORTED_ANGULAR_MAJORS } from '../apps/website/src/components/pricing/angular-support.mjs';

export { ANGULAR_PEER_RANGE };

export const ANGULAR_MANIFESTS = [
  'libs/chat/package.json',
  'libs/langgraph/package.json',
  'libs/ag-ui/package.json',
  'libs/render/package.json',
  'libs/telemetry/package.json',
  'libs/cockpit-telemetry/package.json',
  'libs/example-layouts/package.json',
];

export const ANGULAR_SUPPORT_README_BLOCKS = [
  { path: 'README.md', marker: '**Peer dependencies:**' },
  { path: 'libs/chat/README.md', marker: '**Peer dependencies:**' },
  { path: 'libs/langgraph/README.md', marker: '**Peer dependencies:**' },
  { path: 'libs/ag-ui/README.md', marker: '**Peer dependencies:**' },
  { path: 'libs/render/README.md', marker: '**Peer dependencies:**' },
  {
    path: 'libs/telemetry/README.md',
    marker: 'Both peer dependencies are optional:',
  },
];

export const ANGULAR_SUPPORT_READMES = ANGULAR_SUPPORT_README_BLOCKS.map(
  ({ path }) => path
);

export const ANGULAR_SUPPORT_INSTALLATION_PAGES = [
  'apps/website/content/docs/angular/chat/getting-started/installation.mdx',
  'apps/website/content/docs/angular/langgraph/getting-started/installation.mdx',
  'apps/website/content/docs/angular/ag-ui/getting-started/installation.mdx',
  'apps/website/content/docs/angular/render/getting-started/installation.mdx',
];

function formatAngularMajorList(majors) {
  if (majors.length === 1) {
    return String(majors[0]);
  }

  if (majors.length === 2) {
    return `${majors[0]} and ${majors[1]}`;
  }

  return `${majors.slice(0, -1).join(', ')}, and ${majors.at(-1)}`;
}

export const ANGULAR_SUPPORT_BADGE_MESSAGE =
  SUPPORTED_ANGULAR_MAJORS.join(' | ');
export const ANGULAR_SUPPORT_BADGE_TEXT = `Angular ${ANGULAR_SUPPORT_BADGE_MESSAGE}`;
export const ANGULAR_SUPPORT_BADGE_URL_MESSAGE = encodeURIComponent(
  ANGULAR_SUPPORT_BADGE_MESSAGE
);
export const ACTIVE_INSTALLATION_SUPPORT_STATEMENT = `Supported Angular majors: ${formatAngularMajorList(
  SUPPORTED_ANGULAR_MAJORS
)}.`;
export const ACTIVE_INSTALLATION_NODE_GUIDANCE =
  'Use a Node.js version supported by the selected Angular major. Angular 22 supports Node.js ^22.22.3, ^24.15.0, or ^26.0.0. See the [Angular compatibility matrix](https://angular.dev/reference/versions).';
const STALE_ANGULAR_PEER_RANGE = '^20.0.0 || ^21.0.0';
const STALE_ANGULAR_PEER_RANGE_PATTERN =
  /\^20\.0\.0\s*\|\|\s*\^21\.0\.0(?!\s*\|\|\s*\^22\.0\.0)/;

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readText(path) {
  return readFile(path, 'utf8');
}

function getActivePeerDependencyBlock(contents, marker) {
  const markerIndex = contents.indexOf(marker);

  if (markerIndex === -1) {
    return undefined;
  }

  const afterMarker = contents.slice(markerIndex + marker.length);
  const firstLine = afterMarker.slice(
    0,
    afterMarker.indexOf('\n') === -1 ? undefined : afterMarker.indexOf('\n')
  );

  if (firstLine.trim()) {
    return firstLine;
  }

  const openingFenceIndex = afterMarker.indexOf('```');
  if (openingFenceIndex === -1) {
    return undefined;
  }

  const blockStart = afterMarker.indexOf('\n', openingFenceIndex) + 1;
  const closingFenceIndex = afterMarker.indexOf('```', blockStart);

  return closingFenceIndex === -1
    ? undefined
    : afterMarker.slice(blockStart, closingFenceIndex);
}

function getAngularSupportBadgeTag(contents) {
  return [...contents.matchAll(/<img\b[^>]*>/g)].find((tag) =>
    tag[0].includes(`alt="${ANGULAR_SUPPORT_BADGE_TEXT}"`)
  )?.[0];
}

export async function verifyPeerRanges({ root = process.cwd() } = {}) {
  const errors = [];

  for (const manifest of ANGULAR_MANIFESTS) {
    const manifestPath = join(root, manifest);
    let packageJson;

    try {
      packageJson = await readJson(manifestPath);
    } catch (error) {
      errors.push(
        `${relative(root, manifestPath)} could not be read: ${error.message}`
      );
      continue;
    }

    const angularPeers = Object.entries(
      packageJson.peerDependencies ?? {}
    ).filter(([name]) => name.startsWith('@angular/'));

    if (angularPeers.length === 0) {
      errors.push(
        `${manifest} must declare at least one @angular/ peer dependency.`
      );
      continue;
    }

    for (const [name, range] of angularPeers) {
      if (range !== ANGULAR_PEER_RANGE) {
        errors.push(
          `${manifest} peerDependencies["${name}"] expected "${ANGULAR_PEER_RANGE}" but found "${range}".`
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }
}

export async function verifyDocumentation({ root = process.cwd() } = {}) {
  const errors = [];

  for (const { marker, path: readme } of ANGULAR_SUPPORT_README_BLOCKS) {
    const readmePath = join(root, readme);
    let contents;

    try {
      contents = await readText(readmePath);
    } catch (error) {
      errors.push(
        `${relative(root, readmePath)} could not be read: ${error.message}`
      );
      continue;
    }

    const angularSupportBadgeTag = getAngularSupportBadgeTag(contents);

    if (!angularSupportBadgeTag) {
      errors.push(
        `${readme} must contain the Angular support badge text "${ANGULAR_SUPPORT_BADGE_TEXT}".`
      );
    } else if (
      !angularSupportBadgeTag.includes(
        `src="https://img.shields.io/badge/Angular-${ANGULAR_SUPPORT_BADGE_URL_MESSAGE}-`
      )
    ) {
      errors.push(
        `${readme} Angular support badge must encode the message "${ANGULAR_SUPPORT_BADGE_URL_MESSAGE}" in the same <img> tag.`
      );
    }

    const activePeerDependencyBlock = getActivePeerDependencyBlock(
      contents,
      marker
    );

    if (
      !activePeerDependencyBlock
        ?.replaceAll('\\|', '|')
        .includes(ANGULAR_PEER_RANGE)
    ) {
      errors.push(
        `${readme} active peer-dependency block must include the Angular peer range "${ANGULAR_PEER_RANGE}".`
      );
    }
  }

  for (const page of ANGULAR_SUPPORT_INSTALLATION_PAGES) {
    const pagePath = join(root, page);
    let contents;

    try {
      contents = await readText(pagePath);
    } catch (error) {
      errors.push(
        `${relative(root, pagePath)} could not be read: ${error.message}`
      );
      continue;
    }

    const normalizedContents = contents.replaceAll('\\|', '|');

    if (!normalizedContents.includes(ACTIVE_INSTALLATION_SUPPORT_STATEMENT)) {
      errors.push(
        `${page} must contain "${ACTIVE_INSTALLATION_SUPPORT_STATEMENT}".`
      );
    }

    if (!normalizedContents.includes(ACTIVE_INSTALLATION_NODE_GUIDANCE)) {
      errors.push(
        `${page} must contain "${ACTIVE_INSTALLATION_NODE_GUIDANCE}".`
      );
    }

    if (STALE_ANGULAR_PEER_RANGE_PATTERN.test(normalizedContents)) {
      errors.push(
        `${page} must not retain the stale Angular peer range "${STALE_ANGULAR_PEER_RANGE}".`
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }
}

/**
 * The pricing page's Angular compatibility matrix and support summary were
 * removed in #908, taking WEBSITE_ANGULAR_SUPPORT_ROWS and
 * WEBSITE_PRICING_SUPPORT_SUMMARY with them. The row/summary assertions that
 * used to live here verified copy that no longer renders anywhere, so they are
 * gone too. WEBSITE_SUPPORTED_ANGULAR_MAJORS still backs live page content and
 * is still checked against the registry.
 */
export async function verifyWebsiteMajors({
  websiteSupportedAngularMajors = WEBSITE_SUPPORTED_ANGULAR_MAJORS,
} = {}) {
  const errors = [];
  const expectedMajors = SUPPORTED_ANGULAR_MAJORS.join(', ');
  const actualMajors = websiteSupportedAngularMajors.join(', ');

  if (
    websiteSupportedAngularMajors.length !== SUPPORTED_ANGULAR_MAJORS.length ||
    websiteSupportedAngularMajors.some(
      (major, index) => major !== SUPPORTED_ANGULAR_MAJORS[index]
    )
  ) {
    errors.push(
      `website supported Angular majors expected "${expectedMajors}" but found "${actualMajors}".`
    );
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  try {
    await verifyPeerRanges();
    await verifyDocumentation();
    await verifyWebsiteMajors();
    console.log(
      `Angular support metadata verified: ${SUPPORTED_ANGULAR_MAJORS.join(
        ', '
      )}`
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
