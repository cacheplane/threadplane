import { StrictMode } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AnswerRating,
  AnswerRatings,
  AnswerRatingScope,
} from './answer-rating';

afterEach(cleanup);
const pressed = (button: HTMLElement) => button.getAttribute('aria-pressed');

function Harness({
  conversationId,
  messages = ['answer'],
}: {
  conversationId: string | null;
  messages?: readonly string[];
}) {
  return (
    <AnswerRatingScope conversationId={conversationId}>
      {messages.map((id) => (
        <section key={id} aria-label={id}>
          <AnswerRating messageId={id} />
        </section>
      ))}
    </AnswerRatingScope>
  );
}

describe('native AnswerRating', () => {
  it('keeps an application-owned rating per answer and names where it is kept', () => {
    const view = render(
      <StrictMode>
        <AnswerRatings>
          <Harness conversationId="a" messages={['one', 'two']} />
        </AnswerRatings>
      </StrictMode>
    );
    const groups = view.getAllByRole('group', {
      name: 'Rate answer (kept on this page only)',
    });
    expect(groups.map((group) => group.dataset['messageId'])).toEqual([
      'one',
      'two',
    ]);
    const [good, poor, otherGood] = view.getAllByRole('button');
    expect(good.textContent).toBe('Good answer');
    fireEvent.click(good);
    expect([pressed(good), pressed(poor), pressed(otherGood)]).toEqual([
      'true',
      'false',
      'false',
    ]);
    expect(view.queryByRole('status')).toBeNull();
    fireEvent.click(poor);
    expect([pressed(good), pressed(poor)]).toEqual(['false', 'true']);
    fireEvent.click(poor);
    expect([pressed(good), pressed(poor)]).toEqual(['false', 'false']);
  });

  it('scopes equal message identities to their conversation and restores them on return', () => {
    const view = render(
      <AnswerRatings>
        <Harness conversationId="a" />
      </AnswerRatings>
    );
    fireEvent.click(view.getByRole('button', { name: 'Good answer' }));
    view.rerender(
      <AnswerRatings>
        <Harness conversationId="b" />
      </AnswerRatings>
    );
    expect(pressed(view.getByRole('button', { name: 'Good answer' }))).toBe(
      'false'
    );
    fireEvent.click(view.getByRole('button', { name: 'Poor answer' }));
    view.rerender(
      <AnswerRatings>
        <Harness conversationId="a" />
      </AnswerRatings>
    );
    expect(pressed(view.getByRole('button', { name: 'Good answer' }))).toBe(
      'true'
    );
    expect(pressed(view.getByRole('button', { name: 'Poor answer' }))).toBe(
      'false'
    );
  });

  it('renders nothing without a saved conversation or an owner', () => {
    const unsaved = render(
      <AnswerRatings>
        <Harness conversationId={null} />
      </AnswerRatings>
    );
    expect(unsaved.queryByRole('group')).toBeNull();
    unsaved.unmount();
    const unowned = render(<Harness conversationId="a" />);
    expect(unowned.queryByRole('group')).toBeNull();
  });
});
