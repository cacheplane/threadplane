import { describe, it, expect } from 'vitest';
import fixture from './native-semantic.fixture.json';
import {
  captureSemanticMessages as normalize,
  captureBaseline,
  captureFirstHuman,
  confirmLiveTurn,
  confirmReload,
} from './authority';
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const make = (index = 0) => {
  const t = copy(fixture.turns[index]),
    prefix = index ? copy(fixture.turns[index - 1].semantic) : [];
  const live = t.semantic.map((m, i) => ({
    ...m,
    delivery: {
      generation: i < prefix.length ? 'prior' : t.generation,
      phase: 'complete',
      outcome: 'success',
    },
  }));
  const snapshot = {
    status: 'idle',
    messages: live,
    toolCalls: [],
    interrupts: [],
    subgraphs: [],
    values: { analysis: t.analysis },
    history: [{ checkpoint: t.checkpoint, next: [], tasks: [] }],
  };
  const running = {
    ...snapshot,
    status: 'running',
    messages: live.slice(0, prefix.length + 1),
  };
  const baseline = captureBaseline(prefix),
    human = captureFirstHuman(running, baseline, t.input);
  return {
    prefix: baseline,
    human,
    generation: t.generation,
    snapshot,
    current: copy(t.rawExact),
    exact: copy(t.rawExact),
    threadId: t.checkpoint.thread_id,
  };
};
describe('independent canonical native authority', () => {
  it('confirms actual H/A/B/C across two live generations preserving semantic prefix', () => {
    for (const i of [0, 1]) {
      const input = make(i);
      expect(input.human).toBeDefined();
      const a = confirmLiveTurn(input);
      expect(a?.messages).toEqual(fixture.turns[i].semantic);
      expect(a?.analysis).toEqual(fixture.turns[i].analysis);
    }
  });
  it('captures first human published while running even when its phase is already complete', () => {
    const x = make();
    expect(x.human?.generation).toBe(x.generation);
    expect(
      captureFirstHuman(
        { ...x.snapshot, status: 'idle' },
        [],
        fixture.turns[0].input
      )
    ).toBeUndefined();
    expect(
      captureFirstHuman(
        { ...x.snapshot, status: 'running' },
        [],
        fixture.turns[0].input
      )
    ).toBeUndefined();
  });
  it('confirms live snapshots before load, with absent or previous root history', () => {
    const first = make();
    first.snapshot.history = undefined as any;
    expect(confirmLiveTurn(first)).toBeDefined();
    const second = make(1);
    second.snapshot.history = [
      { checkpoint: copy(fixture.turns[0].checkpoint), next: [], tasks: [] },
    ];
    expect(confirmLiveTurn(second)).toBeDefined();
  });
  it('accepts static reload separately, and requires exact selected loaded tip', () => {
    const x = make(1),
      authority = confirmLiveTurn(x);
    const snapshot = copy(x.snapshot);
    snapshot.messages = snapshot.messages.map((m) => ({
      ...m,
      delivery: { ...m.delivery, generation: m.id },
    }));
    expect(confirmReload({ authority, snapshot, threadId: x.threadId })).toBe(
      true
    );
    expect(confirmLiveTurn({ ...x, snapshot })).toBeUndefined();
    snapshot.history[0].checkpoint.checkpoint_id = 'other';
    expect(confirmReload({ authority, snapshot, threadId: x.threadId })).toBe(
      false
    );
  });
  it('rejects all current/exact identity, next, task, interrupt contradictions', () => {
    for (const mutate of [
      (x: any) => (x.current.checkpoint.thread_id = 'wrong'),
      (x: any) => (x.exact.checkpoint.checkpoint_ns = 'child'),
      (x: any) => (x.exact.checkpoint.checkpoint_id = 'wrong'),
      (x: any) => (x.exact.checkpoint.checkpoint_map = { '': 'wrong' }),
      (x: any) => (x.exact.next = ['process']),
      (x: any) => (x.exact.tasks = [{ id: 'pending' }]),
      (x: any) => (x.exact.interrupts = [{}]),
      (x: any) => (x.snapshot.toolCalls = [{}]),
      (x: any) => (x.snapshot.subgraphs = [{}]),
      (x: any) => (x.snapshot.interrupts = [{}]),
    ]) {
      const x = make();
      mutate(x);
      expect(confirmLiveTurn(x)).toBeUndefined();
    }
  });
  it('rejects missing/duplicate/extra/title assistants, changed order/content/analysis/prefix and delivery', () => {
    for (const mutate of [
      (x: any) => x.snapshot.messages.pop(),
      (x: any) => x.snapshot.messages.push(x.snapshot.messages[3]),
      (x: any) => (x.snapshot.messages[2].id = x.snapshot.messages[1].id),
      (x: any) =>
        x.snapshot.messages.push({
          id: 'title',
          role: 'assistant',
          content: 'title',
        }),
      (x: any) => x.snapshot.messages.reverse(),
      (x: any) => (x.snapshot.messages[1].content += '!'),
      (x: any) => x.exact.values.analysis.words++,
      (x: any) => (x.snapshot.messages[1].delivery.outcome = 'error'),
      (x: any) => (x.snapshot.messages[1].delivery.generation = 'old'),
      (x: any) => (x.prefix = [{ id: 'fake', role: 'user', content: 'fake' }]),
    ]) {
      const x = make();
      mutate(x);
      expect(confirmLiveTurn(x)).toBeUndefined();
    }
  });
  it('uses Unicode codepoints and literal spaces from an actual authored graph extension', () => {
    const raw = fixture.unicode,
      m = normalize(raw.values.messages)!;
    expect(m).toBeDefined();
    const content = m[1].content;
    expect([...content].length).toBe(44);
    expect(content.length).toBe(45);
    expect(content.split(' ').length).toBe(8);
    const x = make();
    x.current = copy(raw) as any;
    x.exact = copy(raw) as any;
    x.threadId = raw.checkpoint.thread_id;
    x.snapshot.messages = m.map((q: any) => ({
      ...q,
      delivery: {
        generation: x.generation,
        phase: 'complete',
        outcome: 'success',
      },
    }));
    x.snapshot.values = { analysis: raw.values.analysis };
    x.snapshot.history = [{ checkpoint: raw.checkpoint, next: [], tasks: [] }];
    x.human = { ...m[0], generation: x.generation };
    expect(confirmLiveTurn(x)?.analysis).toEqual({ characters: 44, words: 8 });
  });
  it('values fallback contains B in the labelled omitted-callback fixture; natural B was present', () =>
    expect(normalize(fixture.omittedB.raw.values.messages)).toHaveLength(4));
  it('normalizes actual aliases/text blocks/reasoning and citation aliases with explicit sidecar equality', () => {
    const wire: any = {
      id: 'm',
      type: 'AIMessageChunk',
      content: [
        { type: 'text', text: 'hello' },
        { type: 'thinking', thinking: 'thought' },
      ],
      name: 'pilot',
      additional_kwargs: {
        sources: [
          { refId: 's', href: 'https://source.invalid', name: 'Source' },
        ],
      },
    };
    expect(normalize([wire])).toEqual([
      {
        id: 'm',
        role: 'assistant',
        content: 'hello',
        name: 'pilot',
        reasoning: 'thought',
        citations: [
          { id: 's', index: 1, title: 'Source', url: 'https://source.invalid' },
        ],
      },
    ]);
    for (const type of [
      'human',
      'HumanMessage',
      'user',
      'ai',
      'AIMessage',
      'assistant',
      'system',
      'SystemMessage',
      'tool',
      'ToolMessage',
    ])
      expect(normalize([{ id: 'm', type, content: 'ok' }])).toBeDefined();
    expect(
      normalize([
        { id: 'm', role: 'assistant', content: [{ type: 'image', url: 'x' }] },
      ])
    ).toBeUndefined();
  });
  it('requires supported reasoning, citations and names to match in every authority representation', () => {
    for (const key of ['reasoning', 'citations', 'name']) {
      const x: any = make();
      x.snapshot.messages[1][key] =
        key === 'citations'
          ? [{ id: 'c1', index: 1, url: 'https://x.invalid' }]
          : 'value';
      expect(confirmLiveTurn(x)).toBeUndefined();
    }
    const x: any = make();
    for (const raw of [x.current, x.exact]) {
      raw.values.messages[1].reasoning = 'thought';
      raw.values.messages[1].additional_kwargs.citations = [
        'https://x.invalid',
      ];
      raw.values.messages[1].name = 'pilot';
    }
    Object.assign(x.snapshot.messages[1], {
      reasoning: 'thought',
      citations: [{ id: 'c1', index: 1, url: 'https://x.invalid' }],
      name: 'pilot',
    });
    expect(confirmLiveTurn(x)).toBeDefined();
    x.exact.values.messages[1].reasoning = 'different';
    expect(confirmLiveTurn(x)).toBeUndefined();
  });
  it('rejects opaque encrypted reasoning without turning it into supported empty reasoning', () => {
    for (const type of ['reasoning', 'thinking']) {
      expect(
        normalize([
          {
            id: 'a',
            type: 'ai',
            content: [{ type, encrypted_content: 'opaque reasoning' }],
          },
        ])
      ).toBeUndefined();
      expect(
        normalize([
          {
            id: 'a',
            type: 'ai',
            content: [{ type, text: '', id: 'harmless-block-metadata' }],
          },
        ])
      ).toEqual([{ id: 'a', role: 'assistant', content: '', reasoning: '' }]);
    }
  });
  it('leaves actual fixture authority unconfirmed when supported blocks carry opaque encrypted reasoning', () => {
    for (const type of ['reasoning', 'thinking']) {
      const x = make();
      for (const raw of [x.current, x.exact]) {
        const assistant = raw.values.messages[1];
        assistant.content = [
          { type: 'text', text: assistant.content },
          { type, encrypted_content: 'nonempty opaque reasoning' },
        ] as unknown as string;
      }
      Object.assign(x.snapshot.messages[1], { reasoning: '' });
      expect(confirmLiveTurn(x)).toBeUndefined();
    }
  });
  it('rejects unsupported citation annotations on readable blocks while retaining empty annotations and harmless ids', () => {
    const citation = {
      type: 'url_citation',
      url: 'https://source.invalid/evidence',
      title: 'Evidence',
      start_index: 0,
      end_index: 6,
    };
    for (const type of ['text', 'output_text']) {
      for (const annotations of [
        [citation],
        { malformed: true },
        'malformed',
        null,
      ]) {
        expect(
          normalize([
            {
              id: 'a',
              type: 'ai',
              content: [{ type, text: 'Answer', annotations }],
            },
          ])
        ).toBeUndefined();
      }
      expect(
        normalize([
          {
            id: 'a',
            type: 'ai',
            content: [
              {
                type,
                text: 'Answer',
                annotations: [],
                id: 'harmless-block-id',
              },
            ],
          },
        ])
      ).toEqual([{ id: 'a', role: 'assistant', content: 'Answer' }]);
    }
  });
  it('leaves actual fixture authority unconfirmed for unsupported block-local citations', () => {
    for (const type of ['text', 'output_text']) {
      const x = make();
      for (const raw of [x.current, x.exact]) {
        const assistant = raw.values.messages[1];
        assistant.content = [
          {
            type,
            text: assistant.content,
            annotations: [
              {
                type: 'url_citation',
                url: 'https://source.invalid/evidence',
                title: 'Evidence',
                start_index: 0,
                end_index: 6,
              },
            ],
          },
        ] as unknown as string;
      }
      expect(confirmLiveTurn(x)).toBeUndefined();
      for (const raw of [x.current, x.exact]) {
        const assistant = raw.values.messages[1];
        const blocks = assistant.content as unknown as {
          type: string;
          text: string;
          annotations: unknown[];
          id?: string;
        }[];
        blocks[0].annotations = [];
        blocks[0].id = 'harmless-block-id';
      }
      expect(confirmLiveTurn(x)).toBeDefined();
    }
  });
  it('preserves canonical scalar strings beyond inspector limits without truncation', () => {
    const text = 'x'.repeat(2001);
    const semantic = normalize([
      { id: 'long-human', type: 'human', content: text },
      {
        id: 'long-assistant',
        type: 'ai',
        content: text,
        reasoning: text,
        name: text,
      },
    ]);
    expect(semantic).toEqual([
      { id: 'long-human', role: 'user', content: text },
      {
        id: 'long-assistant',
        role: 'assistant',
        content: text,
        reasoning: text,
        name: text,
      },
    ]);
    expect(Object.isFrozen(semantic?.[1])).toBe(true);
  });
  it('confirms a long canonical answer across live, exact, reload and preserved-prefix followup', () => {
    const first = make(),
      answer = '🛩'.repeat(2001),
      analysis = { characters: 2001, words: 1 };
    const processing =
      '[Processing] Analyzed 2001 characters. Found 1 words. Processing complete.';
    first.snapshot.messages[1].content = answer;
    first.snapshot.messages[2].content = processing;
    first.snapshot.values.analysis = analysis;
    for (const raw of [first.current, first.exact]) {
      raw.values.messages[1].content = answer;
      raw.values.messages[2].content = processing;
      raw.values.analysis = analysis;
    }
    const authority = confirmLiveTurn(first);
    expect(authority).toBeDefined();
    if (!authority) throw Error('Long canonical transcript was not confirmed.');
    expect(authority.messages[1].content).toBe(answer);
    const reloaded = copy(first.snapshot);
    reloaded.messages = reloaded.messages.map((m) => ({
      ...m,
      delivery: { ...m.delivery, generation: m.id },
    }));
    expect(
      confirmReload({ authority, snapshot: reloaded, threadId: first.threadId })
    ).toBe(true);
    const follow = make(1);
    follow.prefix = captureBaseline(authority.messages);
    follow.snapshot.messages.splice(0, 4, ...reloaded.messages);
    for (const raw of [follow.current, follow.exact])
      raw.values.messages.splice(0, 4, ...copy(first.exact.values.messages));
    follow.human = captureFirstHuman(
      {
        ...follow.snapshot,
        status: 'running',
        messages: follow.snapshot.messages.slice(0, 5),
      },
      follow.prefix,
      fixture.turns[1].input
    );
    const continued = confirmLiveTurn(follow);
    expect(continued).toBeDefined();
    expect(continued?.messages.slice(0, 4)).toEqual(authority.messages);
    expect(continued?.messages[1].content).toBe(answer);
  });
});
