// libs/chat/src/lib/markdown/citations-resolver.service.ts
import { Injectable, computed, signal, type Signal } from '@angular/core';
import type { CitationDefinition } from '@cacheplane/partial-markdown';
import type { Message } from '../agent/message';
import type { Citation } from '../agent/citation';

/** A citation resolved from message metadata or a markdown definition, with its source identified. */
export interface ResolvedCitation {
  source: 'message' | 'markdown';
  citation: Citation;
}

/** Resolves citation references reactively, preferring message metadata over markdown definitions. */
@Injectable()
export class CitationsResolverService {
  readonly message = signal<Message | null>(null);
  readonly markdownDefs = signal<Map<string, CitationDefinition>>(new Map());

  lookup(refId: string): Signal<ResolvedCitation | null> {
    return computed(() => {
      const fromMessage = this.message()?.citations?.find(c => c.id === refId);
      if (fromMessage) return { source: 'message', citation: fromMessage };
      const fromMd = this.markdownDefs().get(refId);
      if (fromMd) return { source: 'markdown', citation: mdDefToCitation(fromMd) };
      return null;
    });
  }
}

export function mdDefToCitation(def: CitationDefinition): Citation {
  let url: string | undefined;
  const titleParts: string[] = [];
  const snippetParts: string[] = [];
  let phase: 'before' | 'after' = 'before';
  for (const child of def.children) {
    if ((child.type === 'link' || child.type === 'autolink') && url === undefined) {
      url = (child as { url?: string }).url;
      phase = 'after';
      continue;
    }
    const t = inlineToText(child);
    (phase === 'before' ? titleParts : snippetParts).push(t);
  }
  const title = titleParts.join('').trim() || undefined;
  const snippet = snippetParts.join('').trim() || undefined;
  return { id: def.id, index: def.index, title, url, snippet };
}

function inlineToText(node: unknown): string {
  const n = node as { type: string; text?: string; children?: unknown[]; url?: string };
  if (typeof n.text === 'string') return n.text;
  if (n.type === 'autolink' && typeof n.url === 'string') return n.url;
  if (Array.isArray(n.children)) return n.children.map(inlineToText).join('');
  return '';
}
