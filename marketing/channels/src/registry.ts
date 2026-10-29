import type { ChannelAdapter, ChannelId } from './types';
import { XAdapter } from './x';
import { DevToAdapter } from './devto';
import { LinkedInAdapter } from './linkedin';

const KNOWN: ChannelId[] = ['x', 'linkedin', 'devto', 'reddit'];

const instances = new Map<ChannelId, ChannelAdapter>();

function buildAdapter(id: ChannelId): ChannelAdapter {
  switch (id) {
    case 'x':
      return new XAdapter();
    case 'devto':
      return new DevToAdapter();
    case 'linkedin':
      return new LinkedInAdapter();
    case 'reddit':
      throw new Error(
        `Channel "${id}" adapter is not yet implemented. Known channels with implementations: x, devto, linkedin.`,
      );
    default: {
      const _exhaustive: never = id;
      throw new Error(
        `Unknown channel "${String(_exhaustive)}". Known: ${KNOWN.join(', ')}.`,
      );
    }
  }
}

export function getAdapter(id: ChannelId): ChannelAdapter {
  if (!KNOWN.includes(id)) {
    throw new Error(`Unknown channel "${id}". Known: ${KNOWN.join(', ')}.`);
  }
  let inst = instances.get(id);
  if (!inst) {
    inst = buildAdapter(id);
    instances.set(id, inst);
  }
  return inst;
}
