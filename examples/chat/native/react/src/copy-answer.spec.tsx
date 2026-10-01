import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyAnswer } from './copy-answer';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function clipboard(writeText: (text: string) => Promise<void>) {
  vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({
    writeText,
  } as Clipboard);
}
// jsdom does not supply Clipboard API; establish a configurable getter for spies.
Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  get: () => undefined,
});
function pending() {
  let resolve!: () => void, reject!: () => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = () => no(new Error('denied'));
  });
  const write = vi.fn(() => promise);
  clipboard(write);
  return { write, resolve, reject };
}
describe('native CopyAnswer', () => {
  it('hides empty answers while retaining an admitted pending write through empty corrections', async () => {
    const attempt = pending();
    const view = render(<CopyAnswer text="Old" generation="a" />);
    fireEvent.click(view.getByRole('button'));
    view.rerender(<CopyAnswer text="" generation="b" />);
    expect(view.queryByRole('button')).toBeNull();
    view.rerender(<CopyAnswer text="New" generation="b" />);
    expect((view.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(view.getByRole('button'));
    expect(attempt.write).toHaveBeenCalledOnce();
    await act(async () => attempt.resolve());
    expect(view.getByRole('status').textContent).toBe('');
  });
  it('copies exactly the answer only on explicit activation and blocks synchronous reentry', async () => {
    const attempt = pending();
    const view = render(
      <StrictMode>
        <CopyAnswer text={'**Answer**\n\n<script>x</script>'} generation="a" />
      </StrictMode>
    );
    expect(attempt.write).not.toHaveBeenCalled();
    const button = view.getByRole('button', { name: 'Copy answer' });
    act(() => {
      button.click();
      button.click();
    });
    expect(attempt.write.mock.calls).toEqual([
      ['**Answer**\n\n<script>x</script>'],
    ]);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await act(async () => attempt.resolve());
    expect(view.getByRole('status').textContent).toBe('Answer copied.');
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
  it('keeps pending disabled through a same-ID content correction and rejects stale success', async () => {
    const attempt = pending();
    const view = render(<CopyAnswer text="Old" generation="a" />);
    fireEvent.click(view.getByRole('button'));
    view.rerender(<CopyAnswer text="New" generation="a" />);
    expect((view.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => attempt.resolve());
    expect(view.getByRole('status').textContent).toBe('');
    fireEvent.click(view.getByRole('button'));
    await act(async () => {});
    expect(attempt.write.mock.calls).toEqual([['Old'], ['New']]);
    expect(view.getByRole('status').textContent).toBe('Answer copied.');
  });
  it('does not reuse settled feedback after A→B→A text with a new generation', async () => {
    const write = vi.fn(async () => {});
    clipboard(write);
    const view = render(<CopyAnswer text="A" generation="1" />);
    fireEvent.click(view.getByRole('button'));
    await act(async () => {});
    expect(view.getByRole('status').textContent).toBe('Answer copied.');
    view.rerender(<CopyAnswer text="B" generation="2" />);
    view.rerender(<CopyAnswer text="A" generation="3" />);
    expect(view.getByRole('status').textContent).toBe('');
    expect(write).toHaveBeenCalledOnce();
  });
  it('reports unavailable and rejected clipboard writes without throwing or retrying', async () => {
    const view = render(<CopyAnswer text="A" generation="1" />);
    fireEvent.click(view.getByRole('button'));
    await act(async () => {});
    expect(view.getByRole('status').textContent).toBe('Could not copy answer.');
    const attempt = pending();
    fireEvent.click(view.getByRole('button'));
    await act(async () => attempt.reject());
    expect(view.getByRole('status').textContent).toBe('Could not copy answer.');
    expect(attempt.write).toHaveBeenCalledOnce();
  });
  it('late settlement after unmount cannot write again or affect a fresh copy view', async () => {
    const attempt = pending();
    const view = render(<CopyAnswer text="A" generation="1" />);
    fireEvent.click(view.getByRole('button'));
    view.unmount();
    const fresh = render(<CopyAnswer text="A" generation="1" />);
    await act(async () => attempt.resolve());
    expect(attempt.write).toHaveBeenCalledOnce();
    expect(fresh.getByRole('status').textContent).toBe('');
    expect((fresh.getByRole('button') as HTMLButtonElement).disabled).toBe(
      false
    );
  });
});
