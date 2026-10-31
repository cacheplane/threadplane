import { Pool, type PoolClient } from '@neondatabase/serverless';

// Structural copies of the growth SqlExecutor contract. marketing/** may not
// import libs/growth (eslint no-restricted-imports), and these shapes are
// compatible with growth's createDatabaseExecutor() result.
export interface SqlQueryResult<
  Row extends Record<string, unknown> = Record<string, unknown>
> {
  rows: Row[];
}

export interface SqlTransaction {
  execute<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[]
  ): Promise<SqlQueryResult<Row>>;
}

export interface SqlExecutor extends SqlTransaction {
  transaction<T>(
    operation: (transaction: SqlTransaction) => Promise<T>
  ): Promise<T>;
}

/** Neon-backed executor for operator CLIs; mirrors libs/growth createDatabaseExecutor. */
export function createSqlExecutor(
  databaseUrl: string
): SqlExecutor & { close(): Promise<void> } {
  const pool = new Pool({ connectionString: databaseUrl });
  const wrap = (
    queryable: Pick<Pool | PoolClient, 'query'>
  ): SqlTransaction => ({
    async execute<Row extends Record<string, unknown>>(
      sql: string,
      parameters: readonly unknown[] = []
    ): Promise<SqlQueryResult<Row>> {
      const result = await queryable.query<Row>(sql, [...parameters]);
      return { rows: result.rows };
    },
  });
  const root = wrap(pool);
  return {
    execute: root.execute,
    async transaction<T>(
      operation: (transaction: SqlTransaction) => Promise<T>
    ): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await operation(wrap(client));
        await client.query('commit');
        return result;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
