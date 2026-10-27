import { Pool, type PoolClient } from '@neondatabase/serverless';

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
  close?(): Promise<void>;
}

/** Reuses the caller's transaction without opening or committing a nested one. */
export function nestedExecutor(transaction: SqlTransaction): SqlExecutor {
  return {
    execute: transaction.execute.bind(transaction),
    transaction: (operation) => operation(transaction),
  };
}

function queryExecutor(
  queryable: Pick<Pool | PoolClient, 'query'>
): SqlTransaction {
  return {
    async execute<Row extends Record<string, unknown>>(
      sql: string,
      parameters: readonly unknown[] = []
    ): Promise<SqlQueryResult<Row>> {
      const result = await queryable.query<Row>(sql, [...parameters]);
      return { rows: result.rows };
    },
  };
}

export function createDatabaseExecutor(databaseUrl?: string): SqlExecutor {
  const connectionString = databaseUrl ?? process.env['DATABASE_URL'];
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is required to create the growth database executor'
    );
  }

  const pool = new Pool({ connectionString });
  const root = queryExecutor(pool);

  return {
    execute: root.execute,
    async transaction<T>(
      operation: (transaction: SqlTransaction) => Promise<T>
    ): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await operation(queryExecutor(client));
        await client.query('commit');
        return result;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}
