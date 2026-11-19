import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { completeDelivery, streamingDelivery, type Message } from '@threadplane/core';
import { createMessageContent } from '@threadplane/content/messages';
import { MessageList, type MessageGenerativeUi } from '../chat/index';
import {
  A2uiMessageSurfaces,
  a2uiBasicCatalog,
  type A2uiMessageContent,
} from './index';
import { createA2uiMessageReader } from './message-reader';

afterEach(cleanup);

const line = (value: object) => JSON.stringify(value) + '\n';
const CREATE = line({ version: 'v0.9', createSurface: { surfaceId: 'trip', catalogId: 'basic' } });
const COMPONENTS = line({
  version: 'v0.9',
  updateComponents: {
    surfaceId: 'trip',
    components: [
      { id: 'root', component: 'Column', children: ['title', 'guest', 'book'] },
      { id: 'title', component: 'Text', text: { path: '/title' } },
      { id: 'guest', component: 'TextField', label: 'Guest', value: { path: '/guest' } },
      { id: 'book', component: 'Button', child: 'label', action: { event: { name: 'book' } } },
      { id: 'label', component: 'Text', text: 'Book' },
    ],
  },
});
const title = (value: string) =>
  line({ version: 'v0.9', updateDataModel: { surfaceId: 'trip', path: '/title', value } });
const SOURCE = '\n' + CREATE + COMPONENTS + title('Lyon trip');
const A2UI_CATALOG = a2uiBasicCatalog();
const SKELETON = <p role="status">Building UI…</p>;

const content = (source: string, streaming = true, messageId = 'a'): A2uiMessageContent => ({
  messageId,
  source,
  streaming,
  skeleton: SKELETON,
});
const surfaceIds = (container: HTMLElement) =>
  [...container.querySelectorAll('.a2ui-surface')].map((node) =>
    node.getAttribute('data-surface-id')
  );

describe('createA2uiMessageReader', () => {
  const titleOf = (reader: ReturnType<typeof createA2uiMessageReader>) =>
    (reader.getSnapshot().surfaces[0]?.dataModel as { title?: string } | undefined)?.title;

  it('reads only finished lines while streaming, and the last line once it is not', () => {
    const reader = createA2uiMessageReader();
    const partial = SOURCE.slice(0, -1);
    reader.read(partial, true);
    expect(reader.getSnapshot().surfaces).toHaveLength(1);
    expect(titleOf(reader)).toBeUndefined();
    reader.read(partial, false);
    expect(titleOf(reader)).toBe('Lyon trip');
  });

  it('applies each line once as the source grows', () => {
    const reader = createA2uiMessageReader();
    const store = reader.surfaces();
    const apply = vi.spyOn(store, 'apply');
    for (let length = 0; length <= SOURCE.length; length += 7) reader.read(SOURCE.slice(0, length), true);
    reader.read(SOURCE, true);
    reader.read(SOURCE, false);
    expect(apply).toHaveBeenCalledTimes(3);
    expect(reader.surfaces()).toBe(store);
    expect(titleOf(reader)).toBe('Lyon trip');
  });

  it('starts over when the source is not an extension of what was read', () => {
    const reader = createA2uiMessageReader();
    reader.read(SOURCE, true);
    const first = reader.surfaces();
    first.setValue('trip', '/guest', 'Ada');
    reader.read(CREATE + COMPONENTS + title('Nice trip'), true);
    expect(reader.surfaces()).not.toBe(first);
    expect(reader.getSnapshot().surfaces[0].dataModel).toEqual({ title: 'Nice trip' });
    // A shorter source is not an extension either.
    reader.read(CREATE, true);
    expect(reader.getSnapshot().surfaces).toHaveLength(0);
  });

  it('starts over when text follows a last line that was read without its newline', () => {
    const reader = createA2uiMessageReader();
    const unterminated = SOURCE.slice(0, -1);
    reader.read(unterminated, false);
    const first = reader.surfaces();
    reader.read(unterminated, false);
    expect(reader.surfaces()).toBe(first);
    reader.read(unterminated + '\n' + title('Nice trip'), false);
    expect(reader.surfaces()).not.toBe(first);
    expect(titleOf(reader)).toBe('Nice trip');
  });

  it('skips lines that are not envelopes the store can take', () => {
    const reader = createA2uiMessageReader();
    const apply = vi.spyOn(reader.surfaces(), 'apply');
    reader.read(
      [
        'not json',
        '[1]',
        '"text"',
        JSON.stringify({ beginRendering: { surfaceId: 'trip' } }),
        JSON.stringify({ createSurface: 'trip' }),
        JSON.stringify({ updateDataModel: { path: '/title', value: 'x' } }),
        JSON.stringify({ updateComponents: { surfaceId: 'trip', components: 'root' } }),
        '',
      ].join('\n') + SOURCE,
      true
    );
    expect(apply).toHaveBeenCalledTimes(3);
    expect(reader.getSnapshot().surfaces).toHaveLength(1);
    expect(titleOf(reader)).toBe('Lyon trip');
  });

  it('defaults a missing version and keeps reading after an envelope the store rejects', () => {
    const reader = createA2uiMessageReader();
    const apply = vi.spyOn(reader.surfaces(), 'apply').mockImplementationOnce(() => {
      throw new Error('rejected');
    });
    reader.read(
      line({ deleteSurface: { surfaceId: 'gone' } }) + SOURCE,
      true
    );
    expect(apply.mock.calls[0][0]).toEqual({ version: 'v0.9', deleteSurface: { surfaceId: 'gone' } });
    expect(titleOf(reader)).toBe('Lyon trip');
  });

  it('notifies of edits, not of its own reading', () => {
    const reader = createA2uiMessageReader();
    const notify = vi.fn();
    const stop = reader.subscribe(notify);
    reader.read(SOURCE, true);
    expect(notify).not.toHaveBeenCalled();
    reader.surfaces().setValue('trip', '/guest', 'Ada');
    expect(notify).toHaveBeenCalledTimes(1);
    // The subscription follows the reader to the store it starts over with.
    reader.read(CREATE + COMPONENTS, true);
    reader.surfaces().setValue('trip', '/guest', 'Grace');
    expect(notify).toHaveBeenCalledTimes(2);
    stop();
    reader.surfaces().setValue('trip', '/guest', 'Edsger');
    expect(notify).toHaveBeenCalledTimes(2);
  });
});

