import { copyData, displayUnits, LIMITS, record, text } from './authority';

export interface Skill {
  readonly name: string;
  readonly description: string;
  readonly path: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly license?: string | null;
  readonly compatibility?: string | null;
  readonly allowed_tools?: readonly string[];
}
export interface IndexInput {
  readonly owner: string;
  readonly generation: string;
  readonly currentOwner: string;
  readonly currentGeneration: string;
  readonly source: 'observed-root' | 'checkpoint';
  readonly values: unknown;
}
export type SkillIndex =
  | {
      readonly kind: 'ready';
      readonly source: IndexInput['source'];
      readonly owner: string;
      readonly generation: string;
      readonly skills: readonly Skill[];
    }
  | { readonly kind: 'absent' | 'unavailable' | 'stale' };

/** Literal canonical virtual paths only; never decode or normalize a model path. */
export function skillPath(value: unknown): value is string {
  return (
    text(value) &&
    value.length <= LIMITS.fieldText &&
    value.startsWith('/skills/') &&
    !/[\\\\%?#\u0000-\u0020\u007f]/.test(value) &&
    value
      .slice(1)
      .split('/')
      .every((part) => part.length > 0 && part !== '.' && part !== '..')
  );
}

/** Every call replaces the projection. Empty, absent and malformed values cannot
 * revive a previously observed index. Custom event metadata is never a source. */
export function projectIndex(input: IndexInput): SkillIndex {
  try {
    const owned = copyData(input) as IndexInput;
    if (
      !['owner', 'generation', 'currentOwner', 'currentGeneration'].every(
        (k) => {
          const v = owned[k as keyof IndexInput];
          return text(v) && v.length <= LIMITS.fieldText;
        }
      )
    )
      return { kind: 'unavailable' };
    if (
      owned.owner !== owned.currentOwner ||
      owned.generation !== owned.currentGeneration
    )
      return { kind: 'stale' };
    if (
      !['observed-root', 'checkpoint'].includes(owned.source) ||
      !record(owned.values)
    )
      return { kind: 'unavailable' };
    if (!Object.hasOwn(owned.values, 'skills_metadata'))
      return { kind: 'absent' };
    const entries = owned.values.skills_metadata;
    if (!Array.isArray(entries) || entries.length > LIMITS.entries)
      return { kind: 'unavailable' };
    const names = new Set<string>(),
      paths = new Set<string>(),
      strings: string[] = [],
      skills: Skill[] = [];
    for (const v of entries) {
      if (
        !record(v) ||
        !text(v.name) ||
        v.name.length > 64 ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v.name) ||
        !text(v.description) ||
        !skillPath(v.path) ||
        v.path !== '/skills/' + v.name + '/SKILL.md' ||
        names.has(v.name) ||
        paths.has(v.path)
      )
        return { kind: 'unavailable' };
      names.add(v.name);
      paths.add(v.path);
      const skill: Record<string, unknown> = {
        name: v.name,
        description: v.description,
        path: v.path,
      };
      strings.push(v.name, v.description, v.path);
      for (const key of ['license', 'compatibility']) {
        const value = v[key];
        if (value !== undefined) {
          if (value !== null && typeof value !== 'string')
            return { kind: 'unavailable' };
          skill[key] = value;
          if (typeof value === 'string') strings.push(value);
        }
      }
      if (v.metadata !== undefined) {
        if (
          !record(v.metadata) ||
          Object.keys(v.metadata).length > LIMITS.entries
        )
          return { kind: 'unavailable' };
        for (const [key, value] of Object.entries(v.metadata)) {
          if (!text(key) || typeof value !== 'string')
            return { kind: 'unavailable' };
          strings.push(key, value);
        }
        skill.metadata = v.metadata;
      }
      if (v.allowed_tools !== undefined) {
        if (
          !Array.isArray(v.allowed_tools) ||
          v.allowed_tools.length > LIMITS.entries ||
          v.allowed_tools.some((v) => !text(v)) ||
          new Set(v.allowed_tools).size !== v.allowed_tools.length
        )
          return { kind: 'unavailable' };
        strings.push(...v.allowed_tools);
        skill.allowed_tools = v.allowed_tools;
      }
      skills.push(Object.freeze(skill) as unknown as Skill);
    }
    displayUnits(strings);
    return Object.freeze({
      kind: 'ready',
      source: owned.source,
      owner: owned.owner,
      generation: owned.generation,
      skills: Object.freeze(skills),
    });
  } catch {
    return { kind: 'unavailable' };
  }
}
