// libs/angular/chat/src/lib/markdown/citations-resolver.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { CitationsResolverService } from './citations-resolver.service';
import { staticDelivery, type Message } from '../agent';
import type { CitationDefinition } from '@cacheplane/partial-markdown';

describe('CitationsResolverService', () => {
  let svc: CitationsResolverService;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [CitationsResolverService] });
    svc = TestBed.inject(CitationsResolverService);
  });

  it('returns null when no source matches', () => {
    expect(svc.lookup('missing')()).toBeNull();
  });

  it('resolves from Message.citations first', () => {
    const msg: Message = {
      id: 'm1', role: 'assistant', content: 'x', delivery: staticDelivery('m1'),
      citations: [{ id: 'src1', index: 1, title: 'From message', url: 'https://m.example' }],
    };
    svc.message.set(msg);
    const result = svc.lookup('src1')();
    expect(result?.source).toBe('message');
    expect(result?.citation.title).toBe('From message');
  });

  it('falls back to markdown sidecar', () => {
    const def: CitationDefinition = {
      id: 'src1', index: 1, status: 'complete',
      children: [
        { id: 1, type: 'text', status: 'complete', parent: null, index: 0, text: 'Title ' } as any,
        { id: 2, type: 'autolink', status: 'complete', parent: null, index: 1, url: 'https://md.example', text: 'https://md.example' } as any,
        { id: 3, type: 'text', status: 'complete', parent: null, index: 2, text: ' the rest' } as any,
      ],
    };
    svc.markdownDefs.set(new Map([['src1', def]]));
    const result = svc.lookup('src1')();
    expect(result?.source).toBe('markdown');
    expect(result?.citation.title).toBe('Title');
    expect(result?.citation.url).toBe('https://md.example');
    expect(result?.citation.snippet).toBe('the rest');
  });

  it('Message.citations precedence over markdown sidecar', () => {
    const msg: Message = {
      id: 'm1', role: 'assistant', content: 'x', delivery: staticDelivery('m1'),
      citations: [{ id: 'src1', index: 1, title: 'From message' }],
    };
    const def: CitationDefinition = {
      id: 'src1', index: 1, status: 'complete',
      children: [{ id: 1, type: 'text', status: 'complete', parent: null, index: 0, text: 'From md' } as any],
    };
    svc.message.set(msg);
    svc.markdownDefs.set(new Map([['src1', def]]));
    expect(svc.lookup('src1')()?.source).toBe('message');
  });

  it('reactive — updates flow through signal', () => {
    const lookup = svc.lookup('src1');
    expect(lookup()).toBeNull();
    svc.message.set({
      id: 'm1', role: 'assistant', content: 'x', delivery: staticDelivery('m1'),
      citations: [{ id: 'src1', index: 1, title: 'A' }],
    });
    expect(lookup()?.citation.title).toBe('A');
  });
});
