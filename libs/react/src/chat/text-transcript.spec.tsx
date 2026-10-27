import { cleanup, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TextTranscript, type TextTranscriptProps } from './index';

afterEach(cleanup);
const messages: TextTranscriptProps['messages'] = Object.freeze([
  Object.freeze({ id: 'a', role: 'user', content: '  hello\nworld  ' }),
  Object.freeze({
    id: 'b',
    role: 'assistant',
    content: '<img src=x onerror=alert(1)>',
  }),
  Object.freeze({ id: 'empty', role: 'tool', content: '' }),
  Object.freeze({ id: 'policy', role: 'system', content: 'Policy' }),
]);
describe('TextTranscript', () => {
  it('renders every supplied row as escaped text in a named ordered conversation', () => {
    const view = render(<TextTranscript messages={messages} />);
    const region = view.getByRole('region', { name: 'Conversation' });
    const list = within(region).getByRole('list');
    expect(list.tagName).toBe('OL');
    expect(list.getAttribute('role')).toBe('list');
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('p')?.textContent)).toEqual(
      messages.map((row) => row.content)
    );
    expect(rows.map((row) => row.querySelector('span')?.textContent)).toEqual([
      'User',
      'Assistant',
      'Tool',
      'System',
    ]);
    expect(region.querySelector('img')).toBeNull();
    expect(rows[0].querySelector('p')?.style.whiteSpace).toBe('pre-wrap');
    expect(rows[0].querySelector('p')?.style.overflowWrap).toBe('anywhere');
    expect(
      region.querySelector('[role="log"], [aria-live], [tabindex], button')
    ).toBeNull();
  });
  it('preserves keyed mounted nodes through changes, reordering and deletion without stealing focus', () => {
    const focus = document.createElement('button');
    document.body.append(focus);
    focus.focus();
    try {
      const view = render(
        <TextTranscript messages={messages} label="Review" />
      );
      const rows = view.getAllByRole('listitem');
      const updated = [
        { ...messages[1], content: 'Updated' },
        messages[0],
        { id: 'new', role: 'user' as const, content: 'Added' },
      ];
      view.rerender(<TextTranscript messages={updated} label="Review" />);
      const next = view.getAllByRole('listitem');
      expect(next[0]).toBe(rows[1]);
      expect(next[1]).toBe(rows[0]);
      expect(next[0].textContent).toBe('AssistantUpdated');
      expect(rows[2].isConnected).toBe(false);
      expect(document.activeElement).toBe(focus);
      expect(messages[1].content).toBe('<img src=x onerror=alert(1)>');
      view.unmount();
      const remounted = render(<TextTranscript messages={updated} />);
      expect(remounted.getAllByRole('listitem')[0]).not.toBe(next[0]);
      expect(remounted.getAllByRole('listitem')[0].textContent).toBe(
        'AssistantUpdated'
      );
    } finally {
      focus.remove();
    }
  });
  it('keeps separate views independent and accepts an empty conversation', () => {
    const a = render(<TextTranscript messages={messages} label="A" />);
    render(<TextTranscript messages={messages} label="B" />);
    a.rerender(<TextTranscript messages={[]} label="A" />);
    expect(
      within(a.getByRole('region', { name: 'A' })).queryAllByRole('listitem')
    ).toEqual([]);
    expect(
      within(a.getByRole('region', { name: 'B' })).getAllByRole('listitem')
    ).toHaveLength(4);
  });
});
