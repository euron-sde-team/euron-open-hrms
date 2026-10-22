import { readFileSync } from "node:fs";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import type pg from "pg";

/**
 * Database connection settings, resolved one of two ways:
 *
 *   DATABASE_URL                       a static URL (local, CI, anything without rotation)
 *   DATABASE_SECRET_ARN + DB_HOST,     on AWS: the password is read from the RDS-managed
 *   DB_PORT, DB_NAME, DB_USER          Secrets Manager secret for every NEW connection
 *
 * Why the second mode exists: RDS rotates its managed master password. A URL
 * assembled once at boot keeps the old password, so every new connection fails
 * after a rotation until the process restarts. node-postgres accepts `password`
 * as an async function it calls per new connection; resolving it from Secrets
 * Manager (cached briefly) means a rotated password is picked up automatically,
 * with no restart and no secret in the environment.
 *
 * This module imports only the Secrets Manager client, never the shared pool, so
 * the migration runner can use it for its one-off client too.
 */

/** How long a fetched password is reused before Secrets Manager is asked again. */
export const PASSWORD_CACHE_MS = 60_000;

type Env = Record<string, string | undefined>;

interface CachedSecret {
  password: string;
  fetchedAt: number;
}

let client: SecretsManagerClient | null = null;
const cache = new Map<string, CachedSecret>();
const inflight = new Map<string, Promise<string>>();

/** Visible for tests. */
export const resetPasswordCache = (): void => {
  cache.clear();
  inflight.clear();
};

/**
 * Read the password from the RDS-managed secret ({"username","password"} JSON).
 * Concurrent first connections share one in-flight request instead of
 * stampeding Secrets Manager when a pool warms up.
 */
export const fetchSecretPassword = async (
  secretArn: string,
  region?: string,
  now = Date.now(),
  sm?: Pick<SecretsManagerClient, "send">
): Promise<string> => {
  const hit = cache.get(secretArn);
  if (hit && now - hit.fetchedAt < PASSWORD_CACHE_MS) return hit.password;

  const pending = inflight.get(secretArn);
  if (pending) return pending;

  const request = (async () => {
    const smClient = sm ?? (client ??= new SecretsManagerClient(region ? { region } : {}));
    const out = await smClient.send(new GetSecretValueCommand({ SecretId: secretArn }));
    if (!out.SecretString) throw new Error("database secret has no SecretString");
    const parsed = JSON.parse(out.SecretString) as { password?: unknown };
    if (typeof parsed.password !== "string" || parsed.password === "") {
      throw new Error("database secret has no password field");
    }
    cache.set(secretArn, { password: parsed.password, fetchedAt: Date.now() });
    return parsed.password;
  })();

  inflight.set(secretArn, request);
  try {
    return await request;
  } finally {
    inflight.delete(secretArn);
  }
};

/**
 * TLS for the secret-based mode. "require" (default) encrypts the connection
 * without verifying the server certificate, matching libpq's sslmode=require.
 * "verify-full" verifies it against DB_SSL_CA_FILE (the RDS CA bundle).
 */
const sslFor = (env: Env): pg.ClientConfig["ssl"] => {
  const mode = env.DB_SSL ?? "require";
  if (mode === "disable") return false;
  if (mode === "verify-full") {
    if (!env.DB_SSL_CA_FILE) throw new Error("DB_SSL=verify-full requires DB_SSL_CA_FILE");
    return { rejectUnauthorized: true, ca: readFileSync(env.DB_SSL_CA_FILE, "utf8") };
  }
  if (mode === "require") return { rejectUnauthorized: false };
  throw new Error(`DB_SSL must be disable, require or verify-full (got "${mode}")`);
};

/** True when the environment selects the secret-based mode. */
export const usesSecretCredentials = (env: Env = process.env): boolean =>
  !env.DATABASE_URL && Boolean(env.DATABASE_SECRET_ARN);

/**
 * Connection settings for a pg Pool or Client. Synchronous: in secret mode the
 * password is an async function pg calls per new connection, so nothing here
 * waits on the network.
 */
export const resolveConnectionConfig = (env: Env = process.env): pg.ClientConfig => {
  if (env.DATABASE_URL) return { connectionString: env.DATABASE_URL };

  const secretArn = env.DATABASE_SECRET_ARN;
  // Zero-setup local default: the compose Postgres.
  if (!secretArn) return { connectionString: "postgresql://hrms:hrms@localhost:5432/hrms" };
  const missing = ["DB_HOST", "DB_NAME", "DB_USER"].filter((k) => !env[k]);
  if (missing.length) throw new Error(`DATABASE_SECRET_ARN mode requires ${missing.join(", ")}`);

  const region = env.AWS_REGION;
  return {
    host: env.DB_HOST,
    port: Number(env.DB_PORT ?? 5432),
    database: env.DB_NAME,
    user: env.DB_USER,
    password: () => fetchSecretPassword(secretArn, region),
    ssl: sslFor(env),
  };
};
