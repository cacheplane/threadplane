import { isValidElement, type ComponentType, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { DocsPageHeader } from '../../../../../components/docs/DocsPageHeader';
import { LibraryMark } from '../../../../../components/docs/LibraryMark';
import { DocsSearchFooter } from '../../../../../components/docs/DocsSearchFooter';
import { DocsTOC } from '../../../../../components/docs/DocsTOC';
import { MdxRenderer } from '../../../../../components/docs/MdxRenderer';
import { ReactStreamingPreview } from '../../../../../components/docs/ReactStreamingPreview';
import { ReactAgUiStreamingPreview } from '../../../../../components/docs/ReactAgUiStreamingPreview';
import { ReactAgUiInterruptsPreview } from '../../../../../components/docs/ReactAgUiInterruptsPreview';
import { ReactAgUiToolViewsPreview } from '../../../../../components/docs/ReactAgUiToolViewsPreview';
import { ReactAgUiJsonRenderPreview } from '../../../../../components/docs/ReactAgUiJsonRenderPreview';
import { ReactAgUiSubagentsPreview } from '../../../../../components/docs/ReactAgUiSubagentsPreview';
import { ReactRenderSpecPreview } from '../../../../../components/docs/ReactRenderSpecPreview';
import { ReactElementRenderingPreview } from '../../../../../components/docs/ReactElementRenderingPreview';
import { ReactRegistryPreview } from '../../../../../components/docs/ReactRegistryPreview';
import { ReactRepeatLoopsPreview } from '../../../../../components/docs/ReactRepeatLoopsPreview';
import { ReactStateManagementPreview } from '../../../../../components/docs/ReactStateManagementPreview';
import { ReactChatMessagesPreview } from '../../../../../components/docs/ReactChatMessagesPreview';
import { ReactChatSubagentsPreview } from '../../../../../components/docs/ReactChatSubagentsPreview';
import { ReactChatToolCallsPreview } from '../../../../../components/docs/ReactChatToolCallsPreview';
import { ReactChatInterruptsPreview } from '../../../../../components/docs/ReactChatInterruptsPreview';
import { ReactChatInputPreview } from '../../../../../components/docs/ReactChatInputPreview';
import { ReactComputedFunctionsPreview } from '../../../../../components/docs/ReactComputedFunctionsPreview';
import { ReactInterruptsPreview } from '../../../../../components/docs/ReactInterruptsPreview';
import { ReactMemoryPreview } from '../../../../../components/docs/ReactMemoryPreview';
import { ReactClientToolsPreview } from '../../../../../components/docs/ReactClientToolsPreview';
import { ReactPersistencePreview } from '../../../../../components/docs/ReactPersistencePreview';
import { ReactDurableExecutionPreview } from '../../../../../components/docs/ReactDurableExecutionPreview';
import { ReactSubgraphsPreview } from '../../../../../components/docs/ReactSubgraphsPreview';
import { ReactDeploymentRuntimePreview } from '../../../../../components/docs/ReactDeploymentRuntimePreview';
import { ReactTimeTravelPreview } from '../../../../../components/docs/ReactTimeTravelPreview';
import { WebsiteWorkspace } from '../../../../../components/workspace/WebsiteWorkspace';
import DocsPage, { generateMetadata } from './page';

it('selects Planning-specific native React Docs and sources while retaining Angular Docs', async () => {
  const tree = await route('deep-agents', 'capabilities', 'planning');
  const workspace = findElement(tree, WebsiteWorkspace as ComponentType<never>);
  const article = workspace?.props.reactDocsSlot as React.ReactElement<ElementProps> | undefined;
  expect(article).toBeTruthy();
  expect((article?.type as { name?: string })?.name).toBe('ReactDeepAgentsPlanningPreview');
  expect(article?.props.exampleCode?.assetPaths).toContain('cockpit/deep-agents/planning/react/src/plan-state.ts');
  expect(article?.props.exampleCode?.sources?.['cockpit/deep-agents/planning/react/src/terminal.ts']).toContain('checkpoint');
  const angular = findElement(workspace?.props.docsSlot, MdxRenderer as ComponentType<never>);
  expect(angular?.props.exampleCode?.assetPaths.some(path => path.includes('/planning/angular/'))).toBe(true);
  expect(findElement(workspace?.props.reactDocsSlot, ReactStreamingPreview as ComponentType<never>)).toBeNull();
});

interface ElementProps {
  children?: ReactNode;
  docsSlot?: ReactNode;
  reactDocsSlot?: ReactNode;
  requestedMode?: string | null;
  resolution?: { kind?: string; identity?: { availableModes?: string[] } };
  contentBundle?: {
    runtimeUrl?: string | null;
    codeSources?: Record<string, string>;
  };
  contextTrail?: readonly { label: string; href?: string; icon?: ReactNode }[];
  docsContext?: unknown;
  docsPath?: string;
  exampleCode?: {
    assetPaths?: readonly string[];
    sources?: Record<string, string>;
  } | null;
}

function findElement(
  node: ReactNode,
  type: ComponentType<never>
): React.ReactElement<ElementProps> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement<ElementProps>(node)) return null;
  if (node.type === type) return node;
  return findElement(node.props.children, type);
}

