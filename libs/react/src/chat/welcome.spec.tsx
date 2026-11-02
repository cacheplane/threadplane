import { useState, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as chat from './index';

const { Welcome, WelcomeSuggestion } = chat;

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('Welcome', () => {
  it('exports both presentation primitives from the chat entrypoint', () => {
    expect(Welcome).toBeTypeOf('function');
    expect(WelcomeSuggestion).toBeTypeOf('function');
  });

  it('renders the default h2, content, suggestions and consumer class', () => {
    const view = render(
      <Welcome className="custom" suggestions={<span>Suggestions</span>}>
        <textarea aria-label="Draft" />
      </Welcome>
    );
    expect(view.getByRole('heading', { level: 2 }).textContent).toBe(
      'How can I help?'
    );
    expect(view.getByRole('textbox')).toBeTruthy();
    expect(view.getByText('Suggestions')).toBeTruthy();
    expect(view.container.firstElementChild?.classList.contains('custom')).toBe(
      true
    );
  });

  it('lets a custom title own its semantics', () => {
    const view = render(<Welcome title={<h3>Start here</h3>} />);
    expect(view.getByRole('heading', { level: 3 }).textContent).toBe(
      'Start here'
    );
    expect(view.queryByText('How can I help?')).toBeNull();
  });

  it.each([null, false])(
    'explicitly omits title and suggestions for %s',
    (empty) => {
      const view = render(<Welcome title={empty} suggestions={empty} />);
      expect(view.container.textContent).toBe('');
      expect(view.queryByRole('heading')).toBeNull();
    }
  );

  it('defaults only an undefined title and honors numeric zero slots', () => {
    const view = render(<Welcome title={undefined} suggestions={undefined} />);
    expect(view.getByRole('heading', { level: 2 })).toBeTruthy();
    view.rerender(
      <Welcome title={0} suggestions={0}>
        {0}
      </Welcome>
    );
    expect(view.container.textContent).toBe('000');
    expect(view.queryByRole('heading')).toBeNull();
    view.rerender(<Welcome title="" suggestions="" />);
    expect(view.container.textContent).toBe('');
  });

  it('preserves stateful content and keyed ownership across independent slot changes', () => {
    function Draft({ name }: { readonly name: string }) {
      const [value, setValue] = useState(name);
      return (
        <input
          aria-label={name}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      );
    }
    const content = (reverse = false) =>
      (reverse ? ['Beta', 'Alpha'] : ['Alpha', 'Beta']).map((name) => (
        <Draft key={name} name={name} />
      ));
    const view = render(<Welcome suggestions="Choices">{content()}</Welcome>);
    const alpha = view.getByRole('textbox', {
      name: 'Alpha',
    }) as HTMLInputElement;
    fireEvent.change(alpha, { target: { value: 'Retained draft' } });
    alpha.focus();
    const slots: readonly [ReactNode, ReactNode][] = [
      [null, 'Choices'],
      [null, null],
      [<h3 key="custom">Custom</h3>, null],
      [undefined, false],
      [false, <span key="choices">New choices</span>],
    ];
    for (const [title, suggestions] of slots) {
      view.rerender(
        <Welcome title={title} suggestions={suggestions}>
          {content(true)}
        </Welcome>
      );
      expect(view.getByRole('textbox', { name: 'Alpha' })).toBe(alpha);
      expect(alpha.value).toBe('Retained draft');
      expect(document.activeElement).toBe(alpha);
      expect(view.getAllByRole('textbox')[1]).toBe(alpha);
    }
  });

  it('imports and deterministically server renders without DOM globals or requests', async () => {
    const onSelect = vi.fn();
    const request = vi.fn(() => {
      throw new Error('Unexpected request');
    });
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('fetch', request);
    vi.resetModules();
    try {
      const entry = await import('./index');
      const tree = (
        <entry.Welcome
          suggestions={
            <entry.WelcomeSuggestion
              label="<b>Literal</b>"
              value=" raw "
              onSelect={onSelect}
            />
          }
        >
          <textarea aria-label="Draft" defaultValue="Kept" />
        </entry.Welcome>
      );
      const html = renderToString(tree);
      expect(renderToString(tree)).toBe(html);
      expect(html).toContain('<h2');
      expect(html).toContain('How can I help?');
      expect(html).toContain('&lt;b&gt;Literal&lt;/b&gt;');
      expect(html).toContain('type="button"');
      expect(onSelect).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('WelcomeSuggestion', () => {
  it('renders literal labels and descriptions with decorative icon and chevron', () => {
    const view = render(
      <WelcomeSuggestion
        label="<b>Literal</b>"
        value="raw"
        description="<img src=x>"
        icon={<svg role="img" aria-label="Decorative icon" />}
        onSelect={() => undefined}
        className="custom"
      />
    );
    const button = view.getByRole('button', { name: '<b>Literal</b>' });
    expect(button.getAttribute('title')).toBe('<img src=x>');
    expect(button.getAttribute('aria-description')).toBe('<img src=x>');
    expect(button.classList.contains('custom')).toBe(true);
    expect(button.querySelector('b, img')).toBeNull();
    expect(view.queryByRole('img')).toBeNull();
    expect(
      button.querySelector('svg')?.closest('[aria-hidden="true"]')
    ).toBeTruthy();
    expect(
      button
        .querySelector('.tp-welcome-suggestion__chevron')
        ?.getAttribute('aria-hidden')
    ).toBe('true');
  });

  it('emits only the exact raw value without implicit form submission or selection state', () => {
    const onSelect = vi.fn();
    const submit = vi.fn((event) => event.preventDefault());
    const view = render(
      <form onSubmit={submit}>
        <WelcomeSuggestion
          label="Select"
          value={'  <raw>\n '}
          onSelect={onSelect}
        />
      </form>
    );
    const button = view.getByRole('button');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.hasAttribute('title')).toBe(false);
    expect(button.hasAttribute('aria-description')).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(onSelect.mock.calls).toEqual([['  <raw>\n ']]);
    expect(submit).not.toHaveBeenCalled();
    expect(button.hasAttribute('aria-pressed')).toBe(false);
    expect(button.hasAttribute('aria-selected')).toBe(false);
  });

  it.each([true, false, undefined, 'true', 1, {}, []].map((value) => [value]))(
    'disables only strict true: %s',
    (disabled) => {
      const onSelect = vi.fn();
      const view = render(
        <WelcomeSuggestion
          label="Select"
          value="raw"
          onSelect={onSelect}
          disabled={disabled as boolean}
        />
      );
      const button = view.getByRole('button') as HTMLButtonElement;
      expect(button.disabled).toBe(disabled === true);
      fireEvent.click(button);
      expect(onSelect.mock.calls).toEqual(disabled === true ? [] : [['raw']]);
    }
  );

  it('honors a click claimed by an ancestor capture handler', () => {
    const onSelect = vi.fn();
    const view = render(
      <div onClickCapture={(event) => event.preventDefault()}>
        <WelcomeSuggestion label="Select" value="raw" onSelect={onSelect} />
      </div>
    );
    fireEvent.click(view.getByRole('button'));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
