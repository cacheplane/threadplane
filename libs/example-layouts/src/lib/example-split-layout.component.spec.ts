import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ExampleSplitLayoutComponent } from './example-split-layout.component';

@Component({
  standalone: true,
  imports: [ExampleSplitLayoutComponent],
  template: `
    <example-split-layout>
      <div header data-testid="header">Header</div>
      <div primary data-testid="primary">Primary</div>
      <div secondary data-testid="secondary">Secondary</div>
      <div footer data-testid="footer">Footer</div>
    </example-split-layout>
  `,
})
class TestHostComponent {}

@Component({
  standalone: true,
  imports: [ExampleSplitLayoutComponent],
  template: `
    <example-split-layout title="Render Spec" description="Watch a local sample render.">
      <div header data-testid="toolbar">Playback controls</div>
      <div primary>Rendered output</div>
      <div secondary data-testid="source">JSON source</div>
    </example-split-layout>
  `,
})
class ChromeHostComponent {}

describe('ExampleSplitLayoutComponent', () => {
  it('keeps the title and playback controls beside documentation and source', async () => {
    await TestBed.configureTestingModule({ imports: [ChromeHostComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ChromeHostComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.split__main h1')?.textContent).toBe('Render Spec');
    expect(el.querySelector('.split__main [data-testid="toolbar"]')).toBeTruthy();
    expect(el.querySelector('.split__about p')?.textContent).toBe('Watch a local sample render.');
    expect(el.querySelector('.split__secondary [data-testid="source"]')).toBeTruthy();
  });

  it('should render all four content slots', async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="header"]')?.textContent).toBe('Header');
    expect(el.querySelector('[data-testid="primary"]')?.textContent).toBe('Primary');
    expect(el.querySelector('[data-testid="secondary"]')?.textContent).toBe('Secondary');
    expect(el.querySelector('[data-testid="footer"]')?.textContent).toBe('Footer');
  });

  it('should render .split__body container', async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.split__body')).toBeTruthy();
  });

  it('should render .split__header containing header slot', async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const headerContainer = el.querySelector('.split__header');
    expect(headerContainer).toBeTruthy();
    expect(headerContainer?.querySelector('[data-testid="header"]')).toBeTruthy();
  });

  it('should render .split__primary and .split__secondary containers', async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const primary = el.querySelector('.split__primary');
    expect(primary).toBeTruthy();
    expect(primary?.querySelector('[data-testid="primary"]')).toBeTruthy();

    const secondary = el.querySelector('.split__secondary');
    expect(secondary).toBeTruthy();
    expect(secondary?.querySelector('[data-testid="secondary"]')).toBeTruthy();
  });

  it('should render .split__footer containing footer slot', async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const footer = el.querySelector('.split__footer');
    expect(footer).toBeTruthy();
    expect(footer?.querySelector('[data-testid="footer"]')).toBeTruthy();
  });
});
