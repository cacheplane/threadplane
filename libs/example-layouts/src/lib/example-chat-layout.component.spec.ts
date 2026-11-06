import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ExampleChatLayoutComponent } from './example-chat-layout.component';

@Component({
  standalone: true,
  imports: [ExampleChatLayoutComponent],
  template: `
    <example-chat-layout>
      <div main data-testid="main-content">Main Content</div>
      <div sidebar data-testid="sidebar-content">Sidebar Content</div>
    </example-chat-layout>
  `,
})
class TestHostComponent {}

@Component({
  standalone: true,
  imports: [ExampleChatLayoutComponent],
  template: `
    <example-chat-layout>
      <div main data-testid="main-only">Main Only</div>
    </example-chat-layout>
  `,
})
class NoSidebarHostComponent {}

@Component({
  standalone: true,
  imports: [ExampleChatLayoutComponent],
  template: `
    <example-chat-layout sidebarPosition="left" sidebarWidth="16rem">
      <div main data-testid="main-content">Main</div>
      <div sidebar data-testid="sidebar-content">Sidebar</div>
    </example-chat-layout>
  `,
})
class LeftSidebarHostComponent {}

@Component({
  standalone: true,
  imports: [ExampleChatLayoutComponent],
  template: `
    <example-chat-layout sidebarWidth="20rem">
      <div main data-testid="main-content">Main</div>
      <div sidebar data-testid="sidebar-content">Sidebar</div>
    </example-chat-layout>
  `,
})
class CustomWidthHostComponent {}

@Component({
  standalone: true,
  imports: [ExampleChatLayoutComponent],
  template: `
    <example-chat-layout title="LangGraph streaming" description="Watch an answer arrive.">
      <button headerActions type="button">New conversation</button>
      <div main data-testid="conversation">Conversation</div>
      <div sidebar data-testid="capability">Capability controls</div>
    </example-chat-layout>
  `,
})
class ChromeHostComponent {}

describe('ExampleChatLayoutComponent', () => {
  it('keeps the header and action in the conversation column and docs before capability controls', async () => {
    await TestBed.configureTestingModule({ imports: [ChromeHostComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ChromeHostComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const main = el.querySelector('.layout__main');
    expect(main?.querySelector('header h1')?.textContent).toBe('LangGraph streaming');
    expect(main?.querySelector('header button')?.textContent).toBe('New conversation');
    expect(main?.querySelector('[data-testid="conversation"]')).toBeTruthy();
    const sidebar = el.querySelector('.layout__sidebar');
    expect(sidebar?.querySelector('h2')?.textContent).toBe('About this example');
    expect(sidebar?.querySelector('p')?.textContent).toBe('Watch an answer arrive.');
    expect(sidebar?.querySelector('.layout__about')?.nextElementSibling?.getAttribute('data-testid')).toBe('capability');
  });

  it('preserves the main-only layout without empty header or docs chrome', async () => {
    await TestBed.configureTestingModule({ imports: [NoSidebarHostComponent] }).compileComponents();
    const fixture = TestBed.createComponent(NoSidebarHostComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('header')).toBeNull();
    expect(el.querySelector('.layout__about')).toBeNull();
  });

  it('should render main and sidebar content', async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="main-content"]')?.textContent).toBe('Main Content');
    expect(el.querySelector('[data-testid="sidebar-content"]')?.textContent).toBe('Sidebar Content');
  });

  it('should render .layout and .layout--sidebar-right for default right position', async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const layoutEl = el.querySelector('.layout');
    expect(layoutEl).toBeTruthy();
    expect(layoutEl?.classList.contains('layout--sidebar-right')).toBe(true);
  });

  it('should render .layout__main and .layout__sidebar containers', async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.layout__main')).toBeTruthy();
    expect(el.querySelector('.layout__sidebar')).toBeTruthy();
  });

  it('should hide aside when no sidebar content is projected', async () => {
    await TestBed.configureTestingModule({
      imports: [NoSidebarHostComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(NoSidebarHostComponent);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="main-only"]')?.textContent).toBe('Main Only');
    const aside = el.querySelector('aside');
    expect(aside).toBeTruthy();
    expect(aside?.children.length).toBe(0);
  });

  it('should apply layout--sidebar-left for left sidebar position', async () => {
    await TestBed.configureTestingModule({
      imports: [LeftSidebarHostComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(LeftSidebarHostComponent);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const layoutEl = el.querySelector('.layout');
    expect(layoutEl?.classList.contains('layout--sidebar-left')).toBe(true);
    expect(layoutEl?.classList.contains('layout--sidebar-right')).toBe(false);
  });

  it('should bind custom sidebar width as CSS custom property', async () => {
    await TestBed.configureTestingModule({
      imports: [CustomWidthHostComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(CustomWidthHostComponent);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const layoutEl = el.querySelector('.layout') as HTMLElement;
    expect(layoutEl).toBeTruthy();
    expect(layoutEl?.style.getPropertyValue('--example-layout-sidebar-width')).toBe('20rem');
  });

  it('should use default sidebarWidth of 18rem', async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const layoutEl = el.querySelector('.layout') as HTMLElement;
    expect(layoutEl?.style.getPropertyValue('--example-layout-sidebar-width')).toBe('18rem');
  });

  it('should set host to full viewport height', async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();

    const hostEl = fixture.nativeElement.querySelector('example-chat-layout') as HTMLElement;
    expect(hostEl).toBeTruthy();
  });
});
