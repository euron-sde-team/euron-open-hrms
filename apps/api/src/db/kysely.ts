/**
 * PostgreSQL connection + Kysely instance.
 *
 * Every query goes through Kysely. The schema is owned by the plain SQL migrations in
 * db/migrations (applied by db/migrate.ts); types.ts is generated from a migrated
 * database with `pnpm db:codegen`. `data` columns are JSONB and come back already parsed by pg.
 */
import "dotenv/config";
import { Pool } from "pg";
import { Kysely, PostgresDialect } from "kysely";
import type { DB } from "./types";
import { resolveConnectionConfig } from "./connection-config";

// pg parses jsonb -> object and timestamptz -> Date; BIGINT (count()) comes back as a
// string, which callers Number().

// DATABASE_URL, or DATABASE_SECRET_ARN + DB_* on AWS (password read per new connection
// from the RDS-managed secret, so a rotation needs no restart). See connection-config.ts.
export const pool = new Pool({
  ...resolveConnectionConfig(process.env),
  max: Number(process.env.PG_POOL_MAX || 10),
  // Remote RDS / NAT silently drops idle TCP connections. TCP keepalive keeps them
  // alive, and a short idle timeout recycles pooled connections before the server
  // kills them -- both prevent the "read ECONNRESET" on the first query after idle.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 10000),
});

// A dead/idle client erroring in the background must NOT crash the process; the
// pool discards it and the next acquire opens a fresh connection.
pool.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.warn(JSON.stringify({ level: 40, msg: "pg idle client error (discarded)", err: err && err.message }));
});

// Typed against the generated DB schema (types.ts). Call sites using literal
// table/column names get compile-time checking. repo.ts builds queries from
// dynamic strings (its hot-column/jsonb abstraction), so it uses the loosely-typed
// `dbAny` view to opt out of structural typing where it intentionally goes dynamic.
export const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
export const dbAny = db as unknown as Kysely<any>;

/** Verify connectivity at boot; throws if Postgres is unreachable. */
export async function assertConnection() {
  const c = await pool.connect();
  try {
    await c.query("select 1");
  } finally {
    c.release();
  }
}
