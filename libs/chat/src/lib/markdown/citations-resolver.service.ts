// libs/chat/src/lib/markdown/citations-resolver.service.ts
import { Injectable, computed, signal, type Signal } from '@angular/core';
import type { CitationDefinition } from '@cacheplane/partial-markdown';
import type { Message } from '../agent/message';
import type { Citation } from '../agent/citation';
import type { ToolActivitySource } from '../primitives/chat-tool-activity/tool-outcome';

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
  /**
   * @internal True while this message has a Sources panel mounted. Tool activity inside the
   * message then hands its declared sources to the panel instead of repeating them as links.
   */
  readonly sourcesPanel = signal(false);
  private readonly toolSourceSets = signal<ReadonlyMap<object, readonly ToolActivitySource[]>>(new Map());
  /** @internal Sources declared by tool outcomes inside this message, in registration order. */
  readonly toolSources = computed<readonly ToolActivitySource[]>(() => [...this.toolSourceSets().values()].flat());

  /** @internal Replace the sources one tool-outcome view contributes; an empty list withdraws them. */
  setToolSources(owner: object, sources: readonly ToolActivitySource[]): void {
    const current = this.toolSourceSets().get(owner) ?? [];
    if (current.length === sources.length && current.every((source, i) => source.url === sources[i].url && source.title === sources[i].title)) return;
    const next = new Map(this.toolSourceSets());
    if (sources.length) next.set(owner, sources);
    else next.delete(owner);
    this.toolSourceSets.set(next);
  }

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
