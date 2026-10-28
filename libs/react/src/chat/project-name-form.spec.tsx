import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import * as chat from './index';
afterEach(cleanup);
it('exports an app-owned project name editor', () => {
  expect(chat).toHaveProperty('ProjectNameForm');
});
it('controls literal names, preserves input and focus, and submits only explicit nonblank non-IME input', () => {
  const Form = chat.ProjectNameForm;
  const onSubmit = vi.fn(),
    onCancel = vi.fn(),
    onValueChange = vi.fn();
  const props = { value: '<Project>', onSubmit, onCancel, onValueChange };
  const view = render(<Form {...props} submitLabel="Create" />);
  const input = view.getByRole('textbox', {
    name: 'Project name',
  }) as HTMLInputElement;
  expect(input.value).toBe('<Project>');
  expect(document.activeElement).toBe(input);
  expect([input.selectionStart, input.selectionEnd]).toEqual([0, 9]);
  fireEvent.change(input, { target: { value: 'changed' } });
  expect(onValueChange).toHaveBeenCalledWith('changed');
  expect(input.value).toBe('<Project>');
  fireEvent.blur(input);
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.click(view.getByRole('button', { name: 'Create' }));
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onSubmit).toHaveBeenCalledTimes(1);
  view.rerender(<Form {...props} value=" " />);
  expect(view.getByRole('textbox')).toBe(input);
  fireEvent.submit(input.closest('form') as HTMLFormElement);
  expect(onSubmit).toHaveBeenCalledTimes(1);
  view.rerender(<Form {...props} pending error="Literal <error>" />);
  expect(input.disabled).toBe(true);
  expect(view.getByRole('status').textContent).toBe('Saving project name…');
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(view.getByRole('alert').textContent).toBe('Literal <error>');
  fireEvent.submit(input.closest('form') as HTMLFormElement);
  expect(onSubmit).toHaveBeenCalledTimes(1);
  fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
  fireEvent.keyDown(input.closest('form') as HTMLFormElement, {
    key: 'Escape',
  });
  expect(onCancel).toHaveBeenCalledTimes(2);
});
it('can block submission while leaving the draft and cancellation available', () => {
  const submit = vi.fn(),
    cancel = vi.fn();
  const view = render(
    <chat.ProjectNameForm
      value="Kept"
      onValueChange={() => undefined}
      onSubmit={submit}
      onCancel={cancel}
      submitDisabled
    />
  );
  expect((view.getByRole('textbox') as HTMLInputElement).disabled).toBe(false);
  fireEvent.submit(view.container.querySelector('form') as HTMLFormElement);
  fireEvent.click(view.getByRole('button', { name: 'Save' }));
  expect(submit).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
  expect(cancel).toHaveBeenCalledTimes(1);
});
