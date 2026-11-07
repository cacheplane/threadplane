import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BarChartComponent } from './bar-chart.component';

describe('BarChartComponent', () => {
  let fixture: ComponentFixture<BarChartComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BarChartComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(BarChartComponent);
  });

  it('renders skeleton when data is null', () => {
    fixture.componentRef.setInput('title', 'Plans');
    fixture.componentRef.setInput('data', null);
    fixture.componentRef.setInput('labelKey', 'plan');
    fixture.componentRef.setInput('valueKey', 'count');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.skeleton-chart')).toBeTruthy();
    expect(el.querySelector('svg')).toBeFalsy();
  });

  it('renders correct number of bars', () => {
    const data = [
      { plan: 'free', count: 1200 },
      { plan: 'starter', count: 850 },
      { plan: 'pro', count: 420 },
      { plan: 'enterprise', count: 95 },
    ];
    fixture.componentRef.setInput('title', 'Plans');
    fixture.componentRef.setInput('data', data);
    fixture.componentRef.setInput('labelKey', 'plan');
    fixture.componentRef.setInput('valueKey', 'count');
    fixture.detectChanges();
    const rects = fixture.nativeElement.querySelectorAll('rect.bar');
    expect(rects.length).toBe(4);
  });

  it('renders title', () => {
    fixture.componentRef.setInput('title', 'Subscribers by Plan');
    fixture.componentRef.setInput('data', [{ plan: 'free', count: 100 }]);
    fixture.componentRef.setInput('labelKey', 'plan');
    fixture.componentRef.setInput('valueKey', 'count');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Subscribers by Plan');
  });

  it('explains an empty result instead of presenting a blank chart', () => {
    fixture.componentRef.setInput('data', []);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No chart data.');
    expect(fixture.nativeElement.querySelector('svg')).toBeNull();
  });

  it('exposes the plotted values in a named data table', () => {
    fixture.componentRef.setInput('title', 'Flights');
    fixture.componentRef.setInput('data', [{ airline: 'United', count: 92 }]);
    fixture.componentRef.setInput('labelKey', 'airline');
    fixture.componentRef.setInput('valueKey', 'count');
    fixture.detectChanges();
    const table = fixture.nativeElement.querySelector('table');
    expect(table?.getAttribute('aria-label')).toBe('Flights data');
    expect(table?.textContent).toContain('United');
    expect(table?.textContent).toContain('92');
  });

  it('keeps gradient references distinct across retained chart instances', () => {
    const other = TestBed.createComponent(BarChartComponent);
    try {
      for (const view of [fixture, other]) {
        view.componentRef.setInput('data', [{ airline: 'United', count: 92 }]);
        view.componentRef.setInput('labelKey', 'airline');
        view.componentRef.setInput('valueKey', 'count');
        view.detectChanges();
      }
      const first = fixture.nativeElement.querySelector('linearGradient')?.id;
      const second = other.nativeElement.querySelector('linearGradient')?.id;
      expect(first).toBeTruthy();
      expect(second).toBeTruthy();
      expect(first).not.toBe(second);
      expect(fixture.nativeElement.querySelector('rect.bar')?.getAttribute('fill')).toBe(`url(#${first})`);
    } finally { other.destroy(); }
  });

  it('keeps a hundred bars in bounds without overlapping a hundred axis labels', () => {
    fixture.componentRef.setInput('data', Array.from({ length: 100 }, (_, index) => ({ airline: `Airline ${index}`, count: index + 1 })));
    fixture.componentRef.setInput('labelKey', 'airline');
    fixture.componentRef.setInput('valueKey', 'count');
    fixture.detectChanges();
    const bars = fixture.componentInstance.bars();
    expect(bars).toHaveLength(100);
    expect(bars.every((bar) => bar.w > 0 && bar.x >= 16 && bar.x + bar.w <= 384.01)).toBe(true);
    expect(fixture.nativeElement.querySelectorAll('svg text').length).toBeLessThanOrEqual(12);
    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(100);
  });
});
