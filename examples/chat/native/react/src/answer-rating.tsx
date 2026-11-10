import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  MessageRating,
  type MessageRatingValue,
} from '@threadplane/react/chat';

type Ratings = {
  readonly values: ReadonlyMap<string, MessageRatingValue>;
  readonly rate: (key: string, value: MessageRatingValue | null) => void;
};
const RatingsContext = createContext<Ratings | null>(null);
const ScopeContext = createContext<string | null>(null);

/**
 * Application-owned ratings held in memory for this page only. Nothing is
 * stored or sent; a reload forgets every rating.
 */
export function AnswerRatings({ children }: { readonly children: ReactNode }) {
  const [values, setValues] = useState<ReadonlyMap<string, MessageRatingValue>>(
    () => new Map()
  );
  const rate = useCallback(
    (key: string, value: MessageRatingValue | null) =>
      setValues((previous) => {
        if ((previous.get(key) ?? null) === value) return previous;
        const next = new Map(previous);
        if (value === null) next.delete(key);
        else next.set(key, value);
        return next;
      }),
    []
  );
  const ratings = useMemo(() => ({ values, rate }), [values, rate]);
  return (
    <RatingsContext.Provider value={ratings}>
      {children}
    </RatingsContext.Provider>
  );
}

/** Names the conversation whose message identities the nested ratings belong to. */
export function AnswerRatingScope({
  conversationId,
  children,
}: {
  readonly conversationId: string | null;
  readonly children: ReactNode;
}) {
  return (
    <ScopeContext.Provider value={conversationId}>
      {children}
    </ScopeContext.Provider>
  );
}

/** Rates one answer of the scoped conversation. Renders nothing outside a saved conversation. */
export function AnswerRating({ messageId }: { readonly messageId: string }) {
  const ratings = useContext(RatingsContext);
  const conversationId = useContext(ScopeContext);
  if (!ratings || conversationId === null) return null;
  const key = JSON.stringify([conversationId, messageId]);
  const value = ratings.values.get(key) ?? null;
  return (
    <MessageRating
      messageId={messageId}
      value={value}
      onValueChange={(next) => ratings.rate(key, next)}
      label="Rate answer (kept on this page only)"
      upLabel="Good answer"
      downLabel="Poor answer"
    />
  );
}
