import { describe, it, expect } from 'vitest';
import { ConversationBudget, LIMITS } from './authority';
import { projectParentObservations } from './projection';

describe('literal safety and cumulative display', () => {
  it.each([undefined, '', 'foreign-call'])(
    'rejects an orphan tool row with call ID %j',
    (toolCallId) => {
      const f = clone(grounded);
      const orphan = clone(f.messages[2]);
      Object.assign(orphan, {
        id: 'orphan-tool',
        role: 'tool',
        content: 'Unowned tool response',
        name: 'task',
        toolCallId,
        delivery: {
          generation: 'native',
          phase: 'complete',
          outcome: 'success',
        },
      });
      if (toolCallId === undefined) Reflect.deleteProperty(orphan, 'toolCallId');
      f.messages.push(orphan);
      expect(project(f).status).toBe('incomplete');
    }
  );
  it('rejects a streaming delivery with a defined outcome', () => {
    const f = clone(grounded);
    f.messages[0].delivery = {
      generation: 'native',
      phase: 'streaming',
      outcome: 'error',
    };
    expect(project(f).status).toBe('incomplete');
  });
  it('accepts streaming delivery with an optional own undefined outcome', () => {
    const f = clone(grounded);
    Object.assign(f.messages[0].delivery, {
      phase: 'streaming',
      outcome: undefined,
    });
    expect(project(f).status).toBe('available');
  });
  it('preserves resolved raw root errors with unavailable description and missing native name', () => {
    const f = clone(grounded);
    const tool = f.tools[0],
      result = resultFor(f, tool.id);
    Object.assign(tool, {
      args: { subagent_type: 'field-researcher' },
      result: 'Error invoking task: description: Field required',
    });
    result.content = tool.result;
    delete result.name;
    const p = projectParentObservations(
      f.messages,
      f.tools,
      new ConversationBudget(),
      'parents',
      { [tool.id]: 'error' }
    );
    expect(p.status).toBe('available');
    expect(p.taskCount).toBe(4);
    expect(p.cards.get(f.messages[1].id)?.[0]).toMatchObject({
      fields: 'unavailable',
      status: 'complete',
      resultStatus: 'error',
      resultText: tool.result,
    });
  });
  it('marks malformed optional message metadata unavailable', () => {
    const f = clone(grounded);
    Object.assign(f.messages[0], { reasoning: 123 });
    expect(project(f).status).toBe('incomplete');
  });
  it('rejects malformed native delivery and unowned result fields', () => {
    const f = clone(grounded);
    f.messages[0].delivery.phase = 'bad';
    expect(project(f).status).toBe('incomplete');
  });
  it('charges displayed root transcript text together with cards and children', () => {
    const f = clone(grounded);
    f.messages[0].content = 'x'.repeat(LIMITS.fieldText + 1);
    expect(project(f).status).toBe('incomplete');
  });
  it('does not charge repeated identical snapshots twice', () => {
    const b = new ConversationBudget();
    expect(project(clone(grounded), b).status).toBe('available');
    expect(project(clone(grounded), b).status).toBe('available');
  });
  it('preserves literal HTML and grounded raw resolved error semantics', () => {
    const f = clone(grounded);
    f.tools[0].result = '<script>alert(1)</script>';
    resultFor(f, f.tools[0].id).content = f.tools[0].result;
    const statuses = { [f.tools[0].id]: 'error' };
    const p = projectParentObservations(
      f.messages,
      f.tools,
      new ConversationBudget(),
      'parents',
      statuses
    );
    expect(p.cards.get(f.messages[1].id)?.[0].resultText).toBe(
      '<script>alert(1)</script>'
    );
    expect(p.cards.get(f.messages[1].id)?.[0].resultStatus).toBe('error');
  });
  it('bounds result text in UTF16 units', () => {
    const f = clone(grounded);
    f.tools[0].result = '😀'.repeat(LIMITS.fieldText / 2);
    resultFor(f, f.tools[0].id).content = f.tools[0].result;
    expect(project(f).status).toBe('available');
    f.tools[0].result += 'x';
    resultFor(f, f.tools[0].id).content = f.tools[0].result;
    expect(project(f).status).toBe('incomplete');
  });
  it('rejects getters before displaying arguments', () => {
    let reads = 0;
    const f = clone(grounded);
    Object.defineProperty(f.tools[0], 'args', {
      get() {
        reads++;
        return {};
      },
      enumerable: true,
    });
    expect(project(f).status).toBe('incomplete');
    expect(reads).toBe(0);
  });
});
// Actual streamed declaration/catalog/result payload; catalog order is not authority.
const grounded = {
  messages: [
    {
      id: '5c43bb54-c8cf-46a6-9a7e-d162356047e6',
      role: 'user',
      content: 'Dispatch request.',
      delivery: {
        generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
        phase: 'complete',
        outcome: 'success',
      },
    },
    {
      id: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-dispatch',
      role: 'assistant',
      content: '',
      delivery: {
        generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
        phase: 'complete',
        outcome: 'success',
      },
      toolCallIds: [
        '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-0',
        '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-1',
        '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-2',
        '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-3',
      ],
    },
    {
      id: '76e8ce47-7bb5-4d82-8f75-b3900eb6b8e7',
      role: 'tool',
      content:
        'Observed lookup: KASE: Few 12000 ft, visibility 10 SM, wind 300 at 6, mountain wave advisory.',
      delivery: {
        generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
        phase: 'complete',
        outcome: 'success',
      },
      name: 'task',
      toolCallId: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-1',
    },
    {
      id: '740bc16f-5b17-48cd-95dd-ef8114c70112',
      role: 'tool',
      content:
        'Observed lookup: KDEN: Clear, visibility 10 SM, wind 350 at 22 gusting 31.',
      delivery: {
        generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
        phase: 'complete',
        outcome: 'success',
      },
      name: 'task',
      toolCallId: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-3',
    },
    {
      id: 'ecc5857c-bbaf-48bb-8e1c-a1d7b0c2d915',
      role: 'tool',
      content:
        'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
      delivery: {
        generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
        phase: 'complete',
        outcome: 'success',
      },
      name: 'task',
      toolCallId: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-0',
    },
    {
      id: '94a6f331-90c8-45f9-9274-4c128b8c9a38',
      role: 'tool',
      content:
        'Observed lookup: KDEN field elevation is 5434 ft. | KDEN longest runway is 16000 ft.',
      delivery: {
        generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
        phase: 'complete',
        outcome: 'success',
      },
      name: 'task',
      toolCallId: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-2',
    },
    {
      id: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-final',
      role: 'assistant',
      content:
        'Dispatch assessment: Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft. | Observed lookup: KASE: Few 12000 ft, visibility 10 SM, wind 300 at 6, mountain wave advisory. | Observed lookup: KDEN field elevation is 5434 ft. | KDEN longest runway is 16000 ft. | Observed lookup: KDEN: Clear, visibility 10 SM, wind 350 at 22 gusting 31.',
      delivery: {
        generation: 'ba81fd62-6a59-4711-a978-9e07478cd668',
        phase: 'complete',
        outcome: 'success',
      },
      toolCallIds: [],
    },
  ],
  tools: [
    {
      id: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-0',
      name: 'task',
      args: {
        description: 'Research KASE dispatch.',
        subagent_type: 'field-researcher',
      },
      status: 'complete',
      result:
        'Observed lookup: KASE field elevation is 7820 ft. | KASE longest runway is 8006 ft.',
    },
    {
      id: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-1',
      name: 'task',
      args: {
        description: 'Research KASE dispatch.',
        subagent_type: 'weather-analyst',
      },
      status: 'complete',
      result:
        'Observed lookup: KASE: Few 12000 ft, visibility 10 SM, wind 300 at 6, mountain wave advisory.',
    },
    {
      id: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-2',
      name: 'task',
      args: {
        description: 'Research KDEN dispatch.',
        subagent_type: 'field-researcher',
      },
      status: 'complete',
      result:
        'Observed lookup: KDEN field elevation is 5434 ft. | KDEN longest runway is 16000 ft.',
    },
    {
      id: '5c43bb54-c8cf-46a6-9a7e-d162356047e6-task-3',
      name: 'task',
      args: {
        description: 'Research KDEN dispatch.',
        subagent_type: 'weather-analyst',
      },
      status: 'complete',
      result:
        'Observed lookup: KDEN: Clear, visibility 10 SM, wind 350 at 22 gusting 31.',
    },
  ],
};
const clone = <T>(x: T): T => structuredClone(x);
function resultFor(f: typeof grounded, id: string) {
  const m = f.messages.find((m) => m.toolCallId === id);
  if (!m) throw new Error('Fixture missing result');
  return m;
}
const project = (x = grounded, budget = new ConversationBudget()) =>
  projectParentObservations(x.messages, x.tools, budget);
