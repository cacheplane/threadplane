'use client';

import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { FileTree } from './file-tree';

interface CodeModeProps {
  entryTitle: string;
  codeAssetPaths: readonly string[];
  backendAssetPaths: readonly string[];
  codeFiles: Record<string, string>;
  promptFiles: Record<string, string>;
  capability?: string;
}

const getTabLabel = (path: string): string => path.split('/').pop() ?? path;

function CodeFileContent({
  path,
  content,
}: {
  path: string;
  content: string | undefined;
}) {
  if (!content) {
    return <p className="workspace-code-pane__empty">No source available for {getTabLabel(path)}</p>;
  }
  return <div className="workspace-code-pane" dangerouslySetInnerHTML={{ __html: content }} />;
}

export function CodeMode({ entryTitle, codeAssetPaths, backendAssetPaths, codeFiles, promptFiles, capability }: CodeModeProps) {
  const promptPaths = React.useMemo(() => Object.keys(promptFiles), [promptFiles]);
  const allPaths = React.useMemo(
    () => [...new Set([...codeAssetPaths, ...backendAssetPaths, ...promptPaths])],
    [codeAssetPaths, backendAssetPaths, promptPaths],
  );

  const [openPaths, setOpenPaths] = React.useState<readonly string[]>(allPaths);
  const [activePath, setActivePath] = React.useState<string | null>(allPaths[0] ?? null);

  const [treeCollapsed, setTreeCollapsed] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage.getItem('cockpit:codeTree:collapsed') === '1') {
        setTreeCollapsed(true);
      }
    } catch {
      /* ignore */
    }
    // Mark mounted on next animation frame so the localStorage state lands BEFORE
    // the transition class is applied — no animated collapse on hard reload.
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const toggleTreeCollapsed = React.useCallback(() => {
    setTreeCollapsed((prev) => {
      const next = !prev;
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('cockpit:codeTree:collapsed', next ? '1' : '0');
        }
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // If the capability changes (allPaths changes identity), reset open + active.
  React.useEffect(() => {
    setOpenPaths(allPaths);
    setActivePath(allPaths[0] ?? null);
  }, [allPaths]);

  const handleSelect = React.useCallback((path: string) => {
    setOpenPaths((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setActivePath(path);
  }, []);

  const handleClose = React.useCallback((path: string) => {
    setOpenPaths((prev) => {
      const idx = prev.indexOf(path);
      if (idx < 0) return prev;
      const next = prev.filter((p) => p !== path);
      setActivePath((current) => {
        if (current !== path) return current;
        if (next.length === 0) return null;
        // Activate the left neighbor; if the closed tab was leftmost (idx 0),
        // the new leftmost (next[0]) becomes active.
        const neighborIdx = Math.max(0, idx - 1);
        return next[neighborIdx];
      });
      return next;
    });
  }, []);

  if (allPaths.length === 0) {
    return (
      <section aria-label="Code mode" className="grid place-items-center h-full text-[var(--ds-text-muted)] text-sm">
        <p>No files available for {entryTitle}.</p>
      </section>
    );
  }

  const isPromptPath = (path: string) => promptPaths.includes(path);

  return (
    <section aria-label="Code mode" className="h-full lg:flex lg:overflow-hidden">
      <aside
        aria-label="File tree"
        className={`hidden lg:flex lg:flex-col flex-none overflow-hidden border-r border-[var(--ds-border)] ${mounted ? 'transition-[width] duration-200' : ''} ${treeCollapsed ? 'lg:w-0 lg:border-r-0' : 'lg:w-[220px]'}`}
        style={{ background: 'color-mix(in srgb, var(--ds-surface-tinted) 40%, transparent)' }}
      >
        <div className="flex items-center justify-between px-2 py-1.5 border-b border-[var(--ds-border)]" style={{ background: 'color-mix(in srgb, var(--ds-surface-tinted) 70%, transparent)' }}>
          <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--ds-text-muted)] pl-1">Files</span>
          <button
            type="button"
            aria-label="Collapse file tree"
            onClick={toggleTreeCollapsed}
            className="text-[var(--ds-text-muted)] hover:text-[var(--ds-text-primary)] px-1.5 py-0.5 rounded"
          >‹</button>
        </div>
        <FileTree paths={allPaths} activePath={activePath} onSelect={handleSelect} />
      </aside>

      <div className="flex flex-col h-full min-w-0 flex-1">
        {treeCollapsed ? (
          <button
            type="button"
            aria-label="Expand file tree"
            onClick={toggleTreeCollapsed}
            className="hidden lg:flex shrink-0 items-center justify-center w-7 self-start mt-1 ml-1 rounded text-[var(--ds-accent)] hover:bg-[var(--ds-accent-surface)]"
          >›</button>
        ) : null}
        {openPaths.length === 0 || activePath === null ? (
          <div className="flex-1 grid place-items-center text-sm text-[var(--ds-text-muted)] px-4 text-center">
            <p>Select a file from the tree to begin.</p>
          </div>
        ) : (
          <Tabs
            value={activePath}
            onValueChange={(v) => setActivePath(v)}
            className="flex flex-col h-full"
          >
            <TabsList className="shrink-0">
              {openPaths.map((path) => {
                const label = getTabLabel(path);
                return (
                  <TabsTrigger
                    key={path}
                    value={path}
                    className={
                      isPromptPath(path)
                        ? 'text-[var(--ds-accent)]/70 data-[state=active]:text-[var(--ds-accent)] workspace-tab-trigger'
                        : 'workspace-tab-trigger'
                    }
                  >
                    <span>{label}</span>
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Close ${label}`}
                      data-tab-close
                      onPointerDown={(e) => { e.stopPropagation(); }}
                      onClick={(e) => { e.stopPropagation(); handleClose(path); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          handleClose(path);
                        }
                      }}
                      className="workspace-tab-trigger__close"
                    >×</span>
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {openPaths.filter((p) => !isPromptPath(p)).map((path) => (
              <TabsContent key={path} value={path} className="flex-1 overflow-auto">
                <CodeFileContent path={path} content={codeFiles[path]} />
              </TabsContent>
            ))}

            {openPaths.filter(isPromptPath).map((path) => {
              const content = promptFiles[path];
              return (
                <TabsContent key={path} value={path} className="flex-1 overflow-auto">
                  {content ? (
                    <pre className="workspace-code-pane workspace-code-pane--plain">{content}</pre>
                  ) : (
                    <p className="workspace-code-pane__empty">No content for {getTabLabel(path)}</p>
                  )}
                </TabsContent>
              );
            })}
          </Tabs>
        )}
      </div>
    </section>
  );
}
