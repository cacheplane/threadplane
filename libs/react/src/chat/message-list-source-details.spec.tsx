import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  completeDelivery,
  streamingDelivery,
  type AgentSnapshot,
  type Message,
} from '@threadplane/core';
import { createMessageContent } from '@threadplane/content/messages';
import { MessageList, type MessageGenerativeUi } from './index';

afterEach(cleanup);

const SPEC = JSON.stringify({
  root: 'card',
  elements: { card: { type: 'Card', props: { title: 'Lyon trip' } } },
});
const A2UI =
  '---a2ui_JSON---\n{"version":"v0.9","createSurface":{"surfaceId":"trip"}}\n';
const registry: NonNullable<MessageGenerativeUi['registry']> = {
  Card: (view) => <section>{String(view.props['title'])}</section>,
};
const renderA2ui: NonNullable<MessageGenerativeUi['renderA2ui']> = () => (
  <section>surface</section>
);

const assistant = (content: string, id = 'a', streaming = false): Message => ({
  id,
  role: 'assistant',
  content,
  delivery: streaming ? streamingDelivery('g') : completeDelivery('g', 'success'),
});
const snapshot = (messages: readonly Message[]): AgentSnapshot => ({
  status: 'idle',
  messages,
  toolCalls: [],
});
const rows = (...messages: Message[]) =>
  createMessageContent().project(snapshot(messages));
const details = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLDetailsElement>('details.tp-chat-generative-ui__source')];

describe('MessageList generativeUi sourceDetails', () => {
  it('adds no disclosure unless sourceDetails is set', () => {
    const view = render(
      <MessageList
        rows={rows(assistant(SPEC), assistant(A2UI, 'b'))}
        generativeUi={{ registry, renderA2ui }}
      />
    );
    expect(details(view.container)).toHaveLength(0);
    view.rerender(
      <MessageList
        rows={rows(assistant(SPEC), assistant(A2UI, 'b'))}
        generativeUi={{ registry, renderA2ui, sourceDetails: false }}
      />
    );
    expect(details(view.container)).toHaveLength(0);
  });

  it('shows a closed disclosure with the source under each surface', () => {
    const view = render(
      <MessageList
        rows={rows(assistant(SPEC), assistant(A2UI, 'b'))}
        generativeUi={{ registry, renderA2ui, sourceDetails: true }}
      />
    );
    const [spec, a2ui] = details(view.container);
    expect(details(view.container)).toHaveLength(2);
    expect(spec.open).toBe(false);
    expect(spec.getAttribute('data-kind')).toBe('spec');
    expect(spec.querySelector('summary')?.textContent).toBe('Details');
    expect(spec.querySelector('p')?.textContent).toBe('Layout source');
    expect(spec.querySelector('pre')?.textContent).toBe(SPEC);
    // It follows its surface inside the same message body.
    const surface = spec.previousElementSibling as HTMLElement;
    expect(surface.className).toBe('tp-chat-generative-ui');
    expect(surface.textContent).toBe('Lyon trip');
    expect(spec.closest('.tp-chat-message__body')).not.toBeNull();

    expect(a2ui.getAttribute('data-kind')).toBe('a2ui');
    expect(a2ui.querySelector('p')?.textContent).toBe('Response source');
    expect(a2ui.querySelector('pre')?.textContent).toBe(A2UI);
    expect((a2ui.previousElementSibling as HTMLElement).textContent).toBe('surface');
  });

  it('takes its text from labels', () => {
    const view = render(
      <MessageList
        rows={rows(assistant(SPEC), assistant(A2UI, 'b'))}
        generativeUi={{
          registry,
          renderA2ui,
          sourceDetails: { summary: 'Source', spec: 'Layout', a2ui: 'Envelopes' },
        }}
      />
    );
    const [spec, a2ui] = details(view.container);
    expect(spec.querySelector('summary')?.textContent).toBe('Source');
    expect(spec.querySelector('p')?.textContent).toBe('Layout');
    expect(a2ui.querySelector('summary')?.textContent).toBe('Source');
    expect(a2ui.querySelector('p')?.textContent).toBe('Envelopes');
  });

  it('adds none to text, to content that is not a spec, or to a placeholder', () => {
    const options: MessageGenerativeUi = { registry, sourceDetails: true };
    const view = render(
      <MessageList
        rows={rows(
          assistant('Plain'),
          assistant('{"answer": 42}', 'b'),
          assistant(A2UI, 'c'),
          assistant('{"root"', 'd', true)
        )}
        generativeUi={options}
      />
    );
    expect(view.getByRole('status')).not.toBeNull();
    expect(details(view.container)).toHaveLength(0);
  });

  it('keeps the disclosure open while its message streams', () => {
    const content = createMessageContent();
    const at = (length: number, streaming = true) =>
      content.project(snapshot([assistant(SPEC.slice(0, length), 'a', streaming)]));
    const options: MessageGenerativeUi = { registry, sourceDetails: true };
    const view = render(
      <MessageList rows={at(SPEC.length - 1)} generativeUi={options} />
    );
    const [open] = details(view.container);
    open.open = true;
    view.rerender(<MessageList rows={at(SPEC.length, false)} generativeUi={options} />);
    expect(details(view.container)[0]).toBe(open);
    expect(open.open).toBe(true);
    expect(open.querySelector('pre')?.textContent).toBe(SPEC);
  });
});
