import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LineChartComponent } from './line-chart.component';

describe('LineChartComponent', () => {
  let fixture: ComponentFixture<LineChartComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LineChartComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(LineChartComponent);
  });

  it('renders skeleton when data is null', () => {
    fixture.componentRef.setInput('title', 'MRR Trend');
    fixture.componentRef.setInput('data', null);
    fixture.componentRef.setInput('xKey', 'month');
    fixture.componentRef.setInput('yKey', 'mrr');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.skeleton-chart')).toBeTruthy();
    expect(el.querySelector('svg')).toBeFalsy();
  });

  it('renders SVG with correct number of data points', () => {
    const data = [
      { month: '2026-01', mrr: 37000 },
      { month: '2026-02', mrr: 38500 },
      { month: '2026-03', mrr: 40200 },
    ];
    fixture.componentRef.setInput('title', 'MRR Trend');
    fixture.componentRef.setInput('data', data);
    fixture.componentRef.setInput('xKey', 'month');
    fixture.componentRef.setInput('yKey', 'mrr');
    fixture.detectChanges();
    const svg = fixture.nativeElement.querySelector('svg');
    expect(svg).toBeTruthy();
    const circles = svg.querySelectorAll('circle');
    expect(circles.length).toBe(3);
  });

  it('renders title', () => {
    fixture.componentRef.setInput('title', 'MRR Trend');
    fixture.componentRef.setInput('data', [{ month: '2026-01', mrr: 37000 }]);
    fixture.componentRef.setInput('xKey', 'month');
    fixture.componentRef.setInput('yKey', 'mrr');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('MRR Trend');
  });

  it('explains an empty result instead of presenting a blank chart', () => {
    fixture.componentRef.setInput('title', 'Trend');
    fixture.componentRef.setInput('data', []);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No chart data.');
    expect(fixture.nativeElement.querySelector('svg')).toBeNull();
  });

  it('exposes the plotted values in a named data table', () => {
    fixture.componentRef.setInput('title', 'Trend');
    fixture.componentRef.setInput('data', [{ month: 'April', percent: 84.2 }]);
    fixture.componentRef.setInput('xKey', 'month');
    fixture.componentRef.setInput('yKey', 'percent');
    fixture.detectChanges();
    const table = fixture.nativeElement.querySelector('table');
    expect(table?.getAttribute('aria-label')).toBe('Trend data');
    expect(table?.textContent).toContain('April');
    expect(table?.textContent).toContain('84.2');
  });

  it('keeps both endpoints within a readable four-label axis budget', () => {
    fixture.componentRef.setInput('data', Array.from({ length: 12 }, (_, index) => ({ month: `Month ${index + 1}`, value: index })));
    fixture.componentRef.setInput('xKey', 'month');
    fixture.componentRef.setInput('yKey', 'value');
    fixture.detectChanges();
    const labels = fixture.componentInstance.xLabels();
    expect(labels.length).toBeLessThanOrEqual(4);
    expect(labels[0].label).toBe('Month 1');
    expect(labels.at(-1)?.label).toBe('Month 12');
  });

  it('spaces short-series month labels far enough apart to read', () => {
    fixture.componentRef.setInput('data', Array.from({ length: 6 }, (_, index) => ({ month: `2026-0${index + 1}`, value: index })));
    fixture.componentRef.setInput('xKey', 'month');
    fixture.componentRef.setInput('yKey', 'value');
    fixture.detectChanges();
    const labels = fixture.componentInstance.xLabels();
    expect(labels.slice(1).every((label, index) => label.x - labels[index].x >= 64)).toBe(true);
  });

  it.each([1, 3])('uses a real domain for %i equal-valued points', (count) => {
    fixture.componentRef.setInput('data', Array.from({ length: count }, (_, index) => ({ month: `Month ${index + 1}`, on_time_pct: 84.2 })));
    fixture.componentRef.setInput('xKey', 'month');
    fixture.componentRef.setInput('yKey', 'on_time_pct');
    fixture.detectChanges();
    const ticks = fixture.componentInstance.yGridLines();
    expect(new Set(ticks.map((tick) => tick.value)).size).toBe(3);
    expect(new Set(ticks.map((tick) => tick.label)).size).toBe(3);
    expect(fixture.componentInstance.points().every((point) => Math.abs(point.y - 104) < 0.01)).toBe(true);
  });

  it('keeps close-valued tick labels distinct', () => {
    fixture.componentRef.setInput('data', [{ month: 'March', percent: 84.21 }, { month: 'April', percent: 84.22 }]);
    fixture.componentRef.setInput('xKey', 'month');
    fixture.componentRef.setInput('yKey', 'percent');
    fixture.detectChanges();
    expect(new Set(fixture.componentInstance.yGridLines().map((tick) => tick.label)).size).toBe(3);
  });

  it('keeps gradient references distinct across retained chart instances', () => {
    const other = TestBed.createComponent(LineChartComponent);
    try {
      for (const view of [fixture, other]) {
        view.componentRef.setInput('data', [{ month: 'April', value: 84 }]);
        view.componentRef.setInput('xKey', 'month');
        view.componentRef.setInput('yKey', 'value');
        view.detectChanges();
      }
      const first = fixture.nativeElement.querySelector('linearGradient')?.id;
      const second = other.nativeElement.querySelector('linearGradient')?.id;
      expect(first).toBeTruthy();
      expect(second).toBeTruthy();
      expect(first).not.toBe(second);
      expect(fixture.nativeElement.querySelector('path')?.getAttribute('fill')).toBe(`url(#${first})`);
    } finally { other.destroy(); }
  });
});
