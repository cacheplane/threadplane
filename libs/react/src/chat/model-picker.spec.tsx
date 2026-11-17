import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSession, AgentSnapshot } from '@threadplane/core';
import { Chat, type ChatModelPicker } from './index';

// The anchored menu opens only for a trigger that has layout.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(
    function (this: HTMLElement) {
      return [this.getBoundingClientRect()] as unknown as DOMRectList;
    }
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function fakeSession() {
  let snapshot = Object.freeze({
    status: 'idle',
    messages: [],
    toolCalls: [],
  }) as AgentSnapshot;
  const listeners = new Set<() => void>();
  const raw = {
    getSnapshot: () => snapshot,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    submit: vi.fn(async () => 'success' as const),
    stop: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
  const set = (next: Partial<AgentSnapshot>) => {
    snapshot = Object.freeze({ ...snapshot, ...next }) as AgentSnapshot;
    act(() => listeners.forEach((notify) => notify()));
  };
  return { session: raw as unknown as AgentSession, raw, set };
}

const options = [
  { value: 'fast', label: 'Fast' },
  { value: 'deep', label: 'Deep', description: 'Slower, more careful' },
];

function Owned(props: Partial<ChatModelPicker> & { session: AgentSession; onChange?: (value: string) => void }) {
  const { session, onChange, ...picker } = props;
  const [value, setValue] = useState('fast');
  return (
    <Chat
      session={session}
      inputTrailing={<button type="button">Tools</button>}
      modelPicker={{
        options,
        value,
        onValueChange: (next) => {
          onChange?.(next);
          setValue(next);
        },
        ...picker,
      }}
    />
  );
}

describe('Chat model picker', () => {
  it('renders nothing extra unless the app asks for it', () => {
    const { session } = fakeSession();
    const view = render(<Chat session={session} />);
    expect(view.container.querySelector('.tp-chat__model-picker')).toBeNull();
    expect(view.container.querySelector('.tp-chat-input__trailing')).toBeNull();
  });

  it('sits in the composer before the app trailing controls and shows the chosen label', () => {
    const { session } = fakeSession();
    const view = render(<Owned session={session} />);
    const trigger = view.container.querySelector<HTMLElement>('.tp-chat__model-picker');
    expect(trigger?.textContent).toBe('Fast');
    const trailing = view.container.querySelector('.tp-chat-input__trailing');
    expect(trailing?.firstElementChild).toBe(trigger);
    expect(trailing?.lastElementChild).toBe(view.getByRole('button', { name: 'Tools' }));
  });

  it('opens a named list, reports the choice, closes, and sends nothing to the session', () => {
    const { session, raw } = fakeSession();
    const onChange = vi.fn();
    const view = render(<Owned session={session} onChange={onChange} />);
    const trigger = view.container.querySelector<HTMLElement>('.tp-chat__model-picker')!;
    fireEvent.click(trigger);
    const list = view.getByRole('listbox', { name: 'Model' });
    expect(list).not.toBeNull();
    fireEvent.click(view.getByRole('option', { name: /Deep/ }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('deep');
    expect(view.queryByRole('listbox')).toBeNull();
    expect(trigger.textContent).toBe('Deep');
    expect(raw.submit).not.toHaveBeenCalled();
  });

  it('keeps the app value when the app declines a change', () => {
    const { session } = fakeSession();
    const view = render(
      <Chat
        session={session}
        modelPicker={{ options, value: 'fast', onValueChange: () => undefined }}
      />
    );
    const trigger = view.container.querySelector<HTMLElement>('.tp-chat__model-picker')!;
    fireEvent.click(trigger);
    fireEvent.click(view.getByRole('option', { name: /Deep/ }));
    expect(trigger.textContent).toBe('Fast');
  });

  it('uses the app label and placeholder, and shows the placeholder for an unknown value', () => {
    const { session } = fakeSession();
    const view = render(
      <Chat
        session={session}
        modelPicker={{
          options,
          value: 'gone',
          onValueChange: () => undefined,
          label: 'Modell',
          placeholder: 'Modell wählen',
        }}
      />
    );
    const trigger = view.container.querySelector<HTMLElement>('.tp-chat__model-picker')!;
    expect(trigger.textContent).toBe('Modell wählen');
    fireEvent.click(trigger);
    expect(view.getByRole('listbox', { name: 'Modell' })).not.toBeNull();
  });

  it('is hidden while there are no options, leaving the app trailing content alone', () => {
    const { session } = fakeSession();
    const view = render(<Owned session={session} options={[]} />);
    expect(view.container.querySelector('.tp-chat__model-picker')).toBeNull();
    expect(view.getByRole('button', { name: 'Tools' }).parentElement?.className).toBe(
      'tp-chat-input__trailing'
    );
  });

  it('stays usable and keeps its choice while a run is in progress', () => {
    const { session, set } = fakeSession();
    const view = render(<Owned session={session} />);
    const trigger = view.container.querySelector<HTMLButtonElement>('.tp-chat__model-picker')!;
    fireEvent.click(trigger);
    fireEvent.click(view.getByRole('option', { name: /Deep/ }));
    set({ status: 'running' });
    expect(view.container.querySelector('.tp-chat__model-picker')).toBe(trigger);
    expect(trigger.textContent).toBe('Deep');
    expect(trigger.disabled).toBe(false);
  });

  it('can be disabled by the app', () => {
    const { session } = fakeSession();
    const view = render(<Owned session={session} disabled />);
    const trigger = view.container.querySelector<HTMLButtonElement>('.tp-chat__model-picker')!;
    expect(trigger.disabled).toBe(true);
    fireEvent.click(trigger);
    expect(view.queryByRole('listbox')).toBeNull();
  });
});
