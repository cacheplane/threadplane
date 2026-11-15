import { useMemo, useSyncExternalStore } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { completeDelivery, streamingDelivery, type Message } from '@threadplane/core';
import { createMessageContent } from '@threadplane/content/messages';
import {
  createA2uiSurfaces,
  type A2uiActionMessage,
  type A2uiSurfaces,
} from '@threadplane/content/a2ui';
import {
  MessageList,
  type MessageA2uiContent,
  type MessageGenerativeUi,
} from '../chat/index';
import { A2uiSurface } from './index';

afterEach(cleanup);

const LINES = [
  { version: 'v0.9', createSurface: { surfaceId: 'trip', catalogId: 'basic' } },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: 'trip',
      components: [
        { id: 'root', component: 'Column', children: ['title', 'book'] },
        { id: 'title', component: 'Text', text: { path: '/title' } },
        { id: 'book', component: 'Button', child: 'label', action: { event: { name: 'book' } } },
        { id: 'label', component: 'Text', text: 'Book' },
      ],
    },
  },
  { version: 'v0.9', updateDataModel: { surfaceId: 'trip', path: '/title', value: 'Lyon trip' } },
].map((line) => JSON.stringify(line) + '\n');
const CONTENT = '---a2ui_JSON---\n' + LINES.join('');

/** What an application supplies today: the finished lines of the message, applied to its own store. */
function MessageSurfaces({
  content,
  onAction,
}: {
  readonly content: MessageA2uiContent;
  readonly onAction: (message: A2uiActionMessage) => void;
}) {
  const surfaces = useMemo(() => {
    const store = createA2uiSurfaces();
    const finished = content.source.slice(0, content.source.lastIndexOf('\n') + 1);
    for (const line of finished.split('\n'))
      if (line.trim())
        store.apply(JSON.parse(line) as Parameters<A2uiSurfaces['apply']>[0]);
    return store;
  }, [content.source]);
  const snapshot = useSyncExternalStore(surfaces.subscribe, surfaces.getSnapshot);
  if (snapshot.surfaces.length === 0) return <>{content.skeleton}</>;
  return (
    <>
      {snapshot.surfaces.map((surface) => (
        <A2uiSurface
          key={surface.surfaceId}
          surface={surface}
          surfaces={surfaces}
          onAction={onAction}
        />
      ))}
    </>
  );
}

describe('A2UI surfaces in the transcript', () => {
  it('renders a message carrying A2UI as a surface, with the skeleton until it is live', () => {
    const onAction = vi.fn();
    const generativeUi: MessageGenerativeUi = {
      renderA2ui: (content) => (
        <MessageSurfaces content={content} onAction={onAction} />
      ),
    };
    const projector = createMessageContent();
    const at = (length: number, streaming = true) => {
      const message: Message = {
        id: 'a',
        role: 'assistant',
        content: CONTENT.slice(0, length),
        delivery: streaming ? streamingDelivery('g') : completeDelivery('g', 'success'),
      };
      return projector.project({ status: 'idle', messages: [message], toolCalls: [] });
    };
    // The surface exists only once its root component has arrived.
    const view = render(
      <MessageList rows={at(CONTENT.indexOf('updateComponents'))} generativeUi={generativeUi} />
    );
    expect(view.getByRole('status').textContent).toBe('Building UI…');
    expect(view.container.querySelector('.a2ui-surface')).toBeNull();

    view.rerender(
      <MessageList rows={at(CONTENT.length, false)} generativeUi={generativeUi} />
    );
    expect(view.queryByRole('status')).toBeNull();
    const surface = view.container.querySelector(
      '.tp-chat-message__body .tp-chat-generative-ui .a2ui-surface'
    ) as HTMLElement;
    expect(surface.getAttribute('data-surface-id')).toBe('trip');
    expect(surface.textContent).toContain('Lyon trip');
    expect(view.container.textContent).not.toContain('createSurface');

    fireEvent.click(view.getByRole('button', { name: 'Book' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0][0]).toMatchObject({
      action: { name: 'book', surfaceId: 'trip', sourceComponentId: 'book' },
    });
  });
});
