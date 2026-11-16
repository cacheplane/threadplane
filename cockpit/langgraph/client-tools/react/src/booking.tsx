import { createContext, useContext } from 'react';
import {
  ApprovalCard,
  ask,
  createClientTools,
  type AskTool,
  type AskToolViewProps,
  type ClientTools,
} from '@threadplane/react/chat';

export interface BookingArguments { summary: string }
export interface BookingDecision { confirmed: boolean }
export type BookingTools = ClientTools<{
  confirm_booking: AskTool<BookingArguments, BookingDecision>;
}>;

/** Tells the application about an answer the card admitted; the card works without it. */
export const BookingAnswered = createContext<(confirmed: boolean) => void>(
  () => undefined
);

function BookingCard({
  args,
  answer,
  autoFocus,
}: AskToolViewProps<BookingArguments, BookingDecision> & {
  readonly autoFocus: boolean;
}) {
  const answered = useContext(BookingAnswered);
  // Only the first answer counts; a stopped booking admits none.
  const decide = (confirmed: boolean) => {
    if (answer({ confirmed })) answered(confirmed);
  };
  return (
    <ApprovalCard
      title="Confirm this fictional booking?"
      autoFocus={autoFocus}
      actions={[
        { id: 'confirm', label: 'Confirm booking', onSelect: () => decide(true) },
        { id: 'cancel', label: "Don't book", onSelect: () => decide(false) },
      ]}
    >
      <p>{args.summary}</p>
      <p>No real reservation is made.</p>
    </ApprovalCard>
  );
}

/** The booking question as an ask tool: the model calls it and the person answers in the transcript. */
export function createBookingTools(): BookingTools {
  const tools: BookingTools = createClientTools({
    confirm_booking: ask<BookingArguments, BookingDecision>({
      description: 'Ask the user to confirm a fictional booking. No real reservation is made.',
      parameters: {
        type: 'object',
        properties: { summary: { type: 'string', minLength: 1 } },
        required: ['summary'],
        additionalProperties: false,
      },
      // Of parallel bookings only the oldest takes focus.
      render: (props) => (
        <BookingCard
          {...props}
          autoFocus={tools.getSnapshot()[0]?.args === props.args}
        />
      ),
    }),
  });
  return tools;
}
