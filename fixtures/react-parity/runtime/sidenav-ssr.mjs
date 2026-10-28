import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { ProjectList, ChatSidenav, ConfirmDialog, OverflowMenu, ThreadList, ThreadRenameForm } from '@threadplane/react/chat';

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
for (const open of [false, true]) {
  const html = renderToString(
    createElement(OverflowMenu, {
      label: 'Actions <ID>',
      open,
      anchorPoint: { x: 41, y: 52 },
      returnFocusTo: null,
      items: [{ id: 'copy', label: 'Copy' }],
      onOpenChange: request,
      onSelect: request,
    })
  );
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-haspopup="menu"/);
  assert.doesNotMatch(html, /aria-controls|role="menu"|role="menuitem"/);
}
const contextRows = renderToString(
  createElement(ThreadList, {
    threads: [{ id: 'context<&', title: 'Context row' }],
    onSelect: request,
    onContextMenu: request,
  })
);
assert.match(contextRows, /Context row/);
assert.doesNotMatch(contextRows, /role="menu"/);
assert.equal(requests, 0);
console.log('Installed React sidenav SSR: default and three search modes rendered without DOM globals or requests.');
const rename = renderToString(createElement(ThreadRenameForm, {
  value: 'Literal <title> & details',
  onValueChange: request,
  onSubmit: request,
  onCancel: request,
  error: 'Literal <failure>',
}));
assert.match(rename, /<form/);
assert.match(rename, /Literal &lt;title&gt; &amp; details/);
assert.match(rename, /Literal &lt;failure&gt;/);
assert.match(rename, /Save/);
assert.match(rename, /Cancel/);
assert.equal(requests, 0);
console.log('Installed controlled rename editor SSR: no DOM globals or command requests.');
for (const open of [false, true]) {
  const html = renderToString(createElement(ConfirmDialog, {
    open,
    title: 'Delete <literal> & history?',
    body: 'Permanent <body> & details',
    pending: true,
    tone: 'destructive',
    returnFocusTo: null,
    onConfirm: request,
    onCancel: request,
  }));
  assert.doesNotMatch(html, /<dialog|role="alertdialog"|aria-modal|autofocus/);
}
assert.equal(requests, 0);
console.log('Installed controlled confirmation SSR: closed and requested-open states are DOM-free and issue no commands.');

const customRows = renderToString(createElement(ThreadList, {
  threads: [{ id: 'custom<&', title: 'Unused title', pinned: true, updatedAt: 0 }],
  activeThreadId: 'custom<&', onSelect: request,
  renderItem: (thread, active) => createElement('button', { 'aria-current': active ? 'true' : undefined }, thread.id),
  renderTitle: () => { throw Error('Unexpected default title renderer'); },
  renderActions: () => { throw Error('Unexpected default action renderer'); },
}));
assert.match(customRows, /<li class="tp-thread-list__item"><button aria-current="true">custom&lt;&amp;<\/button><\/li>/);
assert.doesNotMatch(customRows, /Unused title|Pinned conversation|<time/);
assert.equal(requests, 0);
console.log('Installed custom ThreadList row SSR: literal data, app-owned controls, no default callbacks or commands.');

const projectList = renderToString(createElement(ProjectList, {
  projects: [{ id: ' p/b ', name: '<Project> & details' }, { id: 'empty', name: '' }],
  activeProjectId: ' p/b ', onSelect: request, onNewProject: request,
}));
assert.match(projectList, /aria-label="Projects"/);
assert.match(projectList, /aria-current="true"/);
assert.match(projectList, /&lt;Project&gt; &amp; details/);
assert.match(projectList, />empty<\/button>/);
assert.match(projectList, /\+ New project/);
assert.equal(requests, 0);
console.log('Installed ProjectList SSR retains literal names without DOM globals or commands.');
