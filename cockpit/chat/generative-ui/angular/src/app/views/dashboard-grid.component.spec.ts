import { Component, input } from '@angular/core';
import type { Spec } from '@json-render/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RenderElementComponent } from '@threadplane/angular/render';
import { DashboardGridComponent } from './dashboard-grid.component';

// See ContainerComponent spec for rationale. Same stub pattern keeps Angular
// from instantiating the real <render-element> (which needs RENDER_CONTEXT).
@Component({
  selector: 'render-element',
  standalone: true,
  template: '',
})
class StubRenderElementComponent {
  readonly elementKey = input<string>('');
  readonly spec = input<Spec | undefined>(undefined);
}

describe('DashboardGridComponent', () => {
  let fixture: ComponentFixture<DashboardGridComponent>;

  const emptySpec: Spec = { elements: {}, root: 'root' };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardGridComponent],
    })
      .overrideComponent(DashboardGridComponent, {
        remove: { imports: [RenderElementComponent] },
        add: { imports: [StubRenderElementComponent] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(DashboardGridComponent);
  });

  it('applies the dashboard-grid layout class', () => {
    fixture.componentRef.setInput('spec', emptySpec);
    fixture.detectChanges();
    const wrapper = fixture.nativeElement.querySelector('div.dashboard-grid');
    expect(wrapper).toBeTruthy();
  });

  it('renders one render-element per childKey', () => {
    fixture.componentRef.setInput('spec', emptySpec);
    fixture.componentRef.setInput('childKeys', ['stats_row', 'charts_row', 'table_section']);
    fixture.detectChanges();
    const elements = fixture.nativeElement.querySelectorAll('render-element');
    expect(elements.length).toBe(3);
  });

  it('renders no render-element children when childKeys is empty', () => {
    fixture.componentRef.setInput('spec', emptySpec);
    fixture.componentRef.setInput('childKeys', []);
    fixture.detectChanges();
    const elements = fixture.nativeElement.querySelectorAll('render-element');
    expect(elements.length).toBe(0);
  });
});
