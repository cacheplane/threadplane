import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ToolActivity,
  ToolActivityGroup,
  toolActivityPhase,
  type ToolActivityPhase,
  type ToolActivityDelivery,
} from './index';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Shared readonly Angular/React test conformance data, excluded from production packages.
import { phases } from '../../../../fixtures/tool-activity/phases';
afterEach(cleanup);
describe('ToolActivity', () => {
  it('shows confirmed outcomes and safe deduplicated sources outside collapsed inspection', () => {
    const activity = {
      id: 'source',
      name: 'lookup',
      phase: 'complete' as const,
      outcome: {
        text: 'Found the official reference',
        sources: [
          { title: 'Signals', url: 'https://angular.dev/guide/signals' },
          { title: 'Duplicate', url: 'https://angular.dev/guide/signals' },
          { title: 'Unsafe', url: 'javascript:alert(1)' },
          { title: 'Relative', url: '/private' },
        ],
      },
    };
    const view = render(<ToolActivityGroup activities={[activity]} />);
    expect(
      view.getByText('Found the official reference').closest('details')
    ).toBeNull();
    expect(view.getAllByRole('link')).toHaveLength(1);
    expect(
      view.getByRole('link', { name: 'Signals' }).getAttribute('href')
    ).toBe('https://angular.dev/guide/signals');
    expect(view.container.querySelector('details')!.open).toBe(false);
    view.rerender(
      <ToolActivity activity={{ ...activity, phase: 'running' }} />
    );
    expect(view.queryByText('Found the official reference')).toBeNull();
    expect(view.queryByRole('link')).toBeNull();
  });
  it('announces concise mixed progress and bounds long outcome previews without raw live payloads', () => {
    const activities = Array.from({ length: 8 }, (_, index) => ({
      id: String(index),
      name: 'read',
      phase: 'complete' as const,
      outcome: {
        text: `Read reference ${index}`,
        sources: [
          { title: `Source ${index}`, url: `https://example.org/${index}` },
        ],
      },
      resultText: 'raw diagnostic',
    }));
    const view = render(
      <ToolActivityGroup
        activities={[
          ...activities,
          { id: 'live', name: 'read', phase: 'running' },
          { id: 'bad', name: 'read', phase: 'error' },
        ]}
      />
    );
    const status = view.getByRole('status');
    expect(status.textContent).toContain('8 complete');
    expect(status.textContent).toContain('1 running');
    expect(status.textContent).toContain('1 failed');
    expect(status.textContent).not.toContain('raw diagnostic');
    expect(view.getByText('More results (5)')).toBeTruthy();
    expect(view.getByText('More sources (5)')).toBeTruthy();
    expect(view.getByText('Read reference 0').closest('details')).toBeNull();
  });
  it.each(phases)(
    'resolves $phase after $outcome as $expected without mutating execution',
    ({ phase, outcome, expected }) => {
      expect(
        toolActivityPhase(
          phase as ToolActivityPhase,
          { phase: 'complete', outcome } as ToolActivityDelivery
        )
      ).toBe(expected);
    }
  );
  it('separates a human label, explicit phase and literal technical evidence', () => {
    const view = render(
      <ToolActivity
        activity={{
          id: 'one',
          name: 'query_airline_kpis',
          label: 'Checking airline performance',
          phase: 'running',
          argumentsText: '{"region":<img>',
        }}
      />
    );
    expect(view.getByText('Checking airline performance')).toBeTruthy();
    expect(view.getByText('Running')).toBeTruthy();
    const details = view.container.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain('query_airline_kpis');
    expect(details.querySelector('pre')!.textContent).toBe('{"region":<img>');
    expect(details.querySelector('img')).toBeNull();
  });
  it('preserves inspection, focus and rich child identity across streamed updates', () => {
    const activity = {
      id: 'one',
      name: 'query',
      phase: 'running' as const,
      argumentsText: '{',
    };
    const view = render(
      <ToolActivity activity={activity}>
        <input aria-label="Rich result" defaultValue="edited" />
      </ToolActivity>
    );
    const details = view.container.querySelector('details')!;
    details.open = true;
    const child = view.getByRole('textbox');
    child.focus();
    view.rerender(
      <ToolActivity
        activity={{ ...activity, phase: 'complete', resultText: '' }}
      >
        <input aria-label="Rich result" defaultValue="changed" />
      </ToolActivity>
    );
    expect(view.container.querySelector('details')).toBe(details);
    expect(details.open).toBe(true);
    expect(view.getByRole('textbox')).toBe(child);
    expect(document.activeElement).toBe(child);
    expect(view.getByText('Result')).toBeTruthy();
    details.open = false;
    expect(child.closest('details')).toBeNull();
  });
  it('keeps safe failures visible and raw errors inside Details without inferring from payloads', () => {
    const view = render(
      <ToolActivity
        activity={{
          id: 'one',
          name: 'save',
          phase: 'error',
          errorText: 'private-ish diagnostic',
          errorSummary: 'The note could not be saved.',
        }}
      />
    );
    expect(view.getByRole('alert').textContent).toBe(
      'The note could not be saved.'
    );
    expect(
      view.getByText('private-ish diagnostic').closest('details')
    ).toBeTruthy();
    view.rerender(
      <ToolActivity
        activity={{ id: 'one', name: 'save', resultText: 'false' }}
      />
    );
    expect(view.getByText('Status unavailable')).toBeTruthy();
    expect(view.queryByText('Complete')).toBeNull();
  });
  it.each(['0', 'false', '', '[]', 'null'])(
    'preserves a successful literal result %j',
    (resultText) => {
      const view = render(
        <ToolActivity
          activity={{
            id: 'one',
            name: 'inspect',
            phase: 'complete',
            resultText,
          }}
        />
      );
      expect(view.container.querySelectorAll('pre')[0].textContent).toBe(
        resultText
      );
      expect(view.getByText('Complete')).toBeTruthy();
    }
  );
  it('does not invent a duration and presents actionable waiting outside the disclosure', () => {
    const view = render(
      <ToolActivity activity={{ id: 'one', name: 'save', phase: 'waiting' }}>
        <button>Approve save</button>
      </ToolActivity>
    );
    expect(
      view.getByRole('button', { name: 'Approve save' }).closest('details')
    ).toBeNull();
    expect(view.container.textContent).not.toMatch(/\d+ms|\d+s/);
    expect(view.getByText('Waiting')).toBeTruthy();
  });
});
describe('ToolActivityGroup', () => {
  it.each(['pending', 'stopped'] as const)(
    'retains an explicit %s group outcome',
    (phase) => {
      const view = render(
        <ToolActivityGroup activities={[{ id: 'one', name: 'query', phase }]} />
      );
      expect(
        view.container
          .querySelector('.tp-tool-activity-group')!
          .getAttribute('data-phase')
      ).toBe(phase);
    }
  );
  it('keeps per-ID expansion and rich children mounted when the group is closed and reordered', () => {
    const a = { id: 'a', name: 'query', phase: 'complete' as const },
      b = { id: 'b', name: 'layout', phase: 'running' as const };
    const view = render(
      <ToolActivityGroup activities={[a, b]} label="Preparing dashboard">
        <input aria-label="Dashboard filter" />
      </ToolActivityGroup>
    );
    const outer = view.container.querySelector('details')!;
    const inner = view.container.querySelectorAll('details')[1];
    outer.open = true;
    inner.open = true;
    const filter = view.getByRole('textbox');
    view.rerender(
      <ToolActivityGroup activities={[b, a]} label="Preparing dashboard">
        <input aria-label="Dashboard filter" />
      </ToolActivityGroup>
    );
    expect(view.container.querySelectorAll('details')[2]).toBe(inner);
    expect(inner.open).toBe(true);
    outer.open = false;
    expect(filter.closest('details')).toBeNull();
    expect(view.getAllByText('Running').length).toBeGreaterThan(0);
  });
  it('keeps group failure recovery visible without opening inspection', () => {
    const view = render(
      <ToolActivityGroup
        activities={[{ id: 'a', name: 'query', phase: 'error' }]}
      />
    );
    expect(
      view
        .getAllByRole('alert')
        .some((alert) => alert.closest('details') === null)
    ).toBe(true);
  });
});
