import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { ChatSidenav } from '@threadplane/react/chat';

assert.equal(typeof window, 'undefined');
assert.equal(typeof document, 'undefined');
let requests = 0;
const request = () => { requests++; };
const props = {
  mode: 'expanded',
  open: false,
  onModeChange: request,
  onOpenChange: request,
  children: 'Retained directory',
};
const plain = renderToString(createElement(ChatSidenav, props));
assert.doesNotMatch(plain, /tp-chat-sidenav__search|aria-keyshortcuts/);
assert.match(plain, /Retained directory/);

const search = {
  ...props,
  onSearch: request,
  searchLabel: 'Search <loaded> & conversations',
  searchShortcut: true,
};
for (const mode of ['expanded', 'collapsed', 'drawer']) {
  const html = renderToString(createElement(ChatSidenav, { ...search, mode }));
  assert.match(html, /class="tp-chat-sidenav__search"/);
  assert.match(html, /aria-label="Search &lt;loaded&gt; &amp; conversations"/);
  assert.match(html, /title="Search &lt;loaded&gt; &amp; conversations \(Ctrl\/Command\+K\)"/);
  assert.match(html, /aria-keyshortcuts="Control\+K Meta\+K"/);
  assert.match(html, /Retained directory/);
  if (mode === 'drawer') assert.match(html, /<nav[^>]*hidden=""[^>]*inert=""/);
}
assert.equal(requests, 0);
console.log('Installed React sidenav SSR: default and three search modes rendered without DOM globals or requests.');
