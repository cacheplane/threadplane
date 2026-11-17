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

  it('ignores a rejected refresh', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const fake = createFakeAgentSession();
      const refresh = vi.fn(() => Promise.reject(new Error('offline')));
      refreshDirectoryOnRunEnd({ refresh }, fake.session);
      fake.setStatus('running');
      fake.setStatus('idle');
      expect(refresh).toHaveBeenCalledTimes(1);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('stops after release', () => {
    const { fake, refresh, release } = setup();
    release();
    fake.setStatus('running');
    fake.setStatus('idle');
    expect(refresh).not.toHaveBeenCalled();
  });
});
