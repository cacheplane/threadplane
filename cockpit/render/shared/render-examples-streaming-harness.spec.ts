import { TestBed } from '@angular/core/testing';
import { provideRender } from '@threadplane/angular/render';

import { COMPUTED_FUNCTIONS_SPECS } from '../computed-functions/angular/src/app/specs';
import { ComputedFunctionsComponent } from '../computed-functions/angular/src/app/computed-functions.component';
import { ELEMENT_RENDERING_SPECS } from '../element-rendering/angular/src/app/specs';
import { ElementRenderingComponent } from '../element-rendering/angular/src/app/element-rendering.component';
import { REGISTRY_SPECS } from '../registry/angular/src/app/specs';
import { RegistryComponent } from '../registry/angular/src/app/registry.component';
import { REPEAT_LOOPS_SPECS } from '../repeat-loops/angular/src/app/specs';
import { RepeatLoopsComponent } from '../repeat-loops/angular/src/app/repeat-loops.component';
import { SPEC_RENDERING_SPECS } from '../spec-rendering/angular/src/app/specs';
import { SpecRenderingComponent } from '../spec-rendering/angular/src/app/spec-rendering.component';
import { STATE_MANAGEMENT_SPECS } from '../state-management/angular/src/app/specs';
import { StateManagementComponent } from '../state-management/angular/src/app/state-management.component';
import { StreamingSimulator } from './streaming-simulator';

interface DemoSpec {
  label: string;
  json: string;
}

interface RenderExampleHarness {
  simulator: StreamingSimulator;
}

const COMPUTED_FUNCTIONS = {
  formatDate: (args: Record<string, unknown>) => new Date(args['value'] as string).toLocaleDateString(),
  uppercase: (args: Record<string, unknown>) => (args['value'] as string).toUpperCase(),
  multiply: (args: Record<string, unknown>) => (args['a'] as number) * (args['b'] as number),
  reverse: (args: Record<string, unknown>) => (args['value'] as string).split('').reverse().join(''),
};

const EXAMPLES = [
  { name: 'registry', component: RegistryComponent, specs: REGISTRY_SPECS },
  { name: 'spec-rendering', component: SpecRenderingComponent, specs: SPEC_RENDERING_SPECS },
  { name: 'element-rendering', component: ElementRenderingComponent, specs: ELEMENT_RENDERING_SPECS },
  { name: 'state-management', component: StateManagementComponent, specs: STATE_MANAGEMENT_SPECS },
  { name: 'repeat-loops', component: RepeatLoopsComponent, specs: REPEAT_LOOPS_SPECS },
  { name: 'computed-functions', component: ComputedFunctionsComponent, specs: COMPUTED_FUNCTIONS_SPECS },
];

describe('render example streaming fixtures', () => {
  for (const example of EXAMPLES) {
    describe(example.name, () => {
      beforeEach(async () => {
        await TestBed.configureTestingModule({
          imports: [example.component],
          providers: [provideRender({ functions: COMPUTED_FUNCTIONS })],
        }).compileComponents();
      });

      for (const spec of example.specs as DemoSpec[]) {
        it(`${spec.label} fully streams without object flash text`, async () => {
          const fixture = TestBed.createComponent(example.component);
          const component = fixture.componentInstance as unknown as RenderExampleHarness;
          component.simulator.setSource(spec.json);
          component.simulator.seek(spec.json.length);

          fixture.detectChanges();
          await fixture.whenStable();
          fixture.detectChanges();

          const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
          expect(text).not.toContain('[object Object]');
          expect(text).not.toContain('object Object');
          expect(text.trim()).not.toBe('');
        });
      }
    });
  }

  it('renders non-string primitive state and computed values as display text', async () => {
    await TestBed.configureTestingModule({
      imports: [StateManagementComponent, ComputedFunctionsComponent],
      providers: [provideRender({ functions: COMPUTED_FUNCTIONS })],
    }).compileComponents();

    const stateFixture = TestBed.createComponent(StateManagementComponent);
    const stateComponent = stateFixture.componentInstance as unknown as RenderExampleHarness;
    stateComponent.simulator.setSource(STATE_MANAGEMENT_SPECS[1].json);
    stateComponent.simulator.seek(STATE_MANAGEMENT_SPECS[1].json.length);
    stateFixture.detectChanges();

    const computedFixture = TestBed.createComponent(ComputedFunctionsComponent);
    const computedComponent = computedFixture.componentInstance as unknown as RenderExampleHarness;
    computedComponent.simulator.setSource(COMPUTED_FUNCTIONS_SPECS[1].json);
    computedComponent.simulator.seek(COMPUTED_FUNCTIONS_SPECS[1].json.length);
    computedFixture.detectChanges();

    expect((stateFixture.nativeElement as HTMLElement).textContent).toContain('30');
    expect((computedFixture.nativeElement as HTMLElement).textContent).toContain('42');
  });
});
