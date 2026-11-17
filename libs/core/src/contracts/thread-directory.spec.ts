import { describe, expect, it, vi } from 'vitest';
import { createFakeAgentSession } from '../testing';
import { refreshDirectoryOnRunEnd } from './thread-directory';

function setup() {
  const fake = createFakeAgentSession();
  const refresh = vi.fn(() => Promise.resolve());
  const release = refreshDirectoryOnRunEnd({ refresh }, fake.session);
  return { fake, refresh, release };
}

describe('refreshDirectoryOnRunEnd', () => {
  it('refreshes once when the session leaves running', () => {
    const { fake, refresh } = setup();
    fake.setStatus('running');
    expect(refresh).not.toHaveBeenCalled();
    fake.setStatus('idle');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes after a run that ends in error', () => {
    const { fake, refresh } = setup();
    fake.setStatus('running');
    fake.setError({
      kind: 'server',
      message: 'boom',
      retryable: false,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not refresh on idle to idle notifications', () => {
    const { fake, refresh } = setup();
    fake.setStatus('idle');
    fake.setStatus('idle');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('ignores a rejected refresh', () => {
    const fake = createFakeAgentSession();
    const pending = Promise.reject(new Error('offline'));
    const handled = vi.spyOn(pending, 'catch');
    const refresh = vi.fn(() => pending);
    refreshDirectoryOnRunEnd({ refresh }, fake.session);
    fake.setStatus('running');
    fake.setStatus('idle');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(handled).toHaveBeenCalledTimes(1);
  });

  it('stops after release', () => {
    const { fake, refresh, release } = setup();
    release();
    fake.setStatus('running');
    fake.setStatus('idle');
    expect(refresh).not.toHaveBeenCalled();
  });
});
