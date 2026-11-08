// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  CODING_AGENT_PROMPT,
  COMPONENT_SNIPPET,
  RENDER_SNIPPET,
  formatAngularRange,
  HERO_EYEBROW,
  HERO_H1,
  HERO_H1_LINES,
  HERO_PRIMARY_LABEL,
  HERO_SECONDARY_HREF,
  HERO_SECONDARY_LABEL,
  HERO_SUBHEAD,
  HERO_TRUST_LINE,
  HOME_DESCRIPTION,
  HOME_TITLE,
  INSTALL_OPTIONS,
} from './positioning';
import { WEBSITE_SUPPORTED_ANGULAR_MAJORS } from '../components/pricing/angular-support.mjs';
import { resolveWebsiteDir } from './website-dir';

const repoRoot = path.resolve(resolveWebsiteDir(), '..', '..');
const libsDir = path.join(repoRoot, 'libs');

function readPkg(dir: string): { name: string; license?: string; peerDependencies?: Record<string, string> } {
  return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
}

const workspacePkgs = fs
  .readdirSync(libsDir)
  .filter((d) => fs.existsSync(path.join(libsDir, d, 'package.json')))
  .map((d) => readPkg(path.join(libsDir, d)));

function parses(code: string): boolean {
  const sf = ts.createSourceFile('x.ts', code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  return (sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length === 0;
}

describe('positioning: hero copy', () => {
  it('names the exact category in eyebrow, H1, title and description', () => {
    expect(HERO_EYEBROW).toBe('LangGraph & AG-UI');
    expect(HERO_H1).toBe('The open source (and free) threadplane for agents');
    expect(HERO_SUBHEAD).toBe(
      'Make agent work persistent, durable, visible, reviewable, and resumable.',
    );
    expect(HOME_TITLE).toBe('Threadplane — The open-source threadplane for agents');
    expect(HOME_DESCRIPTION).toBe(
      'The open-source UI layer for agents: chat, durable threads, human approvals, and generative UI. Connect your app to LangGraph and AG-UI.',
    );
    expect(HOME_DESCRIPTION.length).toBeLessThanOrEqual(160);
  });

  it('H1 lines join back to HERO_H1 on the three lines the cards are laid out for', () => {
    expect(HERO_H1_LINES).toHaveLength(3);
    expect(HERO_H1_LINES.join(' ')).toBe(HERO_H1);
    // These fixed lines use a smaller card font than the responsive homepage.
    expect(HERO_H1_LINES).toEqual([
      'The open source',
      '(and free)',
      'threadplane for agents',
    ]);
  });

  it('pins the hero action labels and the secondary destination', () => {
    expect(HERO_PRIMARY_LABEL).toBe('Install Threadplane');
    expect(HERO_SECONDARY_LABEL).toBe('See it running in the docs →');
    expect(HERO_SECONDARY_HREF).toBe('/docs/angular/chat/guides/generative-ui?mode=run');
  });

  it('trust line license word matches the chat package manifest', () => {
    const chat = workspacePkgs.find((p) => p.name === '@threadplane/chat');
    expect(chat?.license).toBe('MIT');
    expect(HERO_TRUST_LINE).toContain(chat!.license!);
    expect(HERO_TRUST_LINE).toBe('MIT · Angular 20–22 · no account, no cloud');
  });
});

describe('positioning: install options', () => {
  it('has fake, langgraph and ag_ui variants in that order', () => {
    expect(INSTALL_OPTIONS.map((o) => o.key)).toEqual(['fake', 'langgraph', 'ag_ui']);
  });

  it('every @threadplane package in every command exists in libs/*', () => {
    const names = new Set(workspacePkgs.map((p) => p.name));
    for (const opt of INSTALL_OPTIONS) {
      const pkgs = opt.command.replace(/^npm install\s+/, '').split(/\s+/);
      for (const pkg of pkgs.filter((p) => p.startsWith('@threadplane/'))) {
        expect(names.has(pkg), `${opt.key}: ${pkg}`).toBe(true);
      }
    }
  });

  it('every peersNote starts with the same Angular range as the hero trust line', () => {
    const angularRange = formatAngularRange(WEBSITE_SUPPORTED_ANGULAR_MAJORS);
    expect(HERO_TRUST_LINE.startsWith(`MIT · ${angularRange}`)).toBe(true);
    for (const opt of INSTALL_OPTIONS) {
      expect(opt.peersNote.startsWith(angularRange), opt.key).toBe(true);
    }
  });

  it('every non-Threadplane package in a command is a declared peer of a Threadplane package in it', () => {
    for (const opt of INSTALL_OPTIONS) {
      const pkgs = opt.command.replace(/^npm install\s+/, '').split(/\s+/);
      const ours = pkgs.filter((p) => p.startsWith('@threadplane/'));
      const peers = new Set(
        ours.flatMap((n) => Object.keys(workspacePkgs.find((p) => p.name === n)?.peerDependencies ?? {})),
      );
      for (const pkg of pkgs.filter((p) => !p.startsWith('@threadplane/'))) {
        expect(peers.has(pkg), `${opt.key}: ${pkg} is not a peer of ${ours.join(', ')}`).toBe(true);
      }
    }
  });

  it('snippets parse as TypeScript', () => {
    expect(parses(COMPONENT_SNIPPET)).toBe(true);
    expect(parses(RENDER_SNIPPET)).toBe(true);
    for (const opt of INSTALL_OPTIONS) expect(parses(opt.providerSnippet), opt.key).toBe(true);
  });

  it('pins the fake-agent quickstart href the homepage CTAs link to', () => {
    expect(INSTALL_OPTIONS[0].quickstartHref).toBe('/docs/angular/chat/getting-started/try-without-a-backend');
  });

  it('quickstart hrefs point at docs routes', () => {
    for (const opt of INSTALL_OPTIONS) expect(opt.quickstartHref).toMatch(/^\/docs\//);
  });

  it('the try-without-a-backend page uses the fake install command verbatim', () => {
    const mdx = fs.readFileSync(
      path.join(resolveWebsiteDir(), 'content/docs/angular/chat/getting-started/try-without-a-backend.mdx'),
      'utf8',
    );
    expect(mdx).toContain(INSTALL_OPTIONS[0].command);
  });
});

describe('positioning: coding-agent prompt', () => {
  it('references the public agent context and the fake-agent path', () => {
    expect(CODING_AGENT_PROMPT).toContain('https://threadplane.ai/AGENTS.md');
    expect(CODING_AGENT_PROMPT).toContain('provideFakeAgent()');
    expect(CODING_AGENT_PROMPT).not.toMatch(/api[_ -]?key/i);
  });
});
