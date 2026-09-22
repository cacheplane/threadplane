import type { AgentSession } from '@threadplane/core';
import type { LangGraphSession, LangGraphRunOptions } from './create-session';

export function assertRunOptions(
  session: LangGraphSession,
  core: AgentSession
) {
  const options: LangGraphRunOptions = {
    config: {
      tags: ['memory'],
      recursion_limit: 50,
      configurable: { user_id: 'user-42', preferences: { language: 'en' } },
    },
    context: { flags: ['enabled'] },
    metadata: { source: 'ui' },
  } as const;
  void session.submit('Hello', options);
  void session.resume(false, options);
  // @ts-expect-error Configuration is deeply readonly.
  options.config?.tags?.push('changed');
  if (options.config?.configurable) {
    // @ts-expect-error Configurable records are readonly.
    options.config.configurable['user_id'] = 'other';
  }
  if (options.metadata) {
    // @ts-expect-error Metadata belongs to the caller's readonly command contract.
    options.metadata['source'] = 'other';
  }
  // @ts-expect-error Core does not gain backend configuration.
  void core.submit('Hello', { context: { locale: 'en' } });
  void session.submit('Hello', {
    // @ts-expect-error Thread routing belongs to the session.
    config: { configurable: { thread_id: 'other' } },
  });
  void session.resume(true, {
    // @ts-expect-error Checkpoint execution needs an explicit owner contract.
    config: { configurable: { checkpoint_id: 'old' } },
  });
  void session.submit('Hello', {
    // @ts-expect-error Namespace routing belongs to the session.
    config: { configurable: { checkpoint_ns: 'child' } },
  });
  void session.submit('Hello', {
    // @ts-expect-error Checkpoint maps cannot override owned routing.
    config: { configurable: { checkpoint_map: {} } },
  });
  // @ts-expect-error The owner creates command envelopes.
  void session.resume(true, { command: { goto: 'other' } });
  // @ts-expect-error Reconnect never creates a new configured run.
  void session.reconnect({ context: {} });
  // @ts-expect-error Loading has no run settings.
  void session.load?.({ config: {} });
  // @ts-expect-error Context must be plain data.
  void session.submit('Hello', { context: new Date() });
  // @ts-expect-error Metadata cannot contain functions.
  void session.submit('Hello', { metadata: { callback: () => true } });
  void session.submit('Hello', {
    // @ts-expect-error Configurable data cannot contain classes.
    config: { configurable: { date: new Date() } },
  });
}