describe('parent task observations', () => {
  it('uses declaration order with duplicates and counts canonical task IDs once', () => {
    const f = clone(grounded);
    f.tools.reverse();
    const p = project(f);
    expect(p.status).toBe('available');
    expect(p.taskCount).toBe(4);
    expect(p.cards.get(f.messages[1].id)?.map((c) => c.id)).toEqual(
      f.messages[1].toolCallIds
    );
    expect(p.cards.get(f.messages[1].id)?.[0].description).toBe(
      p.cards.get(f.messages[1].id)?.[1].description
    );
  });
  it('shows unknown literal types and malformed args without losing valid task identity', () => {
    for (const args of [
      { description: 'Task', subagent_type: 'general-purpose' },
      { description: 'Task', subagent_type: 'unknown' },
      { subagent_type: 'field-researcher' },
      123,
    ]) {
      const f = clone(grounded);
      (f.tools[0] as { args: unknown }).args = args;
      const p = project(f);
      expect(p.taskCount).toBe(4);
      const c = p.cards.get(f.messages[1].id)?.[0];
      expect(c).toBeDefined();
      expect(c?.fields).toBe(
        args === 123 || !('description' in Object(args))
          ? 'unavailable'
          : (args as { subagent_type: string }).subagent_type === 'unknown'
          ? 'unavailable'
          : 'available'
      );
    }
  });
  it('keeps generic middleware observations out of parent task count', () => {
    const f = clone(grounded);
    f.tools[0].name = 'ls';
    resultFor(f, f.tools[0].id).name = 'ls';
    expect(project(f).taskCount).toBe(3);
    expect(project(f).cards.get(f.messages[1].id)?.[0].kind).toBe('tool');
  });
  it.each(['catalog', 'owner', 'declaration', 'result'])(
    'marks duplicate %s visibly incomplete',
    (kind) => {
      const f = clone(grounded);
      if (kind === 'catalog') f.tools.push(clone(f.tools[0]));
      if (kind === 'owner')
        f.messages.push({ ...clone(f.messages[1]), id: 'duplicate-owner' });
      if (kind === 'declaration')
        f.messages[1].toolCallIds?.push(f.tools[0].id);
      if (kind === 'result')
        f.messages.push({ ...clone(f.messages[2]), id: 'duplicate-result' });
      expect(project(f).status).toBe('incomplete');
    }
  );
  it('marks mismatched results and malformed delivery incomplete', () => {
    const f = clone(grounded);
    f.tools[0].result = 'changed';
    expect(project(f).status).toBe('incomplete');
  });
  it('bounds each description and result without hiding the overflow', () => {
    const f = clone(grounded);
    f.tools[0].args.description = '😀'.repeat(LIMITS.fieldText / 2);
    expect(project(f).status).toBe('available');
    f.tools[0].args.description += 'x';
    expect(project(f).status).toBe('incomplete');
  });
  it('shares aggregate budget with retained observations and across followups', () => {
    const b = new ConversationBudget();
    expect(b.replace('children', 0, 1, LIMITS.displayText - 1)).toBe(true);
    expect(project(clone(grounded), b).status).toBe('incomplete');
  });
  it('bounds cumulative canonical parent tasks', () => {
    const b = new ConversationBudget();
    expect(b.replace('old', 100, 0, 0)).toBe(true);
    expect(project(clone(grounded), b).status).toBe('incomplete');
  });
});
