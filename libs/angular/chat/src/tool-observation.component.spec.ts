import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolObservationComponent } from './public-api';
afterEach(() => TestBed.resetTestingModule());
function setup(text: string) {
  const fixture = TestBed.createComponent(ToolObservationComponent);
  fixture.componentRef.setInput('name', 'weather');
  fixture.componentRef.setInput('argumentsText', text);
  fixture.detectChanges();
  return { fixture, root: fixture.nativeElement as HTMLElement };
}
describe('ToolObservationComponent', () => {
  it('renders a named observation with literal partial arguments, whitespace and wrapping', () => {
    const text = '  {"city":\n<img src=x onerror=alert(1)>  ';
    const { root } = setup(text);
    const section = root.querySelector('section');
    expect(section?.getAttribute('aria-label')).toBe('Tool observation');
    expect(section?.textContent).toContain('weather');
    expect(section?.textContent).toContain('Arguments');
    expect(getComputedStyle(root).overflowWrap).toBe('anywhere');
    const args = root.querySelector('pre');
    expect(args?.textContent).toBe(text);
    expect(getComputedStyle(args as HTMLElement).whiteSpace).toBe('pre-wrap');
    expect(getComputedStyle(args as HTMLElement).overflowWrap).toBe('anywhere');
    expect(
      root.querySelector(
        'img, button, [aria-live], [role="status"], [role="log"]'
      )
    ).toBeNull();
    expect(section?.textContent).not.toContain('Result');
  });
  it('keeps mounted section/arguments while adding empty result, updating literal text and removing result', () => {
    const { root, fixture } = setup('{"city":');
    const section = root.querySelector('section'),
      args = root.querySelector('pre');
    for (const result of ['', 'null', 'undefined', '<b>literal</b>']) {
      fixture.componentRef.setInput('argumentsText', '{"city":"Paris"}');
      fixture.componentRef.setInput('resultText', result);
      fixture.componentRef.setInput('label', 'Worker weather');
      fixture.detectChanges();
      expect(root.querySelector('section')).toBe(section);
      expect(root.querySelector('section')?.getAttribute('aria-label')).toBe(
        'Worker weather'
      );
      expect(root.querySelectorAll('pre')[0]).toBe(args);
      expect(root.querySelectorAll('pre')[1].textContent).toBe(result);
      expect(root.textContent).toContain('Result');
      expect(root.querySelector('b')).toBeNull();
    }
    fixture.componentRef.setInput('resultText', undefined);
    fixture.detectChanges();
    expect(root.querySelector('pre')).toBe(args);
    expect(root.querySelectorAll('pre')).toHaveLength(1);
    expect(root.textContent).not.toContain('Result');
    fixture.destroy();
    const next = setup('remounted');
    expect(next.root.querySelector('section')).not.toBe(section);
  });
});
