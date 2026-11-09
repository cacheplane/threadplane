import { cleanup, fireEvent, render } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as chat from './index';

afterEach(cleanup);

describe('ChatMessage', () => {
  for (const role of ['assistant', 'user', 'system', 'tool'] as const) {
    for (const current of [undefined, false, true]) {
      for (const streaming of [undefined, false, true]) {
        it(`gates the passive caret for ${role}/${current}/${streaming}`, () => {
          const view = render(
            <chat.ChatMessage
              role={role}
              current={current}
              streaming={streaming}
              beforeContent={<aside>Before</aside>}
              afterContent={<aside>After</aside>}
              controls={0}
            >
              <b>Body</b>
            </chat.ChatMessage>
          );
          const article = view.getByRole('article');
          expect(article.getAttribute('data-current')).toBe(
            String(current ?? false)
          );
          expect(article.getAttribute('data-streaming')).toBe(
            String(streaming ?? false)
          );
          const body = article.querySelector('.tp-chat-message__body')!;
          const carets = article.querySelectorAll('.tp-chat-message__caret');
          expect(carets).toHaveLength(
            role === 'assistant' && current && streaming ? 1 : 0
          );
          if (carets.length) {
            expect(body.lastElementChild).toBe(carets[0]);
            expect(carets[0].previousElementSibling?.textContent).toBe('Body');
            expect(carets[0].getAttribute('aria-hidden')).toBe('true');
            expect(carets[0].tagName).toBe('SPAN');
            expect(carets[0].textContent).toBe('');
          }
          expect(body.getAttribute('dir')).toBe('auto');
          expect(body.previousElementSibling?.textContent).toBe('Before');
          expect(body.nextElementSibling?.textContent).toBe('After');
          expect(article.lastElementChild?.textContent).toBe('0');
          expect(
            article.querySelector('[aria-live],[role="status"],[role="alert"]')
          ).toBeNull();
        });
      }
    }
  }
  it('shows one empty caret for an empty current streaming assistant body', () => {
    const view = render(
      <chat.ChatMessage role="assistant" current streaming />
    );
    const body = view.container.querySelector('.tp-chat-message__body')!;
    expect(body.children).toHaveLength(1);
    expect(body.firstElementChild?.className).toBe('tp-chat-message__caret');
    expect(body.textContent).toBe('');
  });
  it('renders passive before/after content once as direct article children around only the text body', () => {
    const action = vi.fn();
    const view = render(
      <chat.ChatMessage
        role="assistant"
        beforeContent={<button onClick={action}>Before</button>}
        afterContent={<aside>After</aside>}
        controls={<button onClick={action}>Control</button>}
      >
        Text
      </chat.ChatMessage>
    );
    const article = view.getByRole('article');
    const body = article.querySelector('.tp-chat-message__body');
    const before = view.getByRole('button', { name: 'Before' });
    const after = view.getByText('After');
    expect(before.parentElement).toBe(article);
    expect(after.parentElement).toBe(article);
    expect(before.nextElementSibling).toBe(body);
    expect(body?.nextElementSibling).toBe(after);
    expect(after.nextElementSibling?.className).toBe(
      'tp-chat-message__controls'
    );
    expect(body?.textContent).toBe('Text');
    expect(view.getAllByText('After')).toHaveLength(1);
    expect(article.children).toHaveLength(5);
    expect(action).not.toHaveBeenCalled();
    view.unmount();
    expect(action).not.toHaveBeenCalled();
  });
  for (const slot of ['beforeContent', 'afterContent'] as const) {
    for (const [value, text] of [
      [null, 'Text'],
      [false, 'Text'],
      [true, 'Text'],
      [0, '0Text'],
      [['<b>literal</b>', 0], '<b>literal</b>0Text'],
    ] as const) {
      it(`keeps normal ReactNode semantics and no wrapper for ${slot} ${JSON.stringify(
        value
      )}`, () => {
        const view = render(
          <chat.ChatMessage role="system" {...{ [slot]: value }}>
            Text
          </chat.ChatMessage>
        );
        const article = view.getByRole('article');
        expect(article.children).toHaveLength(1);
        expect(article.firstElementChild?.className).toBe(
          'tp-chat-message__body'
        );
        const expected =
          slot === 'beforeContent' ? text : 'Text' + text.slice(0, -4);
        expect(article.textContent).toBe(expected);
        expect(article.querySelector('b')).toBeNull();
      });
    }
  }
  it('exports a passive presentation function', () => {
    expect('ChatMessage' in chat).toBe(true);
  });
  for (const [role, speaker] of [
    ['user', 'You:'],
    ['assistant', 'Assistant:'],
    ['system', null],
    ['tool', null],
  ] as const) {
    it(`presents ${role} with one named article and an independent body direction`, () => {
      const view = render(
        <chat.ChatMessage role={role} className="mine">
          مرحبا **literal**
        </chat.ChatMessage>
      );
      const article = view.getByRole('article', { name: `${role} message` });
      expect(article.className).toBe(
        `tp-chat-message tp-chat-message--${role} mine`
      );
      expect(view.getAllByRole('article')).toHaveLength(1);
      const body = article.querySelector('.tp-chat-message__body')!;
      expect(body.getAttribute('dir')).toBe('auto');
      expect(body.textContent).toBe('مرحبا **literal**');
      const label = article.querySelector('.tp-chat-message__speaker');
      expect(label?.textContent ?? null).toBe(speaker);
      if (label) expect(label.tagName).toBe('SPAN');
      expect(article.querySelector('strong')).toBeNull();
    });
  }
  it('uses literal custom labels and speakers and suppresses an empty speaker', () => {
    const view = render(
      <chat.ChatMessage role="tool" speaker="<b>Tool</b>" label="<img>result" />
    );
    const article = view.getByRole('article', { name: '<img>result' });
    expect(
      article.querySelector('.tp-chat-message__speaker')?.textContent
    ).toBe('<b>Tool</b>:');
    expect(article.querySelector('img,b')).toBeNull();
    view.rerender(<chat.ChatMessage role="assistant" speaker="" label="" />);
    expect(
      view
        .getByRole('article', { name: '' })
        .querySelector('.tp-chat-message__speaker')
    ).toBeNull();
  });
  it('renders each slot once, with controls after the body and explicit consumer activation', () => {
    const action = vi.fn();
    const Child = () => <p>Body child</p>;
    const Control = () => <button onClick={action}>Copy</button>;
    const view = render(
      <chat.ChatMessage role="assistant" controls={<Control />}>
        <Child />
      </chat.ChatMessage>
    );
    const article = view.getByRole('article');
    expect(article.querySelectorAll('.tp-chat-message__body')).toHaveLength(1);
    expect(view.getAllByText('Body child')).toHaveLength(1);
    expect(view.getAllByRole('button')).toHaveLength(1);
    expect(article.lastElementChild?.className).toBe(
      'tp-chat-message__controls'
    );
    expect(article.lastElementChild?.previousElementSibling?.className).toBe(
      'tp-chat-message__body'
    );
    expect(action).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button'));
    expect(action).toHaveBeenCalledOnce();
  });
  for (const controls of [undefined, null, false, true]) {
    it(`omits the controls wrapper for ${String(controls)}`, () => {
      const view = render(<chat.ChatMessage role="user" controls={controls} />);
      expect(
        view.container.querySelector('.tp-chat-message__controls')
      ).toBeNull();
    });
  }
  for (const controls of [
    0,
    '',
    [],
    [false, 0, 'Action'],
  ] satisfies ReactNode[]) {
    it(`retains normal ReactNode controls semantics for ${JSON.stringify(
      controls
    )}`, () => {
      const view = render(<chat.ChatMessage role="user" controls={controls} />);
      expect(
        view.container.querySelectorAll('.tp-chat-message__controls')
      ).toHaveLength(1);
      if (controls === 0)
        expect(
          view.container.querySelector('.tp-chat-message__controls')
            ?.textContent
        ).toBe('0');
    });
  }
  it('is inert during SSR, StrictMode updates and unmount with no live region or focus movement', () => {
    const action = vi.fn();
    const controls = <button onClick={action}>Action</button>;
    expect(
      renderToString(
        <chat.ChatMessage
          role="assistant"
          beforeContent={controls}
          afterContent={controls}
          controls={controls}
        >
          SSR
        </chat.ChatMessage>
      )
    ).toContain('dir="auto"');
    const focus = document.createElement('input');
    document.body.append(focus);
    focus.focus();
    const view = render(
      <StrictMode>
        <chat.ChatMessage
          role="user"
          beforeContent={controls}
          afterContent={controls}
          controls={controls}
        >
          First
        </chat.ChatMessage>
      </StrictMode>
    );
    view.rerender(
      <StrictMode>
        <chat.ChatMessage
          role="assistant"
          beforeContent={controls}
          afterContent={controls}
          controls={controls}
        >
          Next
        </chat.ChatMessage>
      </StrictMode>
    );
    expect(
      view.container.querySelector(
        '[aria-live],[role="status"],[role="alert"],[tabindex]'
      )
    ).toBeNull();
    expect(document.activeElement).toBe(focus);
    view.unmount();
    expect(document.activeElement).toBe(focus);
    expect(action).not.toHaveBeenCalled();
    focus.remove();
  });
});
