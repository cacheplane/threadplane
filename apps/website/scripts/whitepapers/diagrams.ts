interface FlowDiagram {
  title: string;
  nodes: readonly [string, string][];
  edges: readonly [number, number, string][];
  caption: string;
}

const diagrams: Record<string, FlowDiagram> = {
  architecture: {
    title: 'Own the boundaries',
    nodes: [
      ['Angular / React', 'Intent and observable progress'],
      ['Application server', 'Identity, policy and commands'],
      ['Agent runtime', 'Bounded execution and recovery'],
      ['Model API', 'Proposals, not business authority'],
      ['Durable records', 'Threads and operation outcomes'],
      ['Tools and systems', 'Authorized external effects'],
    ],
    edges: [
      [0, 1, 'intent'],
      [1, 2, 'authorized work'],
      [2, 3, 'context / proposal'],
      [2, 4, 'persist'],
      [2, 5, 'invoke'],
    ],
    caption:
      'The application authorizes intent; the runtime consults models and invokes tools. Models propose actions; runtime and server policy control execution. Durable records survive the view.',
  },
  ownership: {
    title: 'One owner, multiple observers',
    nodes: [
      ['Runtime events', 'Ordered, correlated updates'],
      ['Application owner', 'Reduce events; issue commands'],
      ['Stable snapshot', 'New reference when state changes'],
      ['Explicit command', 'Submit, stop or reconcile'],
      ['Angular observer', 'Signal read in a template'],
      ['React observer', 'External-store snapshot read'],
    ],
    edges: [
      [0, 1, 'receive'],
      [1, 2, 'publish'],
      [3, 1, 'user intent'],
      [2, 4, 'observe'],
      [2, 5, 'observe'],
    ],
    caption:
      'The application owns execution and disposal. Framework observers read the same owner and release only their subscriptions. Rendering and remounting do not submit work.',
  },
  rendering: {
    title: 'A proposal becomes an interface',
    nodes: [
      ['Proposed specification', 'Untrusted structured data'],
      ['Admission checks', 'Schema, catalog, graph and limits'],
      ['Resolved view props', 'State bindings and readiness'],
      ['Application component', 'Angular or React rendering'],
      ['User intent', 'Named action and exact context'],
      ['Authorized operation', 'Server policy and outcome'],
    ],
    edges: [
      [0, 1, 'validate'],
      [1, 2, 'accept'],
      [2, 3, 'render'],
      [3, 4, 'interaction'],
      [4, 5, 'authorize'],
    ],
    caption:
      'A valid specification can describe a view, but cannot grant a permission. Incomplete or rejected proposals need an explicit fallback; accepted actions still cross the server authorization boundary.',
  },
  decision: {
    title: 'Approval is not completion',
    nodes: [
      ['Proposed action', 'Facts, scope and consequences'],
      ['Pending decision', 'Token bound to that proposal'],
      ['Human response', 'Approve or decline explicitly'],
      ['Server validation', 'Current token, policy and identity'],
      ['Execution', 'Idempotent operation where possible'],
      ['Confirmed outcome', 'Evidence, failure or uncertainty'],
    ],
    edges: [
      [0, 1, 'pause'],
      [1, 2, 'review'],
      [2, 3, 'submit'],
      [3, 4, 'if approved'],
      [4, 5, 'reconcile'],
    ],
    caption:
      'Approval, decision acceptance and operation completion are different states. A decline ends this action path. Stale or unauthorized responses are rejected before execution.',
  },
  recovery: {
    title: 'Recover without repeating the action',
    nodes: [
      ['Operation submitted', 'Stable business operation ID'],
      ['Remote work completes', 'Result retained by the system'],
      ['Connection drops', 'Browser has no terminal evidence'],
      ['Uncertain interface', 'Do not assume failure or success'],
      ['Read-only reconciliation', 'Look up the operation outcome'],
      ['Confirmed result', 'Resume the product workflow'],
    ],
    edges: [
      [0, 1, 'execute'],
      [1, 2, 'delivery fails'],
      [2, 3, 'show uncertainty'],
      [3, 4, 'check status'],
      [4, 5, 'if confirmed'],
    ],
    caption:
      'A lost response does not prove the action failed. Reconciliation reads existing evidence. If the outcome remains unknown, preserve that state instead of automatically replaying the command.',
  },
};

function escape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Trusted, authored flow diagrams. No network assets or script execution. */
export function renderDiagram(id: string): string {
  if (!Object.hasOwn(diagrams, id)) throw new Error(`Unknown diagram: ${id}`);
  const diagram = diagrams[id];
  const position = (index: number) => ({
    x: index % 2 === 0 ? 16 : 332,
    y: 20 + Math.floor(index / 2) * 144,
  });
  const edges = diagram.edges
    .map(([from, to, label]) => {
      const start = position(from);
      const end = position(to);
      const horizontal = start.y === end.y;
      const x1 = horizontal ? start.x + 252 : start.x + 126;
      const upward = end.y < start.y;
      const y1 = horizontal ? start.y + 40 : start.y + (upward ? 0 : 80);
      const x2 = horizontal ? end.x : end.x + 126;
      const y2 = horizontal ? end.y + 40 : end.y + (upward ? 80 : 0);
      const midY = (y1 + y2) / 2;
      const path = horizontal
        ? `M${x1},${y1} H${x2 - 5}`
        : `M${x1},${y1} V${midY} H${x2} V${y2 + (upward ? 5 : -5)}`;
      // Edge labels live in the text equivalent, keeping crossings uncluttered.
      return `<path d="${path}" fill="none" stroke="#ADB3BA" stroke-width="1.5" marker-end="url(#arrow-${id})"><title>${escape(
        label
      )}</title></path>`;
    })
    .join('');
  const nodes = diagram.nodes
    .map(([title, detail], index) => {
      const { x, y } = position(index);
      return `<g><rect x="${x}" y="${y}" width="252" height="80" rx="10" fill="#F2F2F0" stroke="#D8DBDE"/><rect x="${
        x + 16
      }" y="${
        y + 18
      }" width="18" height="3" rx="1.5" fill="#FFAF00"/><text x="${
        x + 16
      }" y="${y + 42}" font-size="16" font-weight="600">${escape(
        title
      )}</text><text x="${x + 16}" y="${
        y + 63
      }" font-size="12" fill="#59616B">${escape(detail)}</text></g>`;
    })
    .join('');
  const relationships = diagram.edges
    .map(
      ([from, to, label]) =>
        `<li>${escape(diagram.nodes[from][0])} → ${escape(
          diagram.nodes[to][0]
        )}: ${escape(label)}.</li>`
    )
    .join('');
  return `<figure class="flow-diagram"><p class="diagram-title">${escape(
    diagram.title
  )}</p><svg class="diagram-network" viewBox="0 0 600 408" role="img" aria-label="${escape(
    diagram.title
  )}" xmlns="http://www.w3.org/2000/svg"><desc>${escape(
    diagram.caption
  )}</desc><defs><marker id="arrow-${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10" fill="#ADB3BA"/></marker></defs>${edges}${nodes}</svg><ol class="diagram-mobile">${relationships}</ol><figcaption>${escape(
    diagram.caption
  )}</figcaption></figure>`;
}
