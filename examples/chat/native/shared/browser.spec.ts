import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindBrowserLifetime } from './browser.js';

test('browser lifetime preserves cached documents and disposes finally once', () => {
  const target = new EventTarget();
  let disposals = 0;
  const release = bindBrowserLifetime({ dispose: () => disposals++ }, target);
  target.dispatchEvent(
    Object.assign(new Event('pagehide'), { persisted: true })
  );
  target.dispatchEvent(
    Object.assign(new Event('pageshow'), { persisted: true })
  );
  assert.equal(disposals, 0);
  target.dispatchEvent(
    Object.assign(new Event('pagehide'), { persisted: false })
  );
  target.dispatchEvent(
    Object.assign(new Event('pagehide'), { persisted: false })
  );
  release();
  assert.equal(disposals, 1);
});

test('explicit browser teardown disposes once and removes its listener', () => {
  const target = new EventTarget();
  let disposals = 0;
  const release = bindBrowserLifetime({ dispose: () => disposals++ }, target);
  release();
  release();
  target.dispatchEvent(new Event('pagehide'));
  assert.equal(disposals, 1);
});
