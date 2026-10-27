import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserHistory, selectedThread, threadUrl } from './route.js';

test('route reads only the thread query and preserves unrelated query and hash', () => {
  const url =
    'https://example.test/chat?theme=dark&thread=a%2Fb%3Fc%23d#bottom';
  assert.equal(selectedThread(url), 'a/b?c#d');
  assert.equal(
    selectedThread('https://example.test/chat?theme=dark#bottom'),
    null
  );
  assert.equal(selectedThread('https://example.test/chat?thread='), null);
  assert.equal(
    threadUrl(url, 'b'),
    'https://example.test/chat?theme=dark&thread=b#bottom'
  );
  assert.equal(
    threadUrl(url, null),
    'https://example.test/chat?theme=dark#bottom'
  );
});

test('route browser boundary is inert until its explicit methods are called', () => {
  let reads = 0;
  const pushes: unknown[][] = [];
  const listeners = new Set<() => void>();
  const target = {
    get location() {
      reads++;
      return { href: 'https://example.test/?thread=a' };
    },
    history: { pushState: (...args: unknown[]) => pushes.push(args) },
    addEventListener: (name: string, listener: () => void) => {
      assert.equal(name, 'popstate');
      listeners.add(listener);
    },
    removeEventListener: (name: string, listener: () => void) => {
      assert.equal(name, 'popstate');
      listeners.delete(listener);
    },
  } as unknown as Window;
  const history = browserHistory(target);
  assert.equal(reads, 0);
  assert.equal(history.currentUrl(), 'https://example.test/?thread=a');
  let events = 0;
  const release = history.subscribe(() => events++);
  for (const listener of listeners) listener();
  release();
  assert.equal(events, 1);
  assert.equal(listeners.size, 0);
  history.push('https://example.test/?thread=b');
  assert.deepEqual(pushes, [[null, '', 'https://example.test/?thread=b']]);
});
