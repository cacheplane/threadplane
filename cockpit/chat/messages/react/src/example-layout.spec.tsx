import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
// eslint-disable-next-line @nx/enforce-module-boundaries -- The isolated consumer copies this internal example layout.
import { ExampleLayout } from '../../../../shared/react-example';

describe('example layout', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  it('follows keyboard and rotation viewport changes while preserving focus and pinch zoom', () => {
    const viewport = Object.assign(new EventTarget(), { height: 714, offsetTop: 0, scale: 1 });
    vi.stubGlobal('visualViewport', viewport);
    const { unmount } = render(<ExampleLayout footer={<textarea aria-label="Draft" />} />);
    const host = screen.getByRole('main');
    const input = screen.getByRole('textbox');
    input.focus();
    viewport.height = 377;
    fireEvent(viewport, new Event('resize'));
    expect(host.style.getPropertyValue('--example-viewport-height')).toBe('377px');
    expect(document.activeElement).toBe(input);
    viewport.offsetTop = 154;
    fireEvent(viewport, new Event('scroll'));
    expect(host.style.getPropertyValue('--example-viewport-top')).toBe('154px');
    viewport.height = 190;
    fireEvent(viewport, new Event('resize'));
    expect(host.style.getPropertyValue('--example-viewport-height')).toBe('190px');
    viewport.scale = 2;
    viewport.height = 95;
    fireEvent(viewport, new Event('resize'));
    expect(host.style.getPropertyValue('--example-viewport-height')).toBe('190px');
    viewport.scale = 1;
    viewport.height = 714;
    fireEvent(viewport, new Event('resize'));
    expect(host.style.getPropertyValue('--example-viewport-height')).toBe('714px');
    unmount();
    viewport.height = 300;
    fireEvent(viewport, new Event('resize'));
    expect(host.style.getPropertyValue('--example-viewport-height')).toBe('714px');
  });
  it('keeps the header and explicit footer in the conversation column beside the docs', () => {
    render(
      <ExampleLayout
        footer={<><textarea aria-label="Message" /><p role="status">Ready.</p></>}
        about={<><h3>Primitives used</h3><p>Message list and input</p></>}
      >
        <header><h1>Messages</h1></header>
        <p>Ask a question.</p>
        <ol aria-label="Conversation" />
      </ExampleLayout>
    );
    const header = screen.getByRole('banner');
    const footer = screen.getByRole('contentinfo');
    const docs = screen.getByRole('complementary');
    expect(header.parentElement).toBe(footer.parentElement);
    expect(header.parentElement?.parentElement).toBe(docs.parentElement);
    expect(footer.contains(screen.getByRole('textbox'))).toBe(true);
    expect(footer.contains(screen.getByRole('status'))).toBe(true);
    expect(docs.textContent).toContain('Ask a question.');
    expect(docs.textContent).toContain('Primitives used');
  });
  it('keeps application controls and live announcements outside explanatory content', () => {
    render(
      <ExampleLayout data-theme="dark" aria-label="Messages example">
        <header><h1>Messages</h1></header>
        <p>How this example works.</p>
        <button type="button">New conversation</button>
        <p role="status">Response saved.</p>
        <p role="alert">Try again.</p>
      </ExampleLayout>
    );
    const about = screen.getByRole('complementary', { name: 'About this example' });
    expect(about.textContent).toContain('How this example works.');
    expect(about.contains(screen.getByRole('status'))).toBe(false);
    expect(about.contains(screen.getByRole('alert'))).toBe(false);
    expect(about.contains(screen.getByRole('button'))).toBe(false);
    expect(screen.getByRole('heading', { name: 'Messages' })).toBeTruthy();
    expect(screen.getByRole('main', { name: 'Messages example' }).getAttribute('data-theme')).toBe('dark');
  });

  it('preserves application state across shell rerenders', () => {
    function Counter() {
      const [count, setCount] = useState(0);
      return <button onClick={() => setCount(count + 1)}>Count {count}</button>;
    }
    const { rerender } = render(<ExampleLayout><Counter /></ExampleLayout>);
    fireEvent.click(screen.getByRole('button', { name: 'Count 0' }));
    rerender(<ExampleLayout className="updated"><Counter /></ExampleLayout>);
    expect(screen.getByRole('button', { name: 'Count 1' })).toBeTruthy();
  });
});
