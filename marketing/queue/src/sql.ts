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
