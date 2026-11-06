import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
// eslint-disable-next-line @nx/enforce-module-boundaries -- The isolated consumer copies this internal example layout.
import { ExampleLayout } from '../../../../shared/react-example';

describe('example layout', () => {
  afterEach(cleanup);
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