describe('A2uiMessageSurfaces', () => {
  it('shows the skeleton while streaming until a surface is live', () => {
    const view = render(<A2uiMessageSurfaces content={content(CREATE)} />);
    expect(view.getByRole('status').textContent).toBe('Building UI…');
    // An unfinished line is not read.
    view.rerender(<A2uiMessageSurfaces content={content(CREATE + COMPONENTS.slice(0, -1))} />);
    expect(view.queryByRole('status')).not.toBeNull();
    expect(surfaceIds(view.container)).toEqual([]);
    view.rerender(<A2uiMessageSurfaces content={content(CREATE + COMPONENTS)} />);
    expect(surfaceIds(view.container)).toEqual(['trip']);
    // The surface is live; only its Text bound to /title waits for the data model.
    expect(view.getByRole('status').closest('.a2ui-surface')).not.toBeNull();
    view.rerender(<A2uiMessageSurfaces content={content(CREATE + COMPONENTS + title('Lyon'))} />);
    expect(view.queryByRole('status')).toBeNull();
    expect(view.container.textContent).toContain('Lyon');
  });

  it('renders nothing for a finished message with no surface', () => {
    const view = render(<A2uiMessageSurfaces content={content(CREATE, false)} />);
    expect(view.container.innerHTML).toBe('');
  });

  it('keeps an edit across later lines and drops it when the source is replaced', () => {
    const view = render(
      <StrictMode>
        <A2uiMessageSurfaces content={content('\n' + CREATE + COMPONENTS)} />
      </StrictMode>
    );
    fireEvent.change(view.getByLabelText('Guest'), { target: { value: 'Ada' } });
    expect((view.getByLabelText('Guest') as HTMLInputElement).value).toBe('Ada');
    view.rerender(
      <StrictMode>
        <A2uiMessageSurfaces content={content(SOURCE)} />
      </StrictMode>
    );
    expect(view.container.textContent).toContain('Lyon trip');
    expect((view.getByLabelText('Guest') as HTMLInputElement).value).toBe('Ada');
    view.rerender(
      <StrictMode>
        <A2uiMessageSurfaces content={content(CREATE + COMPONENTS + title('Nice trip'))} />
      </StrictMode>
    );
    expect(view.container.textContent).toContain('Nice trip');
    expect((view.getByLabelText('Guest') as HTMLInputElement).value).toBe('');
  });

  it('starts over for another message with the same source', () => {
    const view = render(<A2uiMessageSurfaces content={content(SOURCE, false, 'a')} />);
    fireEvent.change(view.getByLabelText('Guest'), { target: { value: 'Ada' } });
    view.rerender(<A2uiMessageSurfaces content={content(SOURCE, false, 'a')} />);
    expect((view.getByLabelText('Guest') as HTMLInputElement).value).toBe('Ada');
    view.rerender(<A2uiMessageSurfaces content={content(SOURCE, false, 'b')} />);
    expect((view.getByLabelText('Guest') as HTMLInputElement).value).toBe('');
  });

  it('renders every live surface in order and removes a deleted one', () => {
    const second =
      line({ createSurface: { surfaceId: 'map', catalogId: 'basic' } }) +
      line({ updateComponents: { surfaceId: 'map', components: [{ id: 'root', component: 'Text', text: 'Map' }] } });
    const view = render(
      <A2uiMessageSurfaces content={content(SOURCE + second)} className="mine" />
    );
    expect(surfaceIds(view.container)).toEqual(['trip', 'map']);
    expect(view.container.querySelectorAll('.a2ui-surface.mine')).toHaveLength(2);
    view.rerender(
      <A2uiMessageSurfaces
        content={content(SOURCE + second + line({ deleteSurface: { surfaceId: 'trip' } }))}
      />
    );
    expect(surfaceIds(view.container)).toEqual(['map']);
  });

  it('passes actions, validation errors, functions and the catalog to each surface', () => {
    const onAction = vi.fn();
    const onValidationError = vi.fn();
    const open = vi.fn();
    const source =
      CREATE +
      line({
        updateComponents: {
          surfaceId: 'trip',
          components: [
            { id: 'root', component: 'Column', children: ['guest', 'book', 'docs', 'badge'] },
            {
              id: 'guest',
              component: 'TextField',
              label: 'Guest',
              value: { path: '/guest' },
              checks: [{ condition: { call: 'required', args: { value: { path: '/guest' } } }, message: 'Name a guest' }],
            },
            { id: 'book', component: 'Button', child: 'label', action: { event: { name: 'book', context: { guest: { path: '/guest' } } } } },
            { id: 'label', component: 'Text', text: 'Book' },
            { id: 'docs', component: 'Button', child: 'docsLabel', action: { functionCall: { call: 'open', args: { id: 'docs' } } } },
            { id: 'docsLabel', component: 'Text', text: 'Docs' },
            { id: 'badge', component: 'Badge' },
          ],
        },
      });
    const catalog = { ...A2UI_CATALOG, Badge: () => <em>custom badge</em> };
    const view = render(
      <A2uiMessageSurfaces
        content={content(source, false)}
        onAction={onAction}
        onValidationError={onValidationError}
        functions={{ open }}
        catalog={catalog}
      />
    );
    expect(view.container.textContent).toContain('custom badge');
    fireEvent.click(view.getByRole('button', { name: 'Docs' }));
    expect(open).toHaveBeenCalledWith({ id: 'docs' });
    fireEvent.click(view.getByRole('button', { name: 'Book' }));
    expect(onAction).not.toHaveBeenCalled();
    expect(onValidationError.mock.calls[0][0].error).toMatchObject({
      code: 'VALIDATION_FAILED',
      surfaceId: 'trip',
      message: 'Name a guest',
    });
    fireEvent.change(view.getByLabelText('Guest'), { target: { value: 'Ada' } });
    fireEvent.click(view.getByRole('button', { name: 'Book' }));
    // The action reads the edit from the message's own store.
    expect(onAction.mock.calls[0][0].action).toMatchObject({
      name: 'book',
      surfaceId: 'trip',
      context: { guest: 'Ada' },
    });
  });

  it('renders a finished surface on the server', () => {
    const html = renderToString(<A2uiMessageSurfaces content={content(SOURCE, false)} />);
    expect(html).toContain('data-surface-id="trip"');
    expect(html).toContain('Lyon trip');
  });
});

describe('A2UI surfaces in the transcript', () => {
  it('renders a message carrying A2UI as a surface, with the skeleton until it is live', () => {
    const onAction = vi.fn();
    const generativeUi: MessageGenerativeUi = {
      renderA2ui: (a2ui) => <A2uiMessageSurfaces content={a2ui} onAction={onAction} />,
    };
    const CONTENT = '---a2ui_JSON---' + SOURCE;
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
