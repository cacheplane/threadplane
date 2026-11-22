import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { createPartialArgsBridge } from './partial-args-bridge';
import { createA2uiSurfaceStore } from './surface-store';

const parsed = vi.hoisted(() => ({ bytes: 0 }));
vi.mock('@cacheplane/partial-json', async (importOriginal) => {
  const original = await importOriginal<typeof import('@cacheplane/partial-json')>();
  return {
    ...original,
    createPartialJsonParser: (...args: Parameters<typeof original.createPartialJsonParser>) => {
      const parser = original.createPartialJsonParser(...args);
      const push = parser.push.bind(parser);
      parser.push = (text: string) => {
        parsed.bytes += text.length;
        return push(text);
      };
      return parser;
    },
  };
});

describe('partial argument parsing work', () => {
  it('parses each streamed character once, including duplicate cumulative updates', () => {
    TestBed.configureTestingModule({});
    const store = TestBed.runInInjectionContext(() => createA2uiSurfaceStore());
    const bridge = createPartialArgsBridge(store);
    const args = JSON.stringify({ envelopes: [
      { version: 'v0.9', createSurface: { surfaceId: 'report', catalogId: 'basic' } },
      { version: 'v0.9', updateComponents: { surfaceId: 'report', components: [{ id: 'root', component: 'Text', text: 'Cleanup complete' }] } },
    ] });
    parsed.bytes = 0;
    for (let end = 1; end <= args.length; end++) {
      bridge.push('research-report', args.slice(0, end));
      bridge.push('research-report', args.slice(0, end));
    }
    expect(parsed.bytes).toBe(args.length);
    expect(store.surfaces().get('report')?.components.has('root')).toBe(true);
    expect(bridge.isPoisoned('research-report')).toBe(false);
  });
});
