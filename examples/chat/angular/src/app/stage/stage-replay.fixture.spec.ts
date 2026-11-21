/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateStageRecording } from './stage-recording.types';
import { buildTimeline } from './stage-timeline';

const FIXTURE = resolve(__dirname, '../../../public/stage-replay.json');

const FIXTURE_EXISTS = existsSync(FIXTURE);

describe.skipIf(!FIXTURE_EXISTS)('stage-replay.json', () => {
  const rec = FIXTURE_EXISTS ? validateStageRecording(JSON.parse(readFileSync(FIXTURE, 'utf8'))) : (undefined as never);
  const tl = FIXTURE_EXISTS ? buildTimeline(rec) : (undefined as never);
  const json = (i: number) => JSON.stringify(rec.runs[i].events);
  const run = (beat: string, kind: string) => rec.runs.findIndex((r) => r.beat === beat && r.action.kind === kind);
  const finalAiText = (i: number): string => {
    const vals = rec.runs[i].events.filter((e) => (e.event as { type?: string }).type === 'values');
    const msgs = ((vals.at(-1)?.event as { messages?: { type?: string; content?: unknown; tool_calls?: unknown[] }[] })?.messages ?? []);
    const last = [...msgs].reverse().find((m) => m.type === 'ai' && !(m.tool_calls && m.tool_calls.length));
    const c = last?.content;
    return typeof c === 'string' ? c : ((c as { type?: string; text?: string }[] | undefined) ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  };
  const lastToolJson = (i: number): Record<string, unknown> => {
    const vals = rec.runs[i].events.filter((e) => (e.event as { type?: string }).type === 'values');
    const msgs = ((vals.at(-1)?.event as { messages?: { type?: string; content?: unknown }[] })?.messages ?? []);
    const tool = [...msgs].reverse().find((m) => m.type === 'tool');
    return JSON.parse(String(tool?.content ?? '{}'));
  };

  it('walks stream, subagents, persist, approve, render', () => {
    expect(tl.beats.map((b) => b.beat)).toEqual(['stream', 'subagents', 'persist', 'approve', 'render']);
  });
  it('the stream beat calls search_documents and attaches citations', () => {
    expect(json(run('stream', 'submit'))).toMatch(/"name":\s*"search_documents"/);
    expect(json(run('stream', 'submit'))).toMatch(/citations/);
    expect(json(run('stream', 'submit'))).toContain('demo-backup-retention');
  });
  it('the research beat dispatches research and carries child messages before the parent answers', () => {
    const i = run('subagents', 'submit');
    expect(json(i)).toMatch(/"name":\s*"research"/);
    const children = rec.runs[i].events.filter(({ event }) => {
      const ns = (event as { namespace?: string[] }).namespace;
      return Array.isArray(ns) && ns.some((n) => n.startsWith('tools:'));
    });
    expect(children.length).toBeGreaterThan(1);
    expect(children.some(({ event }) => event.type.startsWith('messages|'))).toBe(true);
    expect(finalAiText(i).length).toBeGreaterThan(40);
    expect(finalAiText(i)).toMatch(/120|retain/i);
  });
  it('policy, research and alternatives do not execute deletion or interrupt', () => {
    for (let i = 0; i < run('approve', 'submit'); i++) {
      expect(json(i)).not.toMatch(/"name":\s*"(?:delete_backups|request_approval)"/);
      expect(json(i)).not.toContain('approval_request');
    }
  });
  it('the persist beat has a reload with a history snapshot at its position and a fork', () => {
    const reload = run('persist', 'reload');
    expect(rec.histories.some((h) => h.afterRun === reload && h.states.length > 0)).toBe(true);
    expect(rec.runs.some((r) => r.action.kind === 'submit' && r.action.checkpointIndex !== undefined)).toBe(true);
    const fork = rec.runs.findIndex((r) => r.action.kind === 'submit' && r.action.checkpointIndex !== undefined);
    const action = rec.runs[fork].action;
    if (action.kind !== 'submit') throw new Error('missing fork');
    const source = rec.histories.filter((h) => h.afterRun === fork).at(-1)?.states[action.checkpointIndex!];
    expect(JSON.stringify(source)).toContain('research');
    expect(JSON.stringify(source)).toContain('demo-backup-retention');
  });
  it('every completed run close recorded a history snapshot, so the devtools timeline is never empty at a beat', () => {
    rec.runs.forEach((_, i) => {
      if (rec.runs[i].action.kind === 'reload') return;
      // The recording host does not wait for a snapshot after a run that
      // ends in an interrupt (the next run is the resume), and the replay
      // serves none there.
      if (rec.runs[i + 1]?.action.kind === 'resume') return;
      expect(rec.histories.some((h) => h.afterRun === i + 1), `run ${i}`).toBe(true);
    });
  });
  it('the approve beat lists, pauses inside delete_backups, and resumes with an audit', () => {
    const a = json(run('approve', 'submit'));
    expect(a).toMatch(/"name":\s*"list_backups"/);
    expect(a).toMatch(/"name":\s*"delete_backups"/);
    expect(a).not.toMatch(/"name":\s*"request_approval"/);
    expect(a).toMatch(/approval_request/);
    const audit = lastToolJson(run('approve', 'resume'));
    expect(Array.isArray(audit['deleted']) && (audit['deleted'] as unknown[]).length > 0).toBe(true);
    expect(audit['deleted']).toEqual(expect.arrayContaining(['bk-2026-04-30-prod', 'bk-2026-02-01-staging']));
    expect(audit['deleted']).toHaveLength(2);
    expect(audit['freed_gb']).toBe(48.7);
    expect(audit['remaining']).toBe(6);
    expect(finalAiText(run('approve', 'resume')).length).toBeLessThan(1400);
  });
  it('the render beat carries an A2UI payload', () => {
    expect(json(run('render', 'submit'))).toMatch(/a2ui_JSON/);
    expect(json(run('render', 'submit'))).toMatch(/48\.7/);
    expect(json(run('render', 'submit'))).toContain('TextField');
    expect(json(run('render', 'submit'))).toContain('updateDataModel');
  });
  it('never contains an API key or bearer token', () => {
    expect(JSON.stringify(rec)).not.toMatch(/sk-[A-Za-z0-9]{10,}|Bearer /);
  });
});
