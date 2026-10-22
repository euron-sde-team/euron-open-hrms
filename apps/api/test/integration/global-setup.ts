import { assertDisposableDatabase } from "./guard";

/** Create the test database if needed and apply every migration, once per run. */
export default async function setup() {
  const url = assertDisposableDatabase(process.env.TEST_DATABASE_URL);
  const pg = await import("pg");
  const u = new URL(url);
  const dbName = u.pathname.replace(/^\//, "");
  const admin = new pg.default.Client({ connectionString: url.replace(/\/[^/?]+(\?|$)/, "/postgres$1") });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (!exists.rowCount) await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, "")}"`);
  await admin.end();

  process.env.DATABASE_URL = url;
  const { migrate } = await import("../../../../db/migrate");
  await migrate({ log: () => undefined });
}
