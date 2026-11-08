import React from 'react';
import { createRoot } from 'react-dom/client';
import { MessageList } from '@threadplane/react/chat';
import {
  createMessageContent,
  type MessageRow,
} from '@threadplane/content/messages';
import {
  streamingDelivery,
  type AgentSnapshot,
  type Message,
} from '@threadplane/core';

// Fixture-owned lifetime: React only borrows accepted rows.
export async function mountDefaultTranscript() {
  const owner = createMessageContent();
  const host = document.createElement('section');
  host.id = 'default-transcript';
  host.setAttribute('aria-label', 'Installed default transcript fixture');
  document.querySelector('main')!.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/presentation-assets/default-transcript-chat.css';
  const loaded = new Promise<void>((resolve, reject) => {
    link.onload = () => resolve();
    link.onerror = () =>
      reject(new Error('Default transcript stylesheet failed'));
  });
  const controls = document.createElement('div');
  const mount = document.createElement('div');
  shadow.append(link, controls, mount);
  await loaded;
  const root = createRoot(mount);
  let rows: readonly MessageRow[] = [];
  let revision = 0,
    disposed = false,
    markdownStable = true;
  const message = (
    id: string,
    content: string,
    extra: Partial<Message> = {}
  ): Message => ({
    id,
    content,
    role: 'assistant',
    delivery: streamingDelivery('fixture'),
    ...extra,
  });
  const provider = (title: string) => [
    {
      id: 'p',
      index: 7,
      title,
      url: '/' + title,
      snippet: '<img data-fixture-raw src=x>',
    },
  ];
  const messages = (title?: string): Message[] => [
    message('provider', 'Provider [^p], unresolved [^missing].', {
      citations: title ? provider(title) : [],
    }),
    message(
      'markdown',
      'Markdown [^m].\n\n[^m]: Markdown source [link](/markdown-source)\n'
    ),
    message(
      'mixed',
      'Mixed [^collision].\n\n[^collision]: [Forbidden fallback](/forbidden-fallback)\n\n[^md]: Markdown only\n',
      {
        citations: [
          { id: 'late', index: 9, title: 'Late' },
          { id: 'tie-first', index: 2, title: 'Tie first' },
          { id: 'tie-second', index: 2, title: 'Tie second' },
          {
            id: 'collision',
            index: 1,
            title: '<b>Unsafe provider</b>',
            url: 'javascript:alert(1)',
          },
        ],
      }
    ),
    ...(['user', 'system', 'tool'] as const).map((role) =>
      message(role, 'Withheld [^p].\n\n[^local]: Local definition\n', {
        role,
        citations: provider('Withheld'),
      })
    ),
    message('empty', 'No sources'),
  ];
  const custom = (row: MessageRow) => (
    <p data-custom-row={row.id}>{row.message.content}</p>
  );
  const draw = (renderMessage?: typeof custom) =>
    root.render(
      renderMessage === undefined ? (
        <MessageList rows={rows} label="Installed default MessageList" />
      ) : (
        <MessageList
          rows={rows}
          label="Installed default MessageList"
          renderMessage={renderMessage}
        />
      )
    );
  const update = (title?: string) => {
    const previous = rows;
    rows = owner.project({
      status: 'idle',
      messages: messages(title),
      toolCalls: [],
    } as unknown as AgentSnapshot);
    if (previous.length)
      markdownStable &&= rows.every(
        (row, index) => row.markdown === previous[index].markdown
      );
    revision++;
    draw();
  };
  const button = (label: string, action: () => void) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.onclick = action;
    controls.append(button);
  };
  update('Original');
  button('Correct default metadata', () => update('Corrected'));
  button('Remove default metadata', () => update());
  button('Use custom default rows', () => {
    revision++;
    draw(custom);
  });
  button('Restore default rows', () => {
    revision++;
    draw();
  });
  button('Dispose default owner', () => {
    owner.dispose();
    disposed = true;
    revision++;
  });
  button('Unmount default transcript', () => {
    root.unmount();
    revision++;
  });
  const evidence = () => ({
    ready: true,
    revision,
    disposed,
    markdownStable,
    rows: rows.length,
  });
  Object.assign(window, { __defaultTranscript: evidence });
  window.addEventListener(
    'pagehide',
    () => {
      root.unmount();
      owner.dispose();
    },
    { once: true }
  );
}
