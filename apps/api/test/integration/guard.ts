/**
 * Integration tests truncate every table. This refuses to run unless the target is
 * unmistakably disposable: a database whose name contains "test", on a local or
 * CI-service host.
 */
export function assertDisposableDatabase(url: string | undefined): string {
  if (!url) throw new Error("Set TEST_DATABASE_URL (for example postgres://hrms:hrms@localhost:5442/hrms_test)");
  const u = new URL(url);
  const db = u.pathname.replace(/^\//, "");
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "postgres", "db"]);
  if (!/test/i.test(db)) throw new Error(`Refusing to run integration tests against "${db}": the database name must contain "test"`);
  if (!localHosts.has(u.hostname) && process.env.ALLOW_REMOTE_TEST_DB !== "true") {
    throw new Error(`Refusing to run integration tests against remote host "${u.hostname}" (set ALLOW_REMOTE_TEST_DB=true to override)`);
  }
  return url;
}
