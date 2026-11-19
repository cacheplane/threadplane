import type { Client } from '@langchain/langgraph-sdk';
import type { ProjectEntry } from '@threadplane/core';

/** Where a thread directory keeps project names. */
export interface ProjectStore {
  list(signal?: AbortSignal): Promise<readonly ProjectEntry[]>;
  create(name: string): Promise<{ readonly id: string }>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
}

const DEFAULT_NAMESPACE: readonly string[] = ['threadplane', 'projects'];

/** Trims a project name; a blank name rejects. */
export function requireProjectName(name: string): string {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) throw new Error('Project name is required');
  return trimmed;
}

/**
 * Keeps project names in the LangGraph Store API: one item per project, keyed
 * by project id, with the value `{ name }`.
 */
export function createLangGraphProjectStore(
  client: Pick<Client, 'store'>,
  options: { readonly namespace?: readonly string[] } = {}
): ProjectStore {
  const namespace = [...(options.namespace ?? DEFAULT_NAMESPACE)];
  return {
    async list(signal) {
      const { items } = await client.store.searchItems(namespace, {
        limit: 100,
        ...(signal ? { signal } : {}),
      });
      const projects: ProjectEntry[] = [];
      for (const item of items) {
        const name: unknown = item.value?.['name'];
        if (typeof name === 'string' && name.trim())
          projects.push(Object.freeze({ id: item.key, name: name.trim() }));
      }
      return projects.sort((a, b) => a.name.localeCompare(b.name));
    },
    async create(name) {
      const trimmed = requireProjectName(name);
      const id = crypto.randomUUID();
      await client.store.putItem(namespace, id, { name: trimmed });
      return Object.freeze({ id });
    },
    async rename(id, name) {
      await client.store.putItem(namespace, id, {
        name: requireProjectName(name),
      });
    },
    async remove(id) {
      await client.store.deleteItem(namespace, id);
    },
  };
}
