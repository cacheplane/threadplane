import { cleanup, fireEvent, render } from '@testing-library/react';
import { createRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatInput, type ChatInputHandle } from './index';
afterEach(cleanup);
const box = (view: ReturnType<typeof render>) =>
  view.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
const type = (el: HTMLTextAreaElement, value: string) =>
  fireEvent.change(el, { target: { value } });

describe('ChatInput', () => {
  it('Enter submits the draft as typed and clears; Shift+Enter does not', () => {
    const onSubmit = vi.fn();
    const view = render(<ChatInput onSubmit={onSubmit} />);
    const el = box(view);
    type(el, '  hello \n');
    fireEvent.keyDown(el, { key: 'Enter', shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('  hello \n');
    expect(el.value).toBe('');
  });

  it('never submits while isComposing is true', () => {
    const onSubmit = vi.fn();
    const view = render(<ChatInput onSubmit={onSubmit} />);
    const el = box(view);
    type(el, 'こんにちは');
    fireEvent.keyDown(el, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(el, { key: 'Enter', ctrlKey: true, isComposing: true });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(el.value).toBe('こんにちは');
  });

  it('never submits on keyCode 229', () => {
    const onSubmit = vi.fn();
    const view = render(<ChatInput onSubmit={onSubmit} />);
    const el = box(view);
    type(el, 'こんにちは');
    fireEvent.keyDown(el, { key: 'Enter', keyCode: 229 });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(el.value).toBe('こんにちは');
  });

  it('refuses whitespace, busy and disabled; Send disabled accordingly', () => {
    const onSubmit = vi.fn();
    const view = render(<ChatInput onSubmit={onSubmit} />);
    const send = view.getByRole('button', { name: 'Send' });
    type(box(view), '   ');
    expect(send).toHaveProperty('disabled', true);
    fireEvent.keyDown(box(view), { key: 'Enter' });
    view.rerender(<ChatInput onSubmit={onSubmit} busy />);
    type(box(view), 'x');
    fireEvent.keyDown(box(view), { key: 'Enter' });
    fireEvent.click(send);
    view.rerender(<ChatInput onSubmit={onSubmit} disabled />);
    expect(box(view).disabled).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('busy renders Stop (with onStop) next to a disabled Send; textarea stays editable', () => {
    const onStop = vi.fn();
    const view = render(
      <ChatInput onSubmit={() => undefined} busy onStop={onStop} />
    );
    fireEvent.click(view.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledOnce();
    expect(view.getByRole('button', { name: 'Send' })).toHaveProperty(
      'disabled',
      true
    );
    expect(box(view).disabled).toBe(false);
    view.rerender(<ChatInput onSubmit={() => undefined} busy />);
    expect(view.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('onSubmit returning false keeps the draft', () => {
    const view = render(<ChatInput onSubmit={() => false} />);
    type(box(view), 'keep');
    fireEvent.click(view.getByRole('button', { name: 'Send' }));
    expect(box(view).value).toBe('keep');
  });

  it('submitOnEnter={false}: Enter is a newline, Ctrl/Meta+Enter submits', () => {
    const onSubmit = vi.fn();
    const view = render(
      <ChatInput onSubmit={onSubmit} submitOnEnter={false} />
    );
    type(box(view), 'a');
    fireEvent.keyDown(box(view), { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(box(view), { key: 'Enter', ctrlKey: true });
    type(box(view), 'b');
    fireEvent.keyDown(box(view), { key: 'Enter', metaKey: true });
    expect(onSubmit.mock.calls).toEqual([['a'], ['b']]);
  });

  it('supports a controlled draft', () => {
    const seen: string[] = [];
    function Host() {
      const [value, setValue] = useState('start');
      return (
        <ChatInput
          value={value}
          onValueChange={(next) => {
            seen.push(next);
            setValue(next);
          }}
          onSubmit={() => undefined}
        />
      );
    }
    const view = render(<Host />);
    expect(box(view).value).toBe('start');
    type(box(view), 'next');
    fireEvent.keyDown(box(view), { key: 'Enter' });
    expect(seen).toEqual(['next', '']);
    expect(box(view).value).toBe('');
  });

  it('uses defaultValue, label, placeholder and hint wiring', () => {
    const view = render(
      <ChatInput
        onSubmit={() => undefined}
        defaultValue="draft"
        label="Ask"
        placeholder="Type here"
        hint="Enter to send"
      />
    );
    const el = view.getByRole('textbox', {
      name: 'Ask',
    }) as HTMLTextAreaElement;
    expect(el.value).toBe('draft');
    expect(el.placeholder).toBe('Type here');
    const hint = document.getElementById(
      el.getAttribute('aria-describedby') ?? ''
    );
    expect(hint?.textContent).toBe('Enter to send');
  });

  it('exposes focus() through its ref', () => {
    const ref = createRef<ChatInputHandle>();
    const view = render(<ChatInput ref={ref} onSubmit={() => undefined} />);
    ref.current?.focus();
    expect(document.activeElement).toBe(box(view));
  });

  it('returns focus to the textarea on the next frame after a clearing submit', () => {
    const raf = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb) => {
        cb(0);
        return 0;
      });
    const view = render(
      <div>
        <button type="button">elsewhere</button>
        <ChatInput onSubmit={() => undefined} />
      </div>
    );
    type(box(view), 'hi');
    view.getByRole('button', { name: 'elsewhere' }).focus();
    expect(document.activeElement).not.toBe(box(view));
    fireEvent.click(view.getByRole('button', { name: 'Send' }));
    expect(document.activeElement).toBe(box(view));
    raf.mockRestore();
  });

  it('auto-resizes to content, capped at min(40vh, 320px)', () => {
    const view = render(<ChatInput onSubmit={() => undefined} />);
    const el = box(view);
    const height = vi.spyOn(el, 'scrollHeight', 'get');
    const inner = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(500);
    height.mockReturnValue(1000);
    type(el, 'a');
    expect(el.style.height).toBe('200px');
    height.mockReturnValue(50);
    type(el, 'ab');
    expect(el.style.height).toBe('50px');
    inner.mockRestore();
    height.mockRestore();
  });

  it('a disabled input cannot submit via Ctrl+Enter or form submit', () => {
    const onSubmit = vi.fn();
    const view = render(
      <ChatInput onSubmit={onSubmit} defaultValue="x" disabled />
    );
    fireEvent.keyDown(box(view), { key: 'Enter', ctrlKey: true });
    fireEvent.submit(box(view).closest('form') as HTMLFormElement);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('renders no hint wiring for hint={false}', () => {
    const view = render(<ChatInput onSubmit={() => undefined} hint={false} />);
    expect(box(view).getAttribute('aria-describedby')).toBeNull();
    expect(view.container.querySelector('.tp-chat-input__hint')).toBeNull();
  });

  it('calls onValueChange in uncontrolled mode', () => {
    const onValueChange = vi.fn();
    const view = render(
      <ChatInput onSubmit={() => undefined} onValueChange={onValueChange} />
    );
    type(box(view), 'q');
    expect(onValueChange).toHaveBeenCalledWith('q');
    expect(box(view).value).toBe('q');
  });
});
