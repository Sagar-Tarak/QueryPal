

import { Pool } from "pg";

export function createPostgresPool(connectionString: string): Pool {
  return new Pool({

    connectionString,
    connectionTimeoutMillis: 5000,
    max: 5,
  })
}
