import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { HistorySearchPalette } from '@threadplane/react/chat';
import type { ReactApplication, ReactApplicationSnapshot } from './application';
import type { ThreadRow } from '../../shared/contracts';
import { filterLoadedTitles } from '../../shared/projection';

interface Request {
  readonly application: ReactApplication;
  readonly token: object;
  readonly query: string;
}

/** Search only the loaded slice; the existing application remains the selection owner. */
export function useLoadedConversationSearch(
  application: ReactApplication,
  snapshot: ReactApplicationSnapshot,
  onSelected: (row: ThreadRow) => void
) {
  const [request, setRequest] = useState<Request | null>(null);
  const current = useRef<Request | null>(null);
  const owner = useRef<ReactApplication | null>(null);
  const reveal = useRef(onSelected);
  useLayoutEffect(() => {
    owner.current = application;
    if (current.current && current.current.application !== application) {
      current.current = null;
      setRequest(null);
    }
    return () => {
      owner.current = null;
    };
  }, [application]);
  useLayoutEffect(() => {
    reveal.current = onSelected;
  }, [onSelected]);
  const owned = request?.application === application ? request : null;
  const query = owned?.query ?? '';
  const results = useMemo(
    () =>
      filterLoadedTitles(
        snapshot.list.rows.map((row) => ({
          ...row,
          title: row.title || row.id,
        })),
        query
      ).map((row) => ({
        id: row.id,
        title: row.title,
        subtitle: `${row.archived === true ? 'Archived' : 'Active'} · ${
          row.projectId ? `Project ${row.projectId}` : 'No project'
        }`,
      })),
    [snapshot.list.rows, query]
  );
  const active = () =>
    !!owned &&
    owner.current === application &&
    current.current?.token === owned.token &&
    current.current.application === application;
  const retire = () => {
    if (!active()) return false;
    current.current = null;
    setRequest(null);
    return true;
  };
  return {
    openSearch() {
      if (owner.current !== application) return;
      const next = { application, token: {}, query: '' };
      current.current = next;
      setRequest(next);
    },
    palette: (
      <HistorySearchPalette
        open={owned !== null}
        query={query}
        results={results}
        loading={snapshot.list.status === 'pending'}
        label="Search loaded conversations"
        description={`${
          snapshot.list.status === 'error' ? 'Refresh failed. ' : ''
        }Search titles from up to 50 loaded conversations across all projects, including archived.`}
        onQueryChange={(value) => {
          if (!active() || !current.current) return;
          const next = { ...current.current, query: value };
          current.current = next;
          setRequest(next);
        }}
        onClose={retire}
        onSelect={(id) => {
          if (!active()) return;
          const latest = application.getSnapshot();
          if (latest.list.status === 'pending') return;
          const row = latest.list.rows.find((candidate) => candidate.id === id);
          if (!row || !retire()) return;
          reveal.current(row);
          application.select(id);
        }}
      />
    ),
  };
}
