import { StrictMode, useState } from 'react';
import { renderToString } from 'react-dom/server';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageRating, type MessageRatingValue } from './index';

afterEach(cleanup);

const pressed = (button: HTMLElement) => button.getAttribute('aria-pressed');

describe('MessageRating', () => {
  it('renders a named group of two native toggle buttons for one message', () => {
    const view = render(
      <MessageRating
        messageId="m-1"
        value={null}
        onValueChange={() => undefined}
        className="custom"
      />
    );
    const group = view.getByRole('group', { name: 'Rate response' });
    expect(group.className).toBe('tp-message-actions tp-message-rating custom');
    expect(group.getAttribute('data-message-id')).toBe('m-1');
    const buttons = view.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Good response',
      'Poor response',
    ]);
    for (const button of buttons) {
      expect(button.getAttribute('type')).toBe('button');
      expect(pressed(button)).toBe('false');
      expect(button.getAttribute('title')).toBe(button.textContent);
      const svg = button.querySelector('svg');
      expect(svg?.parentElement?.getAttribute('aria-hidden')).toBe('true');
      expect(svg?.getAttribute('focusable')).toBe('false');
    }
    expect(buttons.map((button) => button.dataset['rating'])).toEqual([
      'up',
      'down',
    ]);
  });

  it('reflects only the owner value and never changes it by itself', () => {
    const onValueChange = vi.fn();
    const view = render(
      <MessageRating messageId="m" value="up" onValueChange={onValueChange} />
    );
    const up = view.getByRole('button', { name: 'Good response' });
    const down = view.getByRole('button', { name: 'Poor response' });
    expect([pressed(up), pressed(down)]).toEqual(['true', 'false']);
    fireEvent.click(down);
    expect(onValueChange.mock.calls).toEqual([['down', 'm']]);
    // The owner has not accepted the request.
    expect([pressed(up), pressed(down)]).toEqual(['true', 'false']);
    view.rerender(
      <MessageRating messageId="m" value="down" onValueChange={onValueChange} />
    );
    expect([pressed(up), pressed(down)]).toEqual(['false', 'true']);
  });

  it('requests clearing when the current rating is pressed again', () => {
    const onValueChange = vi.fn();
    const view = render(
      <MessageRating messageId="m" value="down" onValueChange={onValueChange} />
    );
    fireEvent.click(view.getByRole('button', { name: 'Poor response' }));
    fireEvent.click(view.getByRole('button', { name: 'Good response' }));
    expect(onValueChange.mock.calls).toEqual([
      [null, 'm'],
      ['up', 'm'],
    ]);
  });

  it('reports the current message identity and callback after rerender', () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = render(
      <MessageRating messageId="a" value={null} onValueChange={first} />
    );
    view.rerender(
      <MessageRating messageId="b" value={null} onValueChange={second} />
    );
    fireEvent.click(view.getByRole('button', { name: 'Good response' }));
    expect(first).not.toHaveBeenCalled();
    expect(second.mock.calls).toEqual([['up', 'b']]);
    expect(view.getByRole('group').getAttribute('data-message-id')).toBe('b');
  });

  it('disables both options and requests nothing while disabled', () => {
    const onValueChange = vi.fn();
    const view = render(
      <MessageRating
        messageId="m"
        value="up"
        onValueChange={onValueChange}
        disabled
      />
    );
    for (const button of view.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(button);
    }
    expect(onValueChange).not.toHaveBeenCalled();
    // The accepted rating stays visible while disabled.
    expect(pressed(view.getByRole('button', { name: 'Good response' }))).toBe(
      'true'
    );
  });

  it('uses literal owner labels for the group and both options', () => {
    const view = render(
      <MessageRating
        messageId="m"
        value={null}
        onValueChange={() => undefined}
        label="Feedback <b>"
        upLabel="Helpful <i>"
        downLabel="Not helpful"
      />
    );
    expect(view.getByRole('group', { name: 'Feedback <b>' })).toBeTruthy();
    const up = view.getByRole('button', { name: 'Helpful <i>' });
    expect(up.querySelector('i')).toBeNull();
    expect(up.getAttribute('title')).toBe('Helpful <i>');
    expect(view.getByRole('button', { name: 'Not helpful' })).toBeTruthy();
  });

  it('works as an owner-controlled toggle under StrictMode with one request per click', () => {
    const requests: Array<[MessageRatingValue | null, string]> = [];
    function Owner() {
      const [value, setValue] = useState<MessageRatingValue | null>(null);
      return (
        <MessageRating
          messageId="m"
          value={value}
          onValueChange={(next, id) => {
            requests.push([next, id]);
            setValue(next);
          }}
        />
      );
    }
    const view = render(
      <StrictMode>
        <Owner />
      </StrictMode>
    );
    const up = view.getByRole('button', { name: 'Good response' });
    const down = view.getByRole('button', { name: 'Poor response' });
    fireEvent.click(up);
    expect([pressed(up), pressed(down)]).toEqual(['true', 'false']);
    fireEvent.click(down);
    expect([pressed(up), pressed(down)]).toEqual(['false', 'true']);
    fireEvent.click(down);
    expect([pressed(up), pressed(down)]).toEqual(['false', 'false']);
    expect(requests).toEqual([
      ['up', 'm'],
      ['down', 'm'],
      [null, 'm'],
    ]);
  });

  it('keeps focus on the pressed option and toggles from the keyboard as a native button', () => {
    const view = render(
      <MessageRating
        messageId="m"
        value={null}
        onValueChange={() => undefined}
      />
    );
    const up = view.getByRole('button', { name: 'Good response' });
    up.focus();
    fireEvent.click(up);
    expect(document.activeElement).toBe(up);
    expect(up.tabIndex).toBe(0);
  });

  it('server renders the controlled state without effects', () => {
    const html = renderToString(
      <MessageRating messageId="m" value="up" onValueChange={() => undefined} />
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('data-message-id="m"');
  });
});
