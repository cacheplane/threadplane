import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DataGridComponent } from './data-grid.component';

describe('DataGridComponent', () => {
  let fixture: ComponentFixture<DataGridComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DataGridComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(DataGridComponent);
  });

  it('renders skeleton rows when rows is null', () => {
    fixture.componentRef.setInput('title', 'Churned');
    fixture.componentRef.setInput('rows', null);
    fixture.componentRef.setInput('columns', ['name', 'plan']);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const skeletonRows = el.querySelectorAll('.skeleton-row');
    expect(skeletonRows.length).toBeGreaterThanOrEqual(3);
  });

  it('renders correct number of data rows', () => {
    const rows = [
      { name: 'Acme', plan: 'pro', mrr_lost: 450 },
      { name: 'Widget', plan: 'starter', mrr_lost: 120 },
    ];
    fixture.componentRef.setInput('title', 'Churned');
    fixture.componentRef.setInput('rows', rows);
    fixture.componentRef.setInput('columns', ['name', 'plan', 'mrr_lost']);
    fixture.detectChanges();
    const tbody = fixture.nativeElement.querySelector('tbody');
    expect(tbody.querySelectorAll('tr').length).toBe(2);
  });

  it('renders title-cased column headers', () => {
    fixture.componentRef.setInput('title', 'Churned');
    fixture.componentRef.setInput('rows', [{ name: 'Acme', mrr_lost: 450 }]);
    fixture.componentRef.setInput('columns', ['name', 'mrr_lost']);
    fixture.detectChanges();
    const headers = fixture.nativeElement.querySelectorAll('th');
    expect(headers[0].textContent.trim()).toBe('Name');
    expect(headers[1].textContent.trim()).toBe('MRR Lost');
  });

  it('renders title', () => {
    fixture.componentRef.setInput('title', 'Recently Churned');
    fixture.componentRef.setInput('rows', []);
    fixture.componentRef.setInput('columns', ['name']);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Recently Churned');
  });

  it('names the table and its keyboard-reachable overflow region', () => {
    fixture.componentRef.setInput('title', 'Disruptions');
    fixture.componentRef.setInput('rows', [{ flight_number: 'UA204' }]);
    fixture.componentRef.setInput('columns', ['flight_number']);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('table')?.getAttribute('aria-label')).toBe('Disruptions');
    const scroll = root.querySelector('[role="region"]');
    expect(scroll?.getAttribute('aria-label')).toBe('Disruptions table');
    expect(scroll?.getAttribute('tabindex')).toBe('0');
    expect(root.querySelector('th')?.getAttribute('scope')).toBe('col');
  });

  it('distinguishes no matching rows from data that is still loading', () => {
    fixture.componentRef.setInput('title', 'Disruptions');
    fixture.componentRef.setInput('rows', []);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No disruptions.');
    expect(fixture.nativeElement.querySelector('.skeleton')).toBeNull();
  });
});
