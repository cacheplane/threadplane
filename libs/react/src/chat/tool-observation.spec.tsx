import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolObservation } from './index';
afterEach(cleanup);
describe('ToolObservation', () => {
  it('renders a named observation with literal partial arguments, whitespace and wrapping', () => {
    const text = '  {"city":\n<img src=x onerror=alert(1)>  ';
    const view = render(
      <ToolObservation name="weather" argumentsText={text} />
    );
    const section = view.getByRole('region', { name: 'Tool observation' });
    expect(section.textContent).toContain('weather');
    expect(section.textContent).toContain('Arguments');
    expect(section.style.overflowWrap).toBe('anywhere');
    expect(section.querySelector('pre')?.textContent).toBe(text);
    expect(section.querySelector('pre')?.style.whiteSpace).toBe('pre-wrap');
    expect(section.querySelector('pre')?.style.overflowWrap).toBe('anywhere');
    expect(
      section.querySelector(
        'img, button, [aria-live], [role="status"], [role="log"]'
      )
    ).toBeNull();
    expect(section.textContent).not.toContain('Result');
  });
  it('keeps mounted section/arguments while adding empty result, updating literal text and removing result', () => {
    const view = render(
      <ToolObservation
        name="weather"
        argumentsText={'{"city":'}
        label="Worker weather"
      />
    );
    const section = view.getByRole('region', { name: 'Worker weather' }),
      args = section.querySelector('pre');
    for (const resultText of ['', 'null', 'undefined', '<b>literal</b>']) {
      view.rerender(
        <ToolObservation
          name="weather"
          argumentsText={'{"city":"Paris"}'}
          resultText={resultText}
          label="Worker weather"
        />
      );
      expect(view.getByRole('region', { name: 'Worker weather' })).toBe(
        section
      );
      expect(section.querySelectorAll('pre')[0]).toBe(args);
      expect(section.querySelectorAll('pre')[1].textContent).toBe(resultText);
      expect(section.textContent).toContain('Result');
      expect(section.querySelector('b')).toBeNull();
    }
    view.rerender(
      <ToolObservation
        name="weather"
        argumentsText="unchanged owner"
        label="Worker weather"
      />
    );
    expect(section.querySelector('pre')).toBe(args);
    expect(section.querySelectorAll('pre')).toHaveLength(1);
    expect(section.textContent).not.toContain('Result');
    view.unmount();
    const next = render(
      <ToolObservation name="weather" argumentsText="remounted" />
    );
    expect(next.getByRole('region')).not.toBe(section);
    expect(section.isConnected).toBe(false);
  });
});