const route = (library: string, section: string, slug: string, mode?: string) =>
  DocsPage({
    params: Promise.resolve({ library, section, slug }),
    searchParams: Promise.resolve(mode ? { mode } : {}),
  } as never);

describe('unified docs workspace route', () => {
  it('selects the native Generative UI article and source assets on the canonical guide', async () => {
    const tree = await route('chat', 'guides', 'generative-ui');
    const workspace = findElement(tree, WebsiteWorkspace as ComponentType<never>);
    expect(workspace?.props.reactDocsSlot).toBeTruthy();
    const slot = workspace?.props.reactDocsSlot;
    expect(isValidElement<ElementProps>(slot) && slot.props.exampleCode?.assetPaths).toEqual(
      expect.arrayContaining(['app.tsx', 'application.ts', 'connection.ts', 'dashboard-views.tsx', 'dashboard-data.ts', 'dashboard-spec.ts', 'tool-evidence.ts', 'observation.ts', 'terminal.ts', 'main.tsx', 'styles.css'].map(file => `cockpit/chat/generative-ui/react/src/${file}`))
    );
    expect(isValidElement(slot) && typeof slot.type === 'function' && slot.type.name).toBe('ReactChatGenerativeUiPreview');
    expect(findElement(slot, ReactChatSubagentsPreview as ComponentType<never>)).toBeNull();
  });
  it('selects the native Timeline article and source assets on the canonical guide', async () => {
    const tree = await route('chat', 'components', 'chat-trace');
    const workspace = findElement(tree, WebsiteWorkspace as ComponentType<never>);
    expect(workspace?.props.reactDocsSlot).toBeTruthy();
    const slot = workspace?.props.reactDocsSlot;
    expect(isValidElement<ElementProps>(slot) && slot.props.exampleCode?.assetPaths).toEqual(
      expect.arrayContaining(['app.tsx', 'application.ts', 'checkpoints.ts', 'preview.ts', 'authority.ts', 'connection.ts', 'main.tsx', 'styles.css'].map(file => `cockpit/chat/timeline/react/src/${file}`))
    );
    expect(isValidElement(slot) && typeof slot.type === 'function' && slot.type.name).toBe('ReactChatTimelinePreview');
    expect(findElement(slot, ReactChatSubagentsPreview as ComponentType<never>)).toBeNull();
  });

  it('selects the native Threads article and source assets on the canonical guide', async () => {
    const tree = await route('chat', 'guides', 'thread-routing');
    const workspace = findElement(tree, WebsiteWorkspace as ComponentType<never>);
    expect(workspace?.props.reactDocsSlot).toBeTruthy();
    const slot = workspace?.props.reactDocsSlot;
    expect(isValidElement<ElementProps>(slot) && slot.props.exampleCode?.assetPaths).toEqual(
      expect.arrayContaining(['app.tsx', 'application.ts', 'authority.ts', 'records.ts', 'titles.ts', 'connection.ts', 'main.tsx', 'styles.css'].map(file => `cockpit/chat/threads/react/src/${file}`))
    );
    expect(isValidElement(slot) && typeof slot.type === 'function' && slot.type.name).toBe('ReactChatThreadsPreview');
    expect(findElement(slot, ReactChatSubagentsPreview as ComponentType<never>)).toBeNull();
  });

  it('selects a native Chat Subagents article on its canonical component page', async () => {
    const tree=await route('chat','components','chat-subagent-card');
    const workspace=findElement(tree,WebsiteWorkspace as ComponentType<never>);
    const article=findElement(workspace?.props.reactDocsSlot,ReactChatSubagentsPreview as ComponentType<never>);
    expect(article).not.toBeNull();
    expect(article?.props.exampleCode?.assetPaths).toContain('cockpit/chat/subagents/react/src/children.ts');
    expect(findElement(workspace?.props.reactDocsSlot,ReactStreamingPreview as ComponentType<never>)).toBeNull();
    expect(findElement(workspace?.props.reactDocsSlot,ReactClientToolsPreview as ComponentType<never>)).toBeNull();
  });
  it('selects a native Chat Tool Calls article on its canonical component page', async () => {
    const tree=await route('chat','components','chat-tool-calls');
    const workspace=findElement(tree,WebsiteWorkspace as ComponentType<never>);
    const article=findElement(workspace?.props.reactDocsSlot,ReactChatToolCallsPreview as ComponentType<never>);
    expect(article).not.toBeNull();
    expect(article?.props.exampleCode?.assetPaths).toContain('cockpit/chat/tool-calls/react/src/authority.ts');
    expect(findElement(workspace?.props.reactDocsSlot,ReactStreamingPreview as ComponentType<never>)).toBeNull();
    expect(findElement(workspace?.props.reactDocsSlot,ReactClientToolsPreview as ComponentType<never>)).toBeNull();
  });
  it('selects a native Chat Interrupts article on its canonical component page', async () => {
    const tree=await route('chat','components','chat-interrupt-panel');
    const workspace=findElement(tree,WebsiteWorkspace as ComponentType<never>);
    const article=findElement(workspace?.props.reactDocsSlot,ReactChatInterruptsPreview as ComponentType<never>);
    expect(article).not.toBeNull();
    expect(article?.props.exampleCode?.assetPaths).toContain('cockpit/chat/interrupts/react/src/authority.ts');
    expect(findElement(workspace?.props.reactDocsSlot,ReactStreamingPreview as ComponentType<never>)).toBeNull();
    expect(findElement(workspace?.props.reactDocsSlot,ReactClientToolsPreview as ComponentType<never>)).toBeNull();
  });
  it('selects a native Chat Input article on its canonical component page', async () => {
    const tree=await route('chat','components','chat-input');
    const workspace=findElement(tree,WebsiteWorkspace as ComponentType<never>);
    const article=findElement(workspace?.props.reactDocsSlot,ReactChatInputPreview as ComponentType<never>);
    expect(article).not.toBeNull();
    expect(article?.props.exampleCode?.assetPaths).toContain('cockpit/chat/input/react/src/application.ts');
    expect(findElement(workspace?.props.reactDocsSlot,ReactStreamingPreview as ComponentType<never>)).toBeNull();
    expect(findElement(workspace?.props.reactDocsSlot,ReactClientToolsPreview as ComponentType<never>)).toBeNull();
  });
  it('selects a native Chat Messages article on its canonical concept page', async () => {
    const tree=await route('chat','concepts','message-model');
    const workspace=findElement(tree,WebsiteWorkspace as ComponentType<never>);
    const article=findElement(workspace?.props.reactDocsSlot,ReactChatMessagesPreview as ComponentType<never>);
    expect(article).not.toBeNull();
    expect(article?.props.exampleCode?.assetPaths).toContain('cockpit/chat/messages/react/src/application.ts');
    expect(findElement(workspace?.props.reactDocsSlot,ReactStreamingPreview as ComponentType<never>)).toBeNull();
    expect(findElement(workspace?.props.reactDocsSlot,ReactClientToolsPreview as ComponentType<never>)).toBeNull();
  });
  it('selects React Element Rendering Docs with owned state and readonly view sources', async () => {
    const tree = await route('render', 'api', 'render-spec-component');
    const workspace = findElement(
      tree,
      WebsiteWorkspace as ComponentType<never>
    );
    const article = findElement(
      workspace?.props.reactDocsSlot,
      ReactElementRenderingPreview as ComponentType<never>
    );
    expect(article).not.toBeNull();
    expect(article?.props.exampleCode?.assetPaths).toContain(
      'cockpit/render/element-rendering/react/src/app.tsx'
    );
    expect(article?.props.exampleCode?.assetPaths).toContain(
      'cockpit/render/element-rendering/react/src/views.tsx'
    );
    expect(
      article?.props.exampleCode?.assetPaths?.some((path) =>
        path.includes('/python/')
      )
    ).toBe(false);
    expect(
      findElement(
        workspace?.props.reactDocsSlot,
        ReactRenderSpecPreview as ComponentType<never>
      )
    ).toBeNull();
  });
  it('selects React Component Registry Docs with owned state and readonly view sources', async () => {
    const tree = await route('render', 'guides', 'registry');
    const workspace = findElement(tree, WebsiteWorkspace as ComponentType<never>);
    const article = findElement(workspace?.props.reactDocsSlot, ReactRegistryPreview as ComponentType<never>);
    expect(article).not.toBeNull();
    expect(article?.props.exampleCode?.assetPaths).toContain('cockpit/render/registry/react/src/app.tsx');
    expect(article?.props.exampleCode?.assetPaths).toContain('cockpit/render/registry/react/src/views.tsx');
    expect(article?.props.exampleCode?.assetPaths?.some(path => path.includes('/python/'))).toBe(false);
    expect(findElement(workspace?.props.reactDocsSlot, ReactRenderSpecPreview as ComponentType<never>)).toBeNull();
  });
  it('selects React Repeat Loops Docs with owned state and readonly view sources', async () => {
    const tree = await route('render', 'guides', 'repeat-loops');
    const workspace = findElement(tree, WebsiteWorkspace as ComponentType<never>);
    const article = findElement(workspace?.props.reactDocsSlot, ReactRepeatLoopsPreview as ComponentType<never>);
    expect(article).not.toBeNull();
    expect(article?.props.exampleCode?.assetPaths).toContain('cockpit/render/repeat-loops/react/src/items.ts');
    expect(article?.props.exampleCode?.assetPaths).toContain('cockpit/render/repeat-loops/react/src/views.tsx');
    expect(article?.props.exampleCode?.assetPaths?.some(path => path.includes('/python/'))).toBe(false);
    expect(findElement(workspace?.props.reactDocsSlot, ReactRenderSpecPreview as ComponentType<never>)).toBeNull();
  });
  it('selects React State Management Docs with owned state and readonly view sources', async () => {
    const tree = await route('render', 'guides', 'state-store');
    const workspace = findElement(tree, WebsiteWorkspace as ComponentType<never>);
    const article = findElement(workspace?.props.reactDocsSlot, ReactStateManagementPreview as ComponentType<never>);
    expect(article).not.toBeNull();
    expect(article?.props.exampleCode?.assetPaths).toContain('cockpit/render/state-management/react/src/state.ts');
    expect(article?.props.exampleCode?.assetPaths).toContain('cockpit/render/state-management/react/src/views.tsx');
    expect(article?.props.exampleCode?.assetPaths?.some(path => path.includes('/python/'))).toBe(false);
    expect(findElement(workspace?.props.reactDocsSlot, ReactRenderSpecPreview as ComponentType<never>)).toBeNull();
  });
  it('selects native Computed Functions Docs on canonical provide-render with owned pure callback sources', async () => {
    const tree = await route('render', 'api', 'provide-render');
    const workspace = findElement(tree, WebsiteWorkspace as ComponentType<never>);
    const article = findElement(workspace?.props.reactDocsSlot, ReactComputedFunctionsPreview as ComponentType<never>);
    expect(article).not.toBeNull();
    expect(article?.props.exampleCode?.assetPaths).toContain('cockpit/render/computed-functions/react/src/functions.ts');
    expect(article?.props.exampleCode?.assetPaths).toContain('cockpit/render/computed-functions/react/src/projection.ts');
    expect(article?.props.exampleCode?.assetPaths?.some(path => path.includes('/python/'))).toBe(false);
    expect(findElement(workspace?.props.reactDocsSlot, ReactRenderSpecPreview as ComponentType<never>)).toBeNull();
  });

  it('selects the local React Render Spec guide and owned renderer sources without Python assets', async () => {
    const tree = await route('render', 'guides', 'specs');
    const workspace = findElement(tree, WebsiteWorkspace as ComponentType<never>);
    const article = findElement(workspace?.props.reactDocsSlot, ReactRenderSpecPreview as ComponentType<never>);
    expect(article).not.toBeNull();
    expect(article?.props.exampleCode?.assetPaths).toContain('cockpit/render/spec-rendering/react/src/playback.ts');
    expect(article?.props.exampleCode?.assetPaths).toContain('cockpit/render/spec-rendering/react/src/views.tsx');
    expect(article?.props.exampleCode?.assetPaths?.some(path => path.includes('/python/'))).toBe(false);
  });
  it('selects the native trip specialists Docs with exact child policy and bridge sources', async () => {
    const tree=await route('ag-ui','guides','subagents');
    const workspace=findElement(tree,WebsiteWorkspace as ComponentType<never>);
    const article=findElement(workspace?.props.reactDocsSlot,ReactAgUiSubagentsPreview as ComponentType<never>);
    expect(article).not.toBeNull();
    expect(article?.props.exampleCode?.assetPaths).toContain('cockpit/ag-ui/subagents/react/src/children.ts');
    expect(article?.props.exampleCode?.assetPaths).toContain('cockpit/ag-ui/subagents/python/src/streaming/subagent_emitting_agent.py');
    expect(findElement(workspace?.props.reactDocsSlot,ReactAgUiJsonRenderPreview as ComponentType<never>)).toBeNull();
  });
  it('selects native JSON Render Docs with the exact dashboard policy, views and data tools', async () => {
    const tree=await route('ag-ui','guides','json-render');
    const workspace=findElement(tree,WebsiteWorkspace as ComponentType<never>);
    const article=findElement(workspace?.props.reactDocsSlot,ReactAgUiJsonRenderPreview as ComponentType<never>);
    expect(article).not.toBeNull();
    expect(article?.props.exampleCode?.assetPaths).toContain('cockpit/ag-ui/json-render/react/src/dashboard-policy.ts');
    expect(article?.props.exampleCode?.assetPaths).toContain('cockpit/ag-ui/json-render/react/src/dashboard-views.tsx');
    expect(article?.props.exampleCode?.assetPaths).toContain('cockpit/ag-ui/json-render/python/src/dashboard_tools.py');
    expect(findElement(workspace?.props.reactDocsSlot,ReactAgUiToolViewsPreview as ComponentType<never>)).toBeNull();
  });
  it('selects the authored native weather guide and server sources on AG-UI Tool Views', async () => {
    const tree = await route('ag-ui','guides','tool-views');
    const workspace = findElement(tree,WebsiteWorkspace as ComponentType<never>);
    const article = findElement(workspace?.props.reactDocsSlot,ReactAgUiToolViewsPreview as ComponentType<never>);
    expect(article).not.toBeNull();
    expect(article?.props.exampleCode?.assetPaths).toContain('cockpit/ag-ui/tool-views/react/src/tool-view-policy.ts');
    expect(article?.props.exampleCode?.assetPaths).toContain('cockpit/ag-ui/tool-views/python/src/graph.py');
    expect(findElement(workspace?.props.reactDocsSlot,ReactAgUiStreamingPreview as ComponentType<never>)).toBeNull();
    expect(findElement(workspace?.props.reactDocsSlot,ReactAgUiInterruptsPreview as ComponentType<never>)).toBeNull();
  });
  it('selects native AG-UI approval Docs on the canonical Interrupts guide without borrowing LangGraph', async () => {
    const tree = await route('ag-ui', 'guides', 'interrupts');
    const workspace = findElement(tree, WebsiteWorkspace as ComponentType<never>);
    const article = findElement(workspace?.props.reactDocsSlot, ReactAgUiInterruptsPreview as ComponentType<never>);
    expect(article).not.toBeNull();
    expect(article?.props.exampleCode?.assetPaths).toContain('cockpit/ag-ui/interrupts/react/src/approval-policy.ts');
    expect(article?.props.exampleCode?.assetPaths).toContain('cockpit/ag-ui/interrupts/python/src/native_agent.py');
    expect(findElement(workspace?.props.reactDocsSlot, ReactInterruptsPreview as ComponentType<never>)).toBeNull();
    expect(findElement(workspace?.props.reactDocsSlot, ReactAgUiStreamingPreview as ComponentType<never>)).toBeNull();
  });
  it('selects the authored AG-UI Streaming Docs on Event Mapping without selecting LangGraph Streaming', async () => {
    const tree = await route('ag-ui','reference','event-mapping');
    const workspace = findElement(tree,WebsiteWorkspace as ComponentType<never>);
    const article = findElement(workspace?.props.reactDocsSlot,ReactAgUiStreamingPreview as ComponentType<never>);
    expect(article).not.toBeNull();
    expect(article?.props.exampleCode?.assetPaths).toContain('cockpit/ag-ui/streaming/react/src/app.tsx');
    expect(findElement(workspace?.props.reactDocsSlot,ReactStreamingPreview as ComponentType<never>)).toBeNull();
  });
  it('selects the authored client-tools preview on the canonical Chat route', async () => {
    const tree = await route('chat', 'guides', 'client-tools');
    const workspace = findElement(
      tree,
      WebsiteWorkspace as ComponentType<never>
    );
    const article = findElement(
      workspace?.props.reactDocsSlot,
      ReactClientToolsPreview as ComponentType<never>
    );
    expect(article).not.toBeNull();
    expect(article?.props.exampleCode?.assetPaths).toContain(
      'cockpit/langgraph/client-tools/react/src/tools.ts'
    );
    expect(workspace?.props.contentBundle?.runtimeUrl).toMatch(
      /langgraph\/client-tools/
    );
  });
  it.each([
    ['streaming', ReactStreamingPreview],
    ['interrupts', ReactInterruptsPreview],
    ['memory', ReactMemoryPreview],
    ['persistence', ReactPersistencePreview],
    ['durable-execution', ReactDurableExecutionPreview],
    ['subgraphs', ReactSubgraphsPreview],
    ['time-travel', ReactTimeTravelPreview],
    ['deployment', ReactDeploymentRuntimePreview],
  ] as const)(
    'selects topic-specific authored React Docs for %s',
    async (slug, component) => {
      const tree = await route('langgraph', 'guides', slug);
      const workspace = findElement(
        tree,
        WebsiteWorkspace as ComponentType<never>
      );
      const article = findElement(
        workspace?.props.reactDocsSlot,
        component as ComponentType<never>
      );
      expect(article).not.toBeNull();
      expect(article?.props.exampleCode?.assetPaths).toContain(
        `cockpit/langgraph/${
          slug === 'deployment' ? 'deployment-runtime' : slug
        }/react/src/app.tsx`
      );
      expect(
        findElement(
          workspace?.props.reactDocsSlot,
          (slug === 'streaming'
            ? ReactInterruptsPreview
            : ReactStreamingPreview) as ComponentType<never>
        )
      ).toBeNull();
    }
  );
  it('passes mapped descriptor-backed content and the requested mode to the client boundary', async () => {
    const tree = await route('langgraph', 'guides', 'streaming', 'code');
    const workspace = findElement(
      tree,
      WebsiteWorkspace as ComponentType<never>
    );

    expect(workspace).toBeTruthy();
    // Search state belongs to the client workspace adapter so this canonical
    // Docs route remains statically generated.
    expect(workspace?.props.requestedMode).toBeUndefined();
    expect(workspace?.props.resolution).toMatchObject({
      kind: 'mapped',
      identity: { availableModes: ['Docs', 'Run', 'Code', 'API'] },
    });
    expect(workspace?.props.contentBundle?.runtimeUrl).toMatch(
      /(?:langgraph\/streaming|localhost:4300)$/
    );
    expect(workspace?.props.docsContext).toEqual({
      activeLibrary: 'langgraph',
      activeSection: 'guides',
      activeSlug: 'streaming',
    });

    const mdx = findElement(
      workspace?.props.docsSlot,
      MdxRenderer as ComponentType<never>
    );
    expect(mdx?.props.exampleCode?.assetPaths).toContain(
      'cockpit/langgraph/streaming/angular/src/app/streaming.component.ts'
    );
    // The server-rendered <ExampleCode> keeps the raw sources; the client
    // boundary must not carry a second copy of them into the RSC payload.
    expect(Object.keys(mdx?.props.exampleCode?.sources ?? {})).toContain(
      'cockpit/langgraph/streaming/angular/src/app/streaming.component.ts'
    );
    expect(workspace?.props.contentBundle?.codeSources).toEqual({});
  });

  it('keeps an unmapped page as a complete server Docs slot', async () => {
    const tree = await route('langgraph', 'guides', 'testing', 'run');
    const workspace = findElement(
      tree,
      WebsiteWorkspace as ComponentType<never>
    );
    const slot = workspace?.props.docsSlot;

    expect(workspace?.props.resolution).toMatchObject({ kind: 'docs-only' });
    expect(
      findElement(slot, DocsPageHeader as ComponentType<never>)
    ).toBeTruthy();
    expect(findElement(slot, MdxRenderer as ComponentType<never>)).toBeTruthy();
    expect(
      findElement(slot, MdxRenderer as ComponentType<never>)?.props.exampleCode
    ).toBeNull();
    expect(
      findElement(slot, MdxRenderer as ComponentType<never>)?.props.docsPath
    ).toBe('/docs/langgraph/guides/testing');
    expect(findElement(slot, DocsTOC as ComponentType<never>)).toBeTruthy();
  });

  it('invites a search at the foot of a content page', async () => {
    const tree = await route('langgraph', 'guides', 'testing');
    const workspace = findElement(
      tree,
      WebsiteWorkspace as ComponentType<never>
    );

    expect(
      findElement(
        workspace?.props.docsSlot,
        DocsSearchFooter as ComponentType<never>
      )
    ).toBeTruthy();
  });

  it('hands the shell one accurate trail instead of four renditions', async () => {
    const tree = await route('ag-ui', 'getting-started', 'introduction');
    const workspace = findElement(
      tree,
      WebsiteWorkspace as ComponentType<never>
    );

    // Docs titles, not manifest identity: the derived label read
    // "Ag Ui / Getting Started / Overview".
    const trail = workspace?.props.contextTrail ?? [];
    expect(trail.map(({ label, href }) => ({ label, href }))).toEqual([
      { label: 'Docs', href: '/docs' },
      { label: 'AG-UI', href: '/docs/ag-ui/getting-started/introduction' },
      { label: 'Getting Started', href: undefined },
      { label: 'Introduction', href: undefined },
    ]);

    // Only the library rung carries the mark; the rest are plain labels.
    trail.forEach((crumb, index) => {
      if (index === 1) {
        expect(isValidElement(crumb.icon)).toBe(true);
        expect((crumb.icon as React.ReactElement).type).toBe(LibraryMark);
      } else {
        expect(crumb.icon).toBeUndefined();
      }
    });
  });

  it('keeps canonical metadata independent of the workspace mode query', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({
        library: 'langgraph',
        section: 'guides',
        slug: 'streaming',
      }),
      searchParams: Promise.resolve({ mode: 'run' }),
    } as never);

    expect(metadata.alternates?.canonical).toBe(
      '/docs/langgraph/guides/streaming'
    );
    expect(String(metadata.alternates?.canonical)).not.toContain('mode');
  });
});
