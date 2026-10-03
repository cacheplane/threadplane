import type {
  RenderElementData,
  RenderSpecData,
} from '@threadplane/react/render';

const TYPES = ['Heading', 'Text', 'Card', 'Badge'];
const ID = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const MAX_NODES = 32;
const MAX_TEXT = 16 * 1024;

function invalid(): never {
  throw new TypeError('Invalid local render data.');
}

function record(input: unknown): Record<string, unknown> {
  if (
    input === null ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(input)) ||
    Object.getOwnPropertySymbols(input).length
  )
    invalid();
  const entries = Object.entries(Object.getOwnPropertyDescriptors(input));
  if (entries.length > MAX_NODES) invalid();
  const result = Object.create(null) as Record<string, unknown>;
  for (const [key, descriptor] of entries) {
    if (!descriptor.enumerable || !('value' in descriptor)) invalid();
    Object.defineProperty(result, key, {
      value: descriptor.value,
      enumerable: true,
    });
  }
  return result;
}

function fields(
  input: Record<string, unknown>,
  allowed: readonly string[]
): void {
  if (Object.keys(input).some((key) => !allowed.includes(key))) invalid();
}

function references(input: unknown, complete: boolean): readonly string[] {
  if (input === undefined && !complete) return [];
  if (
    !Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Array.prototype ||
    input.length > MAX_NODES ||
    Object.getOwnPropertySymbols(input).length
  )
    invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  for (const [key, descriptor] of Object.entries(descriptors))
    if (
      !('value' in descriptor) ||
      (key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key))
    )
      invalid();
  const result: string[] = [];
  for (let index = 0; index < input.length; index++) {
    const value = descriptors[String(index)]?.value;
    if ((value === undefined || value === '') && !complete) continue;
    if (typeof value !== 'string' || !ID.test(value) || result.includes(value))
      invalid();
    result.push(value);
  }
  return result;
}

function project(input: unknown, complete: boolean): RenderSpecData | null {
  if (input === null && !complete) return null;
  const source = record(input);
  fields(source, ['root', 'elements']);
  if (
    source.root === undefined ||
    source.root === '' ||
    source.elements === undefined
  ) {
    if (complete) invalid();
    return null;
  }
  if (typeof source.root !== 'string' || !ID.test(source.root)) invalid();
  const sourceElements = record(source.elements);
  const elements = Object.create(null) as Record<string, RenderElementData>;
  const childLists = new Map<string, readonly string[]>();
  let textSize = 0;
  for (const [key, inputElement] of Object.entries(sourceElements)) {
    if (!ID.test(key)) invalid();
    if (inputElement === undefined && !complete) continue;
    const element = record(inputElement);
    fields(element, ['type', 'props', 'children']);
    if (element.type === undefined && !complete) continue;
    if (typeof element.type !== 'string') invalid();
    if (!TYPES.includes(element.type)) {
      if (complete) invalid();
      continue;
    }
    const rawProps = element.props === undefined ? {} : record(element.props);
    fields(rawProps, [
      element.type === 'Card'
        ? 'title'
        : element.type === 'Badge'
        ? 'label'
        : 'content',
    ]);
    const props = Object.create(null) as Record<string, string>;
    for (const [prop, value] of Object.entries(rawProps)) {
      if (value === undefined && !complete) continue;
      if (typeof value !== 'string' || (textSize += value.length) > MAX_TEXT)
        invalid();
      Object.defineProperty(props, prop, { value, enumerable: true });
    }
    const children = Object.hasOwn(element, 'children')
      ? references(element.children, complete)
      : undefined;
    if (children) childLists.set(key, children);
    Object.defineProperty(elements, key, {
      value: { type: element.type, props: Object.freeze(props) },
      enumerable: true,
    });
  }
  for (const [key, children] of childLists) {
    if (complete && children.some((child) => !Object.hasOwn(elements, child)))
      invalid();
    Object.defineProperty(elements[key], 'children', {
      value: Object.freeze(
        children.filter((child) => Object.hasOwn(elements, child))
      ),
      enumerable: true,
    });
  }
  const heights = new Map<string, number>();
  const active = new Set<string>();
  function height(key: string): number {
    const known = heights.get(key);
    if (known !== undefined) return known;
    if (active.has(key)) invalid();
    active.add(key);
    let result = 1;
    for (const child of elements[key].children ?? [])
      result = Math.max(result, 1 + height(child));
    active.delete(key);
    if (result > 16) invalid();
    heights.set(key, result);
    return result;
  }
  for (const key of Object.keys(elements)) {
    height(key);
    Object.freeze(elements[key]);
  }
  if (!Object.hasOwn(elements, source.root)) {
    if (complete) invalid();
    return null;
  }
  return Object.freeze({
    root: source.root,
    elements: Object.freeze(elements),
  });
}

/** Copy the known display subset; the incremental parser retains its own mutable tree. */
export function projectPartialSpec(input: unknown): RenderSpecData | null {
  return project(input, false);
}

/** Admit a complete authored local sample before any playback begins. */
export function validateCompleteSpec(input: unknown): RenderSpecData {
  return project(input, true) ?? invalid();
}
