import {
  MessageRating,
  type MessageRatingProps,
  type MessageRatingValue,
} from './index.js';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Assert<T extends true> = T;
export type ValueContract = Assert<Equal<MessageRatingValue, 'up' | 'down'>>;
export type PropsContract = Assert<
  Equal<
    MessageRatingProps,
    {
      readonly messageId: string;
      readonly value: MessageRatingValue | null;
      readonly onValueChange: (
        value: MessageRatingValue | null,
        messageId: string
      ) => void;
      readonly disabled?: boolean;
      readonly label?: string;
      readonly upLabel?: string;
      readonly downLabel?: string;
      readonly className?: string;
    }
  >
>;
const props: MessageRatingProps = {
  messageId: 'm',
  value: null,
  onValueChange: (value, messageId) => void [value, messageId],
};
<MessageRating {...props} />;
<MessageRating
  {...props}
  value="down"
  disabled
  label="Feedback"
  upLabel="Helpful"
  downLabel="Not helpful"
  className="owned"
/>;
// @ts-expect-error Props are readonly.
props.value = 'up';
// @ts-expect-error Message identity is readonly.
props.messageId = 'other';
// @ts-expect-error The rating is controlled; the value cannot be omitted.
<MessageRating messageId="m" onValueChange={() => undefined} />;
// @ts-expect-error A rating belongs to one identified message.
<MessageRating value={null} onValueChange={() => undefined} />;
// @ts-expect-error Change requests must be handled by the owner.
<MessageRating messageId="m" value={null} />;
// @ts-expect-error An absent rating is null, not undefined.
<MessageRating {...props} value={undefined} />;
// @ts-expect-error Only up and down are ratings.
<MessageRating {...props} value="neutral" />;
// @ts-expect-error Message identity is a string.
<MessageRating {...props} messageId={1} />;
// @ts-expect-error Change requests carry a rating or null, not an event.
<MessageRating {...props} onValueChange={(event: MouseEvent) => void event} />;
// @ts-expect-error Disabled values are booleans.
<MessageRating {...props} disabled="true" />;
const node = <b />;
// @ts-expect-error Labels are text, not nodes.
<MessageRating {...props} upLabel={node} />;
// @ts-expect-error Raw DOM handlers are not accepted.
<MessageRating {...props} onClick={() => undefined} />;
// @ts-expect-error Sessions are not supplied to this presentation primitive.
<MessageRating {...props} session={{}} />;
