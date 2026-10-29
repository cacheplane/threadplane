import { useEffect, useRef, useState, type RefObject } from 'react';
import type { ThreadRow } from '../../shared/contracts';
import type { ReactApplication, ReactApplicationSnapshot } from './application';
import { MoveConversation, type MoveRequest } from './move-conversation';

type OwnedMoveRequest = MoveRequest & {
  readonly application: ReactApplication;
};

type Feedback = Readonly<{
  title: string;
  name: string;
  status: 'pending' | 'confirmed' | 'failed';
}>;

/** Directory-level ownership survives a row leaving the active project filter. */
export function useProjectMove(
  application: ReactApplication,
  snapshot: ReactApplicationSnapshot,
  fallback: RefObject<HTMLInputElement | null>
) {
  const [storedEditor, setEditor] = useState<OwnedMoveRequest | null>(null);
  const editor =
    storedEditor?.application === application ? storedEditor : null;
  const owner = useRef<OwnedMoveRequest | null>(null);
  const sequence = useRef(0);
  const mounted = useRef(false);
  const operations = useRef(new Map<string, object>());
  const [feedbackState, setFeedback] = useState<{
    readonly application: ReactApplication;
    readonly values: Readonly<Record<string, Feedback>>;
  }>({ application, values: {} });
  const feedback =
    feedbackState.application === application ? feedbackState.values : {};
  const publishFeedback = (id: string, value: Feedback) =>
    setFeedback((latest) => ({
      application,
      values: {
        ...(latest.application === application ? latest.values : {}),
        [id]: value,
      },
    }));
  useEffect(() => {
    mounted.current = true;
    setEditor((latest) =>
      latest?.application === application ? latest : null
    );
    setFeedback((latest) =>
      latest.application === application ? latest : { application, values: {} }
    );
    return () => {
      mounted.current = false;
      owner.current = null;
      operations.current.clear();
    };
  }, [application]);
  const dismiss = () => {
    owner.current = null;
    setEditor(null);
  };
  const close = (request: MoveRequest) => {
    if (owner.current !== request || owner.current.application !== application)
      return;
    dismiss();
  };
  const blocked = (id: string) =>
    (snapshot.deletion.status === 'pending' ||
      snapshot.deletion.status === 'unconfirmed') &&
    snapshot.deletion.id === id;
  const requestMove = (row: ThreadRow, returnFocusTo: HTMLElement | null) => {
    if (
      !application.canSetProject?.() ||
      blocked(row.id) ||
      snapshot.projectMoves?.[row.id]?.status === 'pending'
    )
      return;
    const request = Object.freeze({
      application,
      id: row.id,
      title: row.title,
      projectId: row.projectId ?? null,
      token: ++sequence.current,
      returnFocusTo,
    });
    owner.current = request;
    setEditor(request);
  };
  const move = async (
    request: OwnedMoveRequest,
    projectId: string | null,
    name: string
  ): Promise<boolean> => {
    if (
      request.application !== application ||
      operations.current.has(request.id) ||
      owner.current !== request
    )
      return false;
    const operation = {};
    operations.current.set(request.id, operation);
    publishFeedback(request.id, {
      title: request.title,
      name,
      status: 'pending',
    });
    let confirmed = false;
    try {
      confirmed = await application.setProject(request.id, projectId);
    } catch {
      /* Keep unconfirmed intent available for explicit retry. */
    }
    if (!mounted.current || operations.current.get(request.id) !== operation)
      return false;
    operations.current.delete(request.id);
    publishFeedback(request.id, {
      title: request.title,
      name,
      status: confirmed ? 'confirmed' : 'failed',
    });
    return confirmed;
  };
  const displayed = new Map(Object.entries(feedback));
  for (const [id, state] of Object.entries(snapshot.projectMoves ?? {})) {
    if (state.status === 'pending')
      displayed.set(id, {
        title:
          feedback[id]?.title ??
          snapshot.list.rows.find((row) => row.id === id)?.title ??
          id,
        name: feedback[id]?.name ?? state.projectId ?? 'No project',
        status: 'pending',
      });
  }
  const current = editor
    ? snapshot.list.rows.find((row) => row.id === editor.id) ??
      (snapshot.selection.id === editor.id ? snapshot.selection.row : undefined)
    : undefined;
  return {
    requestMove,
    dismiss,
    editor: editor ? (
      <MoveConversation
        key={editor.token}
        request={editor}
        rows={snapshot.list.rows}
        currentProjectId={current?.projectId ?? null}
        pending={snapshot.projectMoves?.[editor.id]?.status === 'pending'}
        blocked={!current || blocked(editor.id)}
        onMove={(projectId, name) => move(editor, projectId, name)}
        onClose={close}
        fallbackFocusTo={() => fallback.current}
      />
    ) : null,
    feedback: Array.from(displayed, ([id, state]) => (
      <p role="status" key={id} className="conversation-project-feedback">
        {state.status === 'pending'
          ? `Moving conversation: ${state.title} (${id})…`
          : state.status === 'confirmed'
          ? `Conversation moved: ${state.title} (${id}) → ${state.name}.`
          : `Conversation move unconfirmed: ${state.title} (${id}). Refresh or try again.`}
      </p>
    )),
  };
}
