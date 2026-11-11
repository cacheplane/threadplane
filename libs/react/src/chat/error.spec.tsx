import { cleanup, fireEvent, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentError } from '@threadplane/core';
import * as chat from './index';

afterEach(cleanup);
const error = (
  recovery?: AgentError['recovery'],
  retryable = true
): AgentError =>
  Object.freeze({
    kind: 'server',
    message: '<img src=x onerror=alert(1)>',
    detail: '<script>literal</script> https://example.test',
    retryable,
    recovery,
  });

describe('ChatError', () => {
  it('exports the passive component from the existing chat entrypoint', () => {
    expect(chat).toHaveProperty('ChatError');
  });
  it.each([null, undefined])('renders nothing for %s', (value) => {
    const view = render(<chat.ChatError error={value} />);
    expect(view.container.childElementCount).toBe(0);
  });
  it('renders message and detail literally in one alert', () => {
    const value = error();
    const view = render(<chat.ChatError error={value} className="mine" />);
    expect(view.getAllByRole('alert')).toHaveLength(1);
    expect(view.getByRole('alert').textContent).toContain(value.message);
    expect(view.getByRole('alert').textContent).toContain(value.detail);
    expect(view.getByRole('alert').classList.contains('mine')).toBe(true);
    expect(view.container.querySelector('img, script, a')).toBeNull();
  });
  for (const recovery of [undefined, 'retry', 'check', 'none'] as const) {
    for (const retryable of [false, true]) {
      for (const retryAvailable of [false, true]) {
        for (const checkAvailable of [false, true]) {
          it(`selects recovery=${recovery}, retryable=${retryable}, retry=${retryAvailable}, check=${checkAvailable}`, () => {
            const retry = vi.fn();
            const check = vi.fn();
            const view = render(
              <chat.ChatError
                error={error(recovery, retryable)}
                onRetry={retryAvailable ? retry : undefined}
                onCheckStatus={checkAvailable ? check : undefined}
              />
            );
            const label =
              recovery === 'check'
                ? checkAvailable
                  ? 'Check status'
                  : null
                : recovery !== 'none' && retryable && retryAvailable
                ? 'Retry response'
                : null;
            const buttons = view.queryAllByRole('button');
            expect(buttons).toHaveLength(label ? 1 : 0);
            if (label) {
              fireEvent.click(view.getByRole('button', { name: label }));
              expect(
                label === 'Retry response' ? retry : check
              ).toHaveBeenCalledExactlyOnceWith();
            }
            expect(label === 'Retry response' ? check : retry).not.toHaveBeenCalled();
          });
        }
      }
    }
  }
  it.each(['retry', 'check'] as const)(
    'retains disabled %s without activation',
    (recovery) => {
      const request = vi.fn();
      const view = render(
        <chat.ChatError
          error={error(recovery)}
          disabled
          onRetry={request}
          onCheckStatus={request}
        />
      );
      const button = view.getByRole('button') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
      expect(request).not.toHaveBeenCalled();
    }
  );
  it('updates without dispatch or focus changes and unmounts inertly', () => {
    const request = vi.fn();
    const focus = document.activeElement;
    const view = render(
      <StrictMode>
        <chat.ChatError error={error('retry')} onRetry={request} />
      </StrictMode>
    );
    view.rerender(
      <StrictMode>
        <chat.ChatError
          error={{ kind: 'server', message: 'New', retryable: false }}
          onRetry={request}
        />
      </StrictMode>
    );
    expect(view.getByRole('alert').textContent).toBe('New');
    expect(view.queryByRole('button')).toBeNull();
    expect(document.activeElement).toBe(focus);
    view.rerender(<chat.ChatError error={null} />);
    expect(view.queryByRole('alert')).toBeNull();
    view.unmount();
    expect(request).not.toHaveBeenCalled();
  });
});
