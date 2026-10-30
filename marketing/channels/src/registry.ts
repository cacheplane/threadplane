import type { AdapterOptions, ChannelAdapter, ChannelId } from './types.ts';
import { XAdapter } from './x/index.ts';
import { DevToAdapter } from './devto/index.ts';
import { LinkedInAdapter } from './linkedin/index.ts';

const KNOWN: ChannelId[] = ['x', 'linkedin', 'devto', 'reddit'];

const instances = new Map<ChannelId, ChannelAdapter>();

function buildAdapter(id: ChannelId, options?: AdapterOptions): ChannelAdapter {
  switch (id) {
    case 'x':
      return new XAdapter(options?.x);
    case 'devto':
      return new DevToAdapter(options?.devto);
    case 'linkedin':
      return new LinkedInAdapter(options?.linkedin);
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

/** Builds a fresh adapter every call; pass `options` to inject credentials instead of reading `process.env`. */
export function createAdapter(id: ChannelId, options?: AdapterOptions): ChannelAdapter {
  if (!KNOWN.includes(id)) {
    throw new Error(`Unknown channel "${id}". Known: ${KNOWN.join(', ')}.`);
  }
  return buildAdapter(id, options);
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
