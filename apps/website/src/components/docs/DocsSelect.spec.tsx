import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DocsSelect } from './DocsSelect';

afterEach(cleanup);
function Picker() {
  const [value, setValue] = useState('angular');
  return (
    <DocsSelect
      label="Framework"
      value={value}
      onChange={setValue}
      options={[
        { value: 'all', label: 'All frameworks' },
        { value: 'angular', label: 'Angular' },
        { value: 'react', label: 'React' },
      ]}
    />
  );
}

describe('DocsSelect', () => {
  it('opens at the selected item, navigates with arrows and typeahead, and restores focus on selection', () => {
    render(<Picker />);
    const trigger = screen.getByRole('button', { name: 'Framework' });
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(
      screen.getByRole('menuitemradio', { name: 'Angular' })
    );
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(
      screen.getByRole('menuitemradio', { name: 'React' })
    );
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(
      screen.getByRole('menuitemradio', { name: 'All frameworks' })
    );
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(
      screen.getByRole('menuitemradio', { name: 'React' })
    );
    fireEvent.keyDown(document.activeElement!, { key: 'a' });
    expect(document.activeElement).toBe(
      screen.getByRole('menuitemradio', { name: 'All frameworks' })
    );
    fireEvent.keyDown(document.activeElement!, { key: 'n' });
    expect(document.activeElement).toBe(
      screen.getByRole('menuitemradio', { name: 'Angular' })
    );
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'React' }));
    expect(trigger.textContent).toContain('React');
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(trigger);
    expect(
      screen
        .getByRole('menuitemradio', { name: 'React' })
        .getAttribute('aria-checked')
    ).toBe('true');
  });

  it('supports arrow opening, Escape, Tab, and outside dismissal without wrapping the menu in a label', () => {
    render(<Picker />);
    const trigger = screen.getByRole('button', { name: 'Framework' });
    fireEvent.keyDown(trigger, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(
      screen.getByRole('menuitemradio', { name: 'React' })
    );
    expect(screen.getByRole('menu').closest('label')).toBeNull();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(
      screen.getByRole('menuitemradio', { name: 'All frameworks' })
    );
    expect(fireEvent.keyDown(document.activeElement!, { key: 'Tab' })).toBe(
      true
    );
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
