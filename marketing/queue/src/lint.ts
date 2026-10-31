import type { Channel } from './types.ts';

export interface LintFlag {
  code: string;
  blocking: boolean;
  match: string;
}

// marketing/** may not import apps/** or libs/growth, so the pattern lists
// are copied here. Sources: docs/gtm/voice.md (hype words), docs/gtm/messaging.md
// ("Avoid"), and apps/website/src/lib/public-copy-contract.ts (BANNED_CLAIMS,
// RETIRED_POSITIONING). Update this file when those change.
const BANNED_PHRASES: readonly RegExp[] = [
  /blazing(?: fast)?/iu,
  /game[- ]changing/iu,
  /revolutionary/iu,
  /\b10x\b/iu,
  /The Threadplane for LangChain/iu,
  /Enterprise Angular agent framework/iu,
  /React of Angular agents/iu,
  /phon(?:e|ing) home/iu,
  /installation is inert/iu,
  /off by default/iu,
  /what we (?:won'|won’|will not )t? ?do/iu,
  /no telemetry is emitted/iu,
  /we (?:never|do not) collect/iu,
  /AI agent UI framework for Angular/iu,
  /Angular AI Agent UI Framework/iu,
  /Enterprise Angular Agent UI/iu,
  /Production-ready agent UI/iu,
  /thread plane for enterprise agents/iu,
];

// The only place in the repo that names these on purpose.
const COMPETITORS: readonly RegExp[] = [
  /(?<![\w-])CopilotKit(?![\w-])/iu,
  /(?<![\w-])assistant[- ]ui(?![\w-])/iu,
  /(?<![\w-])TanStack AI(?![\w-])/iu,
  /(?<![\w-])Vercel AI SDK(?![\w-])/iu,
];

const POLITICS: readonly RegExp[] = [
  'election',
  'president',
  'democrat',
  'republican',
  'congress',
  'senate',
  'trump',
  'biden',
  'abortion',
  'gun control',
  'immigration',
  'war in',
].map((word) => new RegExp(`\\b${word}\\b`, 'iu'));

const SOCIAL: readonly Channel[] = ['x', 'linkedin'];

function scan(
  text: string,
  patterns: readonly RegExp[],
  code: string,
  blocking: boolean,
  out: LintFlag[]
): void {
  for (const pattern of patterns) {
    const match = pattern.exec(text)?.[0];
    if (match && !out.some((f) => f.code === code && f.match === match)) {
      out.push({ code, blocking, match });
    }
  }
}

export function lintPublicCopy(text: string, channel: Channel): LintFlag[] {
  const flags: LintFlag[] = [];
  scan(text, COMPETITORS, 'competitor_name', true, flags);
  scan(text, POLITICS, 'politics', true, flags);
  scan(text, BANNED_PHRASES, 'banned_phrase', false, flags);
  if (SOCIAL.includes(channel)) {
    if (text.includes('—')) flags.push({ code: 'em_dash', blocking: false, match: '—' });
    const tags = text.match(/(?<![\w&/])#[A-Za-z]\w*/gu) ?? [];
    if (tags.length > 1) flags.push({ code: 'hashtags', blocking: false, match: tags.join(' ') });
  }
  return flags;
}
