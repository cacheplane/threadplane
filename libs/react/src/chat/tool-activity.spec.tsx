import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { activitySummary } from './activity-summary';
import {
  ToolActivity,
  ToolActivityGroup,
  toolActivityPhase,
  type ToolActivityInfo,
  type ToolActivityPhase,
  type ToolActivityDelivery,
} from './index';
import { confirmedOutcomes, outcomeSources, resolveToolOutcome } from './tool-outcome';
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
  it.each([
    ['running', 'Checking references'],
    ['pending', 'Waiting to run tools'],
    ['waiting', 'Tool activity paused'],
    ['stopped', 'Tool activity stopped'],
    ['unknown', 'Tool status unavailable'],
    ['complete', 'Used 1 tool'],
    ['error', 'Used 1 tool · 1 failed'],
  ] as const)('summarizes %s in one collapsed row', (phase, expected) => {
    const view = render(
      <ToolActivityGroup
        activities={[
          {
            id: 'a',
            name: 'private_lookup',
            label: 'Checking references',
            phase,
            resultText: '{"approved":true}',
          },
        ]}
      />
    );
    const details = view.container.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')!.textContent).toBe(expected);
    expect(
      view.container.querySelector('.tp-tool-activity__progress')
    ).toBeNull();
    const status = view.getByRole('status');
    expect(status.classList.contains('tp-tool-activity__status')).toBe(true);
    expect(status.closest('details')).toBeNull();
    expect(status.textContent).toContain(expected);
    expect(status.textContent).not.toContain('approved');
    expect(
      view.container
        .querySelector('.tp-tool-activity-group')!
        .getAttribute('data-active')
    ).toBe(String(phase === 'running'));
  });
  it('keeps active wording and static mixed-state cues with custom caption precedence', () => {
    const activities = [
      {
        id: 'a',
        name: 'lookup',
        phase: 'running' as const,
        label: 'Reading references',
      },
      { id: 'b', name: 'save', phase: 'error' as const },
      { id: 'c', name: 'wait', phase: 'waiting' as const },
    ];
    const view = render(<ToolActivityGroup activities={activities} />);
    const summary = view.container.querySelector('summary')!;
    expect(summary.querySelector('.tp-tool-activity__label')!.textContent).toBe(
      'Reading references'
    );
    expect(summary.querySelector('.tp-tool-activity__cue')!.textContent).toBe(
      'Failed · Paused'
    );
    expect(view.container.querySelector('[data-active="true"]')).toBeTruthy();
    view.rerender(
      <ToolActivityGroup activities={activities} label="Preparing report" />
    );
    expect(summary.querySelector('.tp-tool-activity__label')!.textContent).toBe(
      'Preparing report'
    );
    expect(
      summary.querySelector('.tp-tool-activity__cue')!.textContent
    ).toContain('Failed');
  });
  it('uses a safe running fallback and only reports all-explicit completion', () => {
    const view = render(
      <ToolActivityGroup
        activities={[
          { id: 'a', name: 'raw_name', phase: 'running', label: '   ' },
        ]}
      />
    );
    expect(view.container.querySelector('summary')!.textContent).toBe(
      'Running tools…'
    );
    view.rerender(
      <ToolActivityGroup
        activities={Array.from({ length: 4 }, (_, i) => ({
          id: String(i),
          name: 'raw',
          phase: 'complete',
        }))}
      />
    );
    expect(view.container.querySelector('summary')!.textContent).toBe(
      'Used 4 tools'
    );
    view.rerender(<ToolActivityGroup activities={[]} />);
    expect(view.container.querySelector('details,[role="status"]')).toBeNull();
  });
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
    const inspection = inner.querySelector('summary')!;
    inspection.focus();
    const filter = view.getByRole('textbox');
    view.rerender(
      <ToolActivityGroup activities={[b, a]} label="Preparing dashboard">
        <input aria-label="Dashboard filter" />
      </ToolActivityGroup>
    );
    expect(view.container.querySelectorAll('details')[2]).toBe(inner);
    expect(inner.open).toBe(true);
    expect(outer.open).toBe(true);
    expect(document.activeElement).toBe(inspection);
    view.rerender(
      <ToolActivityGroup
        activities={[
          { ...b, phase: 'complete' },
          a,
          { id: 'c', name: 'read', phase: 'complete' },
        ]}
        label="Preparing dashboard"
      >
        <input aria-label="Dashboard filter" />
      </ToolActivityGroup>
    );
    expect(outer.open).toBe(true);
    expect(inner.open).toBe(true);
    expect(view.getByRole('textbox')).toBe(filter);
    expect(document.activeElement).toBe(inspection);
    outer.open = false;
    expect(filter.closest('details')).toBeNull();
    expect(view.getAllByText('Complete').length).toBeGreaterThan(0);
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

describe('resolveToolOutcome', () => {
  it('marks a complete call failed from an app-declared outcome', () => {
    const r = resolveToolOutcome(
      { id: 'b', name: 'read', phase: 'complete', resultText: '{"recoverable":true}' },
      { status: 'failed', text: 'Reference B is unavailable.' }
    );
    expect(r.phase).toBe('error');
    expect(r.errorSummary).toBe('Reference B is unavailable.');
    expect(r.resultText).toBe('{"recoverable":true}');
    expect(r.errorText).toBeUndefined();
  });
  it('never overrides a non-complete phase', () => {
    for (const phase of ['error', 'stopped', 'waiting', 'pending', 'running', 'unknown'] as const) {
      const r = resolveToolOutcome(
        { id: 'x', name: 't', phase, errorText: 'boom' },
        { status: 'failed', text: 'nope' }
      );
      expect(r.phase).toBe(phase);
      expect(r.errorSummary).toBeUndefined();
    }
  });
  it('treats a missing status as succeeded', () => {
    expect(
      resolveToolOutcome({ id: 'a', name: 't', phase: 'complete' }, { text: 'ok' }).phase
    ).toBe('complete');
  });
  it('keeps failed outcomes out of confirmedOutcomes but keeps their sources', () => {
    const failed = resolveToolOutcome(
      { id: 'b', name: 't', phase: 'complete' },
      { status: 'failed', text: 'x', sources: [{ title: 'B', url: 'https://example.com/b' }] }
    );
    expect(confirmedOutcomes([failed])).toEqual([]);
    expect(outcomeSources([failed]).map((s) => s.url)).toEqual(['https://example.com/b']);
  });
});

