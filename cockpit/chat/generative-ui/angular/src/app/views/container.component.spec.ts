import { Component, input } from '@angular/core';
import type { Spec } from '@json-render/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RenderElementComponent } from '@threadplane/angular/render';
import { ContainerComponent } from './container.component';

// Stub matching <render-element>'s selector + public inputs. Swapped into
// ContainerComponent's imports via overrideComponent so Angular doesn't
// instantiate the real RenderElementComponent (which requires RENDER_CONTEXT).
@Component({
  selector: 'render-element',
  standalone: true,
  template: '',
})
class StubRenderElementComponent {
  readonly elementKey = input<string>('');
  readonly spec = input<Spec | undefined>(undefined);
}

describe('ContainerComponent', () => {
  let fixture: ComponentFixture<ContainerComponent>;

  // Minimal Spec satisfying the input.required<Spec>() — children resolution
  // is delegated to <render-element>, so the spec body itself is not exercised.
  const emptySpec: Spec = { elements: {}, root: 'root' };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ContainerComponent],
    })
      .overrideComponent(ContainerComponent, {
        remove: { imports: [RenderElementComponent] },
        add: { imports: [StubRenderElementComponent] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(ContainerComponent);
  });

  it('sets column direction attribute by default', () => {
    fixture.componentRef.setInput('spec', emptySpec);
    fixture.detectChanges();
    const wrapper = fixture.nativeElement.querySelector('div.container');
    expect(wrapper?.getAttribute('data-direction')).toBe('column');
  });

  it('sets row direction attribute when direction is "row"', () => {
    fixture.componentRef.setInput('spec', emptySpec);
    fixture.componentRef.setInput('direction', 'row');
    fixture.detectChanges();
    const wrapper = fixture.nativeElement.querySelector('div.container');
    expect(wrapper?.getAttribute('data-direction')).toBe('row');
  });

  it('renders one render-element per childKey', () => {
    fixture.componentRef.setInput('spec', emptySpec);
    fixture.componentRef.setInput('childKeys', ['a', 'b', 'c']);
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
