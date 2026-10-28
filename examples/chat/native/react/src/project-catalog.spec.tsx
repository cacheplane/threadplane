import { describe, expect, it } from 'vitest';
import {
  PROJECT_CATALOG_KEY,
  createProject,
  mergeProjects,
  readProjectCatalog,
  renameProject,
} from './project-catalog';
const encode = (projects: readonly { id: string; name: string }[]) =>
  JSON.stringify({ version: 1, projects });
function memoryStorage(initial: string | null = null) {
  let bytes = initial;
  const writes: string[] = [];
  return {
    getItem(key: string) {
      expect(key).toBe('threadplane-native-react-projects-v1');
      return bytes;
    },
    setItem(key: string, value: string) {
      expect(key).toBe(PROJECT_CATALOG_KEY);
      writes.push(value);
      bytes = value;
    },
    get bytes() {
      return bytes;
    },
    writes,
  };
}
describe('local project catalog', () => {
  it('reads missing storage as a frozen empty catalog without writes', () => {
    const storage = memoryStorage();
    const catalog = readProjectCatalog(storage);
    expect(catalog).toEqual([]);
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(storage.writes).toEqual([]);
  });
  it('preserves exact ID and stored name bytes in independent frozen captures', () => {
    const storage = memoryStorage(
      encode([{ id: ' p/b ', name: ' Existing ' }])
    );
    const first = readProjectCatalog(storage);
    const second = readProjectCatalog(storage);
    expect(first).toEqual([{ id: ' p/b ', name: ' Existing ' }]);
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first[0])).toBe(true);
    expect(storage.writes).toEqual([]);
  });
  it.each([
    '',
    '{',
    'null',
    '[]',
    '{}',
    JSON.stringify({ version: 2, projects: [] }),
    JSON.stringify({ version: '1', projects: [] }),
    JSON.stringify({ version: 1, projects: {} }),
    JSON.stringify({ version: 1, projects: [null] }),
    JSON.stringify({ version: 1, projects: [[]] }),
    JSON.stringify({ version: 1, projects: [{}] }),
    JSON.stringify({ version: 1, projects: [{ id: '', name: 'Name' }] }),
    JSON.stringify({ version: 1, projects: [{ id: ' \n ', name: 'Name' }] }),
    JSON.stringify({ version: 1, projects: [{ id: 1, name: 'Name' }] }),
    JSON.stringify({ version: 1, projects: [{ id: 'id', name: '' }] }),
    JSON.stringify({ version: 1, projects: [{ id: 'id', name: ' \t' }] }),
    JSON.stringify({ version: 1, projects: [{ id: 'id', name: 1 }] }),
    encode([
      { id: 'duplicate', name: 'A' },
      { id: 'duplicate', name: 'B' },
    ]),
  ])('rejects malformed or unsupported data without loss: %s', (bytes) => {
    const storage = memoryStorage(bytes);
    expect(() => readProjectCatalog(storage)).toThrow();
    expect(() => createProject(storage, 'new', 'New')).toThrow();
    expect(() => renameProject(storage, 'existing', 'Renamed')).toThrow();
    expect(storage.bytes).toBe(bytes);
    expect(storage.writes).toEqual([]);
  });
  it('propagates read errors without writes', () => {
    const error = new Error('denied');
    let writes = 0;
    const storage = {
      getItem() {
        throw error;
      },
      setItem() {
        writes++;
      },
    };
    expect(() => readProjectCatalog(storage)).toThrow(error);
    expect(() => createProject(storage, 'id', 'Name')).toThrow(error);
    expect(() => renameProject(storage, 'id', 'Name')).toThrow(error);
    expect(writes).toBe(0);
  });
  it('creates first, trims names, and rereads current storage before each command', () => {
    const storage = memoryStorage(encode([{ id: 'old', name: 'Old' }]));
    const before = readProjectCatalog(storage);
    const created = createProject(storage, ' p/b ', '  Project B  ');
    expect(created).toEqual([
      { id: ' p/b ', name: 'Project B' },
      { id: 'old', name: 'Old' },
    ]);
    storage.setItem(
      PROJECT_CATALOG_KEY,
      encode([...created, { id: 'external', name: 'External' }])
    );
    const renamed = renameProject(storage, 'old', '  Updated  ');
    expect(renamed).toEqual([
      { id: ' p/b ', name: 'Project B' },
      { id: 'old', name: 'Updated' },
      { id: 'external', name: 'External' },
    ]);
    expect(JSON.parse(storage.bytes!)).toEqual({
      version: 1,
      projects: renamed,
    });
    const latest = createProject(storage, 'new', 'New');
    expect(latest.slice(1)).toEqual(renamed);
    expect(before).toEqual([{ id: 'old', name: 'Old' }]);
    for (const capture of [created, renamed, latest]) {
      expect(Object.isFrozen(capture)).toBe(true);
      expect(capture.every(Object.isFrozen)).toBe(true);
    }
  });
  it('rejects exact collisions and preserves distinct whitespace IDs', () => {
    const storage = memoryStorage(encode([{ id: 'id', name: 'First' }]));
    expect(() => createProject(storage, 'id', 'Second')).toThrow();
    expect(storage.writes).toEqual([]);
    expect(createProject(storage, ' id ', 'Second')).toEqual([
      { id: ' id ', name: 'Second' },
      { id: 'id', name: 'First' },
    ]);
    expect(() => createProject(storage, ' id ', 'Third')).toThrow();
  });
  it.each(['', ' ', '\n\t'])(
    'rejects blank command IDs and names: %j',
    (blank) => {
      const storage = memoryStorage();
      expect(() => createProject(storage, blank, 'Name')).toThrow();
      expect(() => renameProject(storage, blank, 'Name')).toThrow();
      expect(() => createProject(storage, 'id', blank)).toThrow();
      expect(() => renameProject(storage, 'id', blank)).toThrow();
      expect(storage.writes).toEqual([]);
    }
  );
  it('imports renamed IDs at the end and supports prototype-like IDs', () => {
    const storage = memoryStorage(
      encode([{ id: 'constructor', name: 'First' }])
    );
    expect(renameProject(storage, '__proto__', '  Imported  ')).toEqual([
      { id: 'constructor', name: 'First' },
      { id: '__proto__', name: 'Imported' },
    ]);
    expect(renameProject(storage, 'constructor', 'Changed')).toEqual([
      { id: 'constructor', name: 'Changed' },
      { id: '__proto__', name: 'Imported' },
    ]);
    expect(() => createProject(storage, '__proto__', 'Duplicate')).toThrow();
  });
  it('propagates failed writes without success or changes to previous captures', () => {
    const bytes = encode([{ id: 'id', name: 'Original' }]);
    const error = new Error('quota');
    const storage = {
      getItem: () => bytes,
      setItem() {
        throw error;
      },
    };
    const before = readProjectCatalog(storage);
    expect(() => createProject(storage, 'new', 'New')).toThrow(error);
    expect(() => renameProject(storage, 'id', 'Changed')).toThrow(error);
    expect(before).toEqual([{ id: 'id', name: 'Original' }]);
    expect(readProjectCatalog(storage)).toEqual(before);
  });
  it('merges catalog first with unique first-seen loaded IDs and frozen copies', () => {
    const catalog = [
      { id: '__proto__', name: 'Named' },
      { id: 'id', name: 'ID' },
    ];
    const rows = [
      { projectId: ' id ' },
      {},
      { projectId: '__proto__' },
      { projectId: 'constructor' },
      { projectId: ' id ' },
      { projectId: '' },
      { projectId: ' \t' },
      { projectId: 'id' },
    ];
    const merged = mergeProjects(catalog, rows);
    expect(merged).toEqual([
      { id: '__proto__', name: 'Named' },
      { id: 'id', name: 'ID' },
      { id: ' id ', name: ' id ' },
      { id: 'constructor', name: 'constructor' },
    ]);
    catalog[0].name = 'Mutated';
    rows[0].projectId = 'changed';
    expect(merged[0].name).toBe('Named');
    expect(merged[2].id).toBe(' id ');
    expect(Object.isFrozen(merged)).toBe(true);
    expect(merged.every(Object.isFrozen)).toBe(true);
  });
});