describe('settled failure copy', () => {
  it('labels a settled mixed group with its failure count', () => {
    const s = activitySummary([
      { id: 'a', name: 't', phase: 'complete' },
      { id: 'b', name: 't', phase: 'error' },
    ]);
    expect(s.label).toBe('Used 2 tools · 1 failed');
    expect(s.status).toBe('Used 2 tools · 1 failed. 1 complete · 1 failed.');
  });
  it('keeps the failed label while work is still waiting', () => {
    expect(
      activitySummary([
        { id: 'a', name: 't', phase: 'error' },
        { id: 'b', name: 't', phase: 'waiting' },
      ]).label
    ).toBe('Tool activity failed');
  });
  it('uses a single-tool noun', () => {
    expect(
      activitySummary([{ id: 'a', name: 't', phase: 'error' }]).label
    ).toBe('Used 1 tool · 1 failed');
  });
  it('lets an app caption win and still cues Failed', () => {
    const s = activitySummary(
      [{ id: 'a', name: 't', phase: 'error' }],
      'Reading references'
    );
    expect(s.label).toBe('Reading references');
    expect(s.cue).toContain('Failed');
  });
  it('shows de-duplicated failure copy in the group alert', () => {
    const view = render(
      <ToolActivityGroup
        activities={[
          { id: 'a', name: 't', phase: 'error', errorSummary: 'Reference B is unavailable.' },
          { id: 'b', name: 't', phase: 'error', errorSummary: 'Reference B is unavailable.' },
        ]}
      />
    );
    const alerts = view
      .getAllByRole('alert')
      .filter((el) => el.closest('details') === null);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].tagName).toBe('DIV');
    const paragraphs = alerts[0].querySelectorAll(':scope > p');
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0].textContent).toBe('Reference B is unavailable.');
    expect(alerts[0].textContent).toBe('Reference B is unavailable.');
    expect(view.container.textContent).not.toContain('Some tools could not finish');
  });
  it('falls back to the generic group alert when no summary exists', () => {
    const view = render(
      <ToolActivityGroup activities={[{ id: 'a', name: 't', phase: 'error' }]} />
    );
    const alerts = view
      .getAllByRole('alert')
      .filter((el) => el.closest('details') === null);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toBe(
      'Some tools could not finish. Check Details before retrying.'
    );
  });
});

describe('primitives given a failed outcome directly', () => {
  const failedFlight: ToolActivityInfo = {
    id: 'f1',
    name: 'lookup_flight',
    phase: 'complete',
    resultText: '{"error":"Flight UA999 not found"}',
    outcome: { status: 'failed', text: "Flight UA999 isn't in this dataset." },
  };
  it('shows a failed row with the app-authored failure copy', () => {
    const view = render(<ToolActivity activity={failedFlight} />);
    const row = view.container.querySelector('.tp-tool-activity')!;
    expect(row.getAttribute('data-phase')).toBe('error');
    expect(
      view.container.querySelector('.tp-tool-activity__phase')?.textContent
    ).toBe('Failed');
    expect(view.getByRole('alert').textContent).toBe(
      "Flight UA999 isn't in this dataset."
    );
    expect(view.container.textContent).not.toContain('Complete');
  });
  it('counts the failure in the group label and live region', () => {
    const view = render(
      <ToolActivityGroup
        activities={[
          { id: 'a', name: 'get_airport_info', phase: 'complete' },
          failedFlight,
        ]}
      />
    );
    expect(
      view.container.querySelector('.tp-tool-activity__label')?.textContent
    ).toBe('Used 2 tools · 1 failed');
    expect(view.getByRole('status').textContent).toBe(
      'Used 2 tools · 1 failed. 1 complete · 1 failed.'
    );
    const groupAlert = view
      .getAllByRole('alert')
      .filter((el) => el.closest('details') === null);
    expect(groupAlert).toHaveLength(1);
    expect(groupAlert[0].textContent).toBe(
      "Flight UA999 isn't in this dataset."
    );
  });
});

describe('empty failure copy', () => {
  it('falls back to no summary when the failed text is blank', () => {
    const r = resolveToolOutcome(
      { id: 'b', name: 't', phase: 'complete' },
      { status: 'failed', text: '   ' }
    );
    expect(r.phase).toBe('error');
    expect(r.errorSummary).toBeUndefined();
  });
  it('trims surrounding whitespace from failure copy', () => {
    expect(
      resolveToolOutcome(
        { id: 'b', name: 't', phase: 'complete' },
        { status: 'failed', text: '  Reference B is unavailable. ' }
      ).errorSummary
    ).toBe('Reference B is unavailable.');
  });
  it('shows the generic row copy for a blank failed outcome', () => {
    const view = render(
      <ToolActivity
        activity={{
          id: 'b',
          name: 't',
          phase: 'complete',
          outcome: { status: 'failed', text: '' },
        }}
      />
    );
    expect(view.getByRole('alert').textContent).toBe(
      'This tool could not finish. Check Details before retrying.'
    );
  });
});
