import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { HistorySearchPalette, ProjectNameForm, ProjectList, ChatSidenav, ConfirmDialog, OverflowMenu, ThreadList, ThreadRenameForm } from '@threadplane/react/chat';

assert.equal(typeof window, 'undefined');
assert.equal(typeof document, 'undefined');
let requests = 0;
const request = () => { requests++; };
for (const open of [false, true]) {
  const html = renderToString(createElement(HistorySearchPalette, {
    open, query: '<literal>',
    results: Object.freeze([Object.freeze({ id: ' exact/ID ', title: '<literal>' })]),
    onQueryChange: request, onSelect: request, onClose: request,
  }));
  assert.match(html, /hidden/);
  assert.doesNotMatch(html, /<dialog|<input|role="listbox"|aria-modal/);
}
assert.equal(requests, 0);
console.log('Installed controlled history search SSR: no DOM globals or requests.');
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

const nameProps = {
  value: 'Literal <project> & details', onValueChange: request,
  onSubmit: request, onCancel: request,
};
const projectName = renderToString(createElement(ProjectNameForm, {
  ...nameProps, error: 'Literal <failure> & details',
}));
assert.match(projectName, /class="tp-project-name-form"/);
assert.match(projectName, /<label[^>]+>Project name<\/label>/);
assert.match(projectName, /value="Literal &lt;project&gt; &amp; details"/);
assert.match(projectName, /aria-invalid="true" aria-describedby="([^"]+)-error"/);
assert.match(projectName, /<p id="[^"]+-error" role="alert">Literal &lt;failure&gt; &amp; details<\/p>/);
assert.match(projectName, /<button type="submit">Save<\/button>/);
assert.match(projectName, /<button type="button">Cancel<\/button>/);
const pendingName = renderToString(createElement(ProjectNameForm, { ...nameProps, pending: true }));
assert.match(pendingName, /aria-busy="true"/);
assert.match(pendingName, /<input[^>]+disabled=""/);
assert.match(pendingName, /<button type="submit" disabled="">Save<\/button>/);
assert.match(pendingName, /<p role="status">Saving project name…<\/p>/);
for (const options of [{ value: '   ' }, { submitDisabled: true }]) {
  const html = renderToString(createElement(ProjectNameForm, {
    ...nameProps, ...options, submitLabel: 'Create <project> & save',
  }));
  assert.match(html, /<button type="submit" disabled="">Create &lt;project&gt; &amp; save<\/button>/);
  assert.match(html, /<button type="button">Cancel<\/button>/);
  assert.doesNotMatch(html, /<input[^>]+disabled|role="status"/);
}
const actionProjects = Object.freeze([
  Object.freeze({ id: ' original/ID ', name: 'Literal <name> & title' }),
  Object.freeze({ id: 'second', name: 'Second' }),
]);
const received = [];
const projectActions = renderToString(createElement(ProjectList, {
  projects: actionProjects, onSelect: request, onNewProject: request,
  renderActions: project => {
    received.push(project);
    return createElement('button', { type: 'button', onClick: request }, `Rename ${project.id}`);
  },
}));
assert.equal(received.length, actionProjects.length);
actionProjects.forEach((project, index) => assert.equal(received[index], project));
assert.match(projectActions, /Literal &lt;name&gt; &amp; title/);
assert.match(projectActions, /<\/button><div class="tp-project-list__actions"><button type="button">Rename  original\/ID <\/button><\/div>/);
assert.doesNotMatch(projectList, /tp-project-list__actions|tp-project-list__item--actions/);
for (const empty of [null, false, undefined]) {
  const html = renderToString(createElement(ProjectList, {
    projects: actionProjects, onSelect: request, renderActions: () => empty,
  }));
  assert.doesNotMatch(html, /tp-project-list__actions|tp-project-list__item--actions/);
}
assert.equal(requests, 0);
assert.equal(typeof window, 'undefined');
assert.equal(typeof document, 'undefined');
console.log('Installed project name and action SSR: literal data, original items, disabled/status states and no DOM globals or commands.');
