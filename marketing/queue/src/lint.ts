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
  // Words and openers that read as machine-written, not as Brian.
  ...[
    'delv(?:e|es|ed|ing)',
    'leverag(?:e|es|ed|ing)',
    'seamless(?:ly)?',
    'robust',
    'unlock(?:s|ed|ing)?',
    'elevat(?:e|es|ed|ing)',
    'landscape',
    'supercharg(?:e|es|ed|ing)',
    'the future of',
    "in today's",
    "here's the thing",
    'let that sink in',
    "it's not just",
    "i'm thrilled to announce",
  ].map((phrase) => new RegExp(`(?<![\\p{L}\\p{N}_])${phrase.replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}_])`, 'iu')),
];

// "not X but Y". A comma before "but" is ordinary speech ("not sure, but it
// works"), so only the uncommaed form, or "not just/only X, but", counts.
const CADENCE: readonly RegExp[] = [
  /\bnot\s+(?:just|only)\s+[^.!?\n]{1,60}?,?\s+but\b/iu,
  /\bnot\s+[^.!?\n,;]{1,40}?\s+but\b/iu,
];

// A joined sequence (family, skin tone, flags) counts as one emoji.
const EMOJI =
  /\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})*(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})*)*/gu;

/** Left by the drafter for a fact only Brian can supply. Never confirmable. */
export const BRIAN_MARKER_CODE = 'brian_marker';

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

export function lintPublicCopy(raw: string, channel: Channel): LintFlag[] {
  // Curly apostrophes match the straight ones in the phrase lists.
  const text = raw.replace(/[‘’]/gu, "'");
  const flags: LintFlag[] = [];
  const marker = /\[BRIAN:[^\]]*\]?/u.exec(text)?.[0];
  if (marker) flags.push({ code: BRIAN_MARKER_CODE, blocking: true, match: marker });
  scan(text, COMPETITORS, 'competitor_name', true, flags);
  scan(text, POLITICS, 'politics', true, flags);
  scan(text, BANNED_PHRASES, 'banned_phrase', false, flags);
  scan(text, CADENCE, 'cadence', false, flags);
  if (SOCIAL.includes(channel)) {
    if (text.includes('—')) flags.push({ code: 'em_dash', blocking: false, match: '—' });
    const tags = text.match(/(?<![\w&/])#[A-Za-z]\w*/gu) ?? [];
    if (tags.length > 1) flags.push({ code: 'hashtags', blocking: false, match: tags.join(' ') });
    const emoji = text.match(EMOJI) ?? [];
    if (emoji.length > 1) flags.push({ code: 'emoji', blocking: false, match: emoji.join(' ') });
  }
  return flags;
}
