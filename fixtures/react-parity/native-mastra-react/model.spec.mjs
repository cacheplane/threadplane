import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectResponse } from './model.mjs';
const call = {
  type: 'function_call',
  call_id: 'opaque',
  name: 'reserve_campsite',
  arguments: JSON.stringify({ site: 'North Pines', nights: 2 }),
};
const input = (output) => ({
  input: [
    { role: 'user', content: 'Please reserve North Pines for 2 nights.' },
    call,
    { type: 'function_call_output', call_id: 'opaque', output },
  ],
});
test('initial request calls the actual reservation tool', () =>
  assert.equal(
    selectResponse({
      input: [
        { role: 'user', content: 'Please reserve North Pines for 2 nights.' },
      ],
    }).toolCalls[0].name,
    'reserve_campsite'
  ));
test('approval continuation matches exact correlated output', () =>
  assert.match(
    selectResponse(
      input(
        JSON.stringify(
          'Reserved North Pines for 2 night(s) — total $90. Confirmation TP-0288.'
        )
      )
    ).content,
    /approved/
  ));
test('decline continuation is truthful and matched before initial text', () =>
  assert.match(
    selectResponse(
      input(
        JSON.stringify(
          'Reservation for North Pines was declined by the user. Nothing was booked.'
        )
      )
    ).content,
    /Nothing was booked/
  ));
test('unmatched and incorrectly correlated continuations fail closed', () => {
  assert.throws(() => selectResponse(input('Booked')), /Unmatched/);
  const body = input(
    JSON.stringify(
      'Reservation for North Pines was declined by the user. Nothing was booked.'
    )
  );
  body.input[2].call_id = 'other';
  assert.throws(() => selectResponse(body), /Unmatched/);
  assert.throws(
    () => selectResponse({ input: [{ role: 'user', content: 'weather' }] }),
    /Unmatched/
  );
});
test('ambiguous tool-output histories cannot grant a truthful continuation', () => {
  const body = input(
    JSON.stringify(
      'Reservation for North Pines was declined by the user. Nothing was booked.'
    )
  );
  body.input.push({ ...body.input[2] });
  assert.throws(() => selectResponse(body), /Unmatched/);
  const duplicate = input(
    JSON.stringify(
      'Reservation for North Pines was declined by the user. Nothing was booked.'
    )
  );
  duplicate.input.push({ ...call, call_id: 'unrelated' });
  assert.throws(() => selectResponse(duplicate), /Unmatched/);
});
