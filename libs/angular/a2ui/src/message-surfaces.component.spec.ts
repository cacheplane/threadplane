import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  A2uiMessageSurfacesComponent,
  a2uiRenderer,
} from './message-surfaces.component';
import { a2uiBasicCatalog } from './catalog/index';

const surface = (id: string, text: string) =>
  JSON.stringify({ version: 'v0.9', createSurface: { surfaceId: id, catalogId: 'basic' } }) +
  '\n' +
  JSON.stringify({
    version: 'v0.9',
    updateComponents: { surfaceId: id, components: [{ id: 'root', component: 'Text', text }] },
  }) +
  '\n';

function render(source: string) {
  const fixture = TestBed.createComponent(A2uiMessageSurfacesComponent);
  fixture.componentRef.setInput('source', source);
  fixture.detectChanges();
  return fixture;
}

describe('A2uiMessageSurfacesComponent', () => {
  it('parses the message source and renders one surface per surface id', () => {
    const fixture = render(surface('s1', 'Hello') + surface('s2', 'World'));
    const surfaces = fixture.nativeElement.querySelectorAll('a2ui-surface');
    expect(surfaces.length).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('Hello');
    expect(fixture.nativeElement.textContent).toContain('World');
  });

  it('parses only what a streaming source adds, and starts over on a replacement', () => {
    const fixture = render(surface('s1', 'First').slice(0, 40));
    expect(fixture.nativeElement.querySelectorAll('a2ui-surface').length).toBe(0);
    fixture.componentRef.setInput('source', surface('s1', 'First'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('First');
    fixture.componentRef.setInput('source', surface('s9', 'Replaced'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('First');
    expect(fixture.nativeElement.textContent).toContain('Replaced');
  });

  it('keeps the surfaces parsed so far when the source turns malformed', () => {
    const fixture = render(surface('s1', 'Kept'));
    fixture.componentRef.setInput('source', surface('s1', 'Kept') + '{not json}\n');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Kept');
  });

  it('forwards render events with its message index and the surface id', () => {
    const emitEvent = vi.fn();
    const fixture = TestBed.createComponent(A2uiMessageSurfacesComponent);
    fixture.componentRef.setInput('source', surface('s1', 'Hi'));
    fixture.componentRef.setInput('messageIndex', 3);
    fixture.componentRef.setInput('emitEvent', emitEvent);
    fixture.detectChanges();
    const event = { type: 'click' } as never;
    (fixture.componentInstance as unknown as { onEvent(e: unknown, id: string): void }).onEvent(event, 's1');
    expect(emitEvent).toHaveBeenCalledWith(event, 3, 's1');
  });
});

describe('a2uiRenderer', () => {
  it('builds the chat renderer around the surfaces component and its options', () => {
    const catalog = a2uiBasicCatalog();
    expect(a2uiRenderer()).toEqual({ component: A2uiMessageSurfacesComponent, options: undefined });
    expect(a2uiRenderer({ catalog })).toEqual({
      component: A2uiMessageSurfacesComponent,
      options: { catalog },
    });
  });
});
