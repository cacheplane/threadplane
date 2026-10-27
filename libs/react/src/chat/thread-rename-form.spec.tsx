import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThreadRenameForm } from './index';

afterEach(cleanup);

describe('ThreadRenameForm', () => {
  it('exports the controlled form', () => {
    expect(typeof ThreadRenameForm).toBe('function');
  });

  it('focuses and selects the title once, preserves input identity and delegates controlled changes', () => {
    const onValueChange = vi.fn();
    const props = {
      value: 'Original title',
      onValueChange,
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    };
    const view = render(<ThreadRenameForm {...props} />);
    const input = view.getByRole('textbox', {
      name: 'Conversation title',
    }) as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([
      0,
      props.value.length,
    ]);
    fireEvent.change(input, { target: { value: ' next  title ' } });
    expect(onValueChange).toHaveBeenCalledWith(' next  title ');
    expect(input.value).toBe(props.value);
    input.setSelectionRange(3, 3);
    view.rerender(<ThreadRenameForm {...props} value="Updated title" />);
    expect(view.getByRole('textbox')).toBe(input);
    expect(input.value).toBe('Updated title');
    expect(input.selectionStart).not.toBe(0);
  });

  it('submits only explicit Save, Enter or semantic submit and never changes its controlled value', () => {
    const onSubmit = vi.fn();
    const onValueChange = vi.fn();
    const view = render(
      <ThreadRenameForm
        value="  title  "
        onValueChange={onValueChange}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    );
    const input = view.getByRole('textbox');
    fireEvent.blur(input);
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button', { name: 'Save' }));
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(onSubmit).toHaveBeenCalledTimes(3);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('blocks IME Enter including keyCode 229', () => {
    const onSubmit = vi.fn();
    const view = render(
      <ThreadRenameForm
        value="日本語"
        onValueChange={vi.fn()}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    );
    fireEvent.keyDown(view.getByRole('textbox'), {
      key: 'Enter',
      isComposing: true,
    });
    fireEvent.keyDown(view.getByRole('textbox'), {
      key: 'Enter',
      keyCode: 229,
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('blocks empty trimmed titles and pending submission while Cancel remains available', () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const props = { value: ' \n ', onValueChange: vi.fn(), onSubmit, onCancel };
    const view = render(<ThreadRenameForm {...props} />);
    expect(view.getByRole('button', { name: 'Save' })).toHaveProperty(
      'disabled',
      true
    );
    fireEvent.submit(
      view.getByRole('textbox').closest('form') as HTMLFormElement
    );
    fireEvent.keyDown(view.getByRole('textbox'), { key: 'Enter' });
    view.rerender(<ThreadRenameForm {...props} value="title" pending />);
    expect(view.getByRole('textbox')).toHaveProperty('disabled', true);
    expect(view.getByRole('button', { name: 'Save' })).toHaveProperty(
      'disabled',
      true
    );
    expect(view.getByRole('status').textContent).toBe(
      'Saving conversation title…'
    );
    fireEvent.submit(
      view.getByRole('textbox').closest('form') as HTMLFormElement
    );
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Escape cancels before surrounding keyboard handlers, including from Cancel when pending', () => {
    const outer = vi.fn();
    const onCancel = vi.fn();
    const view = render(
      <div onKeyDown={outer}>
        <ThreadRenameForm
          value="title"
          onValueChange={vi.fn()}
          onSubmit={vi.fn()}
          onCancel={onCancel}
          pending
        />
      </div>
    );
    expect(document.activeElement).toBe(
      view.getByRole('button', { name: 'Cancel' })
    );
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();
  });

  it('wires custom labels, error description, invalid state and className', () => {
    const view = render(
      <ThreadRenameForm
        value="title"
        label="Title"
        error="Try again"
        className="custom"
        onValueChange={vi.fn()}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const input = view.getByRole('textbox', { name: 'Title' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(
      document.getElementById(input.getAttribute('aria-describedby') ?? '')
        ?.textContent
    ).toBe('Try again');
    expect(view.getByRole('alert').textContent).toBe('Try again');
    expect(input.closest('form')?.classList.contains('custom')).toBe(true);
  });
});
