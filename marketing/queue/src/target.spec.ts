import { databaseHost, resolveTarget } from './target.ts';

describe('resolveTarget', () => {
  it('maps preview and production to their env vars', () => {
    expect(
      resolveTarget('preview', {
        MARKETING_DATABASE_URL_PREVIEW: 'postgres://u:p@prev.example/db',
      })
    ).toEqual({
      target: 'preview',
      envVar: 'MARKETING_DATABASE_URL_PREVIEW',
      databaseUrl: 'postgres://u:p@prev.example/db',
    });
    expect(
      resolveTarget('production', {
        MARKETING_DATABASE_URL_PRODUCTION: 'postgres://u:p@prod.example/db',
      }).envVar
    ).toBe('MARKETING_DATABASE_URL_PRODUCTION');
  });

  it('rejects unknown targets and missing urls', () => {
    expect(() => resolveTarget('staging', {})).toThrow(/preview.*production/u);
    expect(() => resolveTarget('production', {})).toThrow(
      /MARKETING_DATABASE_URL_PRODUCTION/u
    );
  });
});

describe('databaseHost', () => {
  it('returns only the hostname', () => {
    expect(
      databaseHost('postgres://user:secret@ep-1.neon.tech:5432/db?sslmode=require')
    ).toBe('ep-1.neon.tech');
  });

  it('never echoes an unparseable url', () => {
    expect(databaseHost('not a url secret')).toBe('(unparseable URL)');
  });
});
