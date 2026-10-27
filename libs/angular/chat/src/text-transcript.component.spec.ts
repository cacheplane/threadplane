import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { TextTranscriptComponent } from './public-api';

afterEach(() => TestBed.resetTestingModule());
const messages = Object.freeze([
  Object.freeze({ id: 'a', role: 'user', content: '  hello\nworld  ' }),
  Object.freeze({
    id: 'b',
    role: 'assistant',
    content: '<img src=x onerror=alert(1)>',
  }),
  Object.freeze({ id: 'empty', role: 'tool', content: '' }),
  Object.freeze({ id: 'policy', role: 'system', content: 'Policy' }),
]);
function setup() {
  const fixture = TestBed.createComponent(TextTranscriptComponent);
  fixture.componentRef.setInput('messages', messages);
  fixture.detectChanges();
  const root: HTMLElement = fixture.nativeElement;
  return { fixture, root, rows: () => Array.from(root.querySelectorAll('li')) };
}
describe('TextTranscriptComponent', () => {
  it('renders supplied literal text and speakers in a named section and ordered list', () => {
    const { root, rows } = setup();
    expect(root.querySelector('section')?.getAttribute('aria-label')).toBe(
      'Conversation'
    );
    expect(root.querySelector('section > ol')).not.toBeNull();
    expect(root.querySelector('ol')?.getAttribute('role')).toBe('list');
    expect(rows().map((row) => row.querySelector('p')?.textContent)).toEqual(
      messages.map((row) => row.content)
    );
    expect(rows().map((row) => row.querySelector('span')?.textContent)).toEqual(
      ['User', 'Assistant', 'Tool', 'System']
    );
    expect(root.querySelector('img')).toBeNull();
    expect(
      getComputedStyle(rows()[0].querySelector('p') as HTMLElement).whiteSpace
    ).toBe('pre-wrap');
    expect(
      getComputedStyle(rows()[0].querySelector('p') as HTMLElement).overflowWrap
    ).toBe('anywhere');
    expect(
      root.querySelector('[role="log"], [aria-live], [tabindex], button')
    ).toBeNull();
  });
  it('tracks mounted rows by ID through updates/reordering/deletion and leaves focus alone', () => {
    const focus = document.createElement('button');
    document.body.append(focus);
    focus.focus();
    try {
      const { fixture, root, rows } = setup();
      const prior = rows();
      const updated = [
        { ...messages[1], content: 'Updated' },
        messages[0],
        { id: 'new', role: 'user', content: 'Added' },
      ];
      fixture.componentRef.setInput('messages', updated);
      fixture.componentRef.setInput('label', 'Review');
      fixture.detectChanges();
      expect(rows()[0]).toBe(prior[1]);
      expect(rows()[1]).toBe(prior[0]);
      expect(rows()[0].textContent).toBe('AssistantUpdated');
      expect(prior[2].isConnected).toBe(false);
      expect(root.querySelector('section')?.getAttribute('aria-label')).toBe(
        'Review'
      );
      expect(document.activeElement).toBe(focus);
      expect(messages[1].content).toBe('<img src=x onerror=alert(1)>');
      fixture.destroy();
      const next = setup();
      expect(next.rows()[0]).not.toBe(prior[0]);
      expect(next.rows()[0].querySelector('p')?.textContent).toBe(
        messages[0].content
      );
    } finally {
      focus.remove();
    }
  });
  it('does not mutate another view when replacing its own rows', () => {
    const a = setup(),
      b = setup();
    a.fixture.componentRef.setInput('messages', []);
    a.fixture.detectChanges();
    expect(a.rows()).toHaveLength(0);
    expect(b.rows()).toHaveLength(4);
  });
});
