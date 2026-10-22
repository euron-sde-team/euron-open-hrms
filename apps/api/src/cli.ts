/**
 * Operator CLI, bundled into the API image as dist/cli.js.
 *
 *   node dist/cli.js operator:create --email ops@example.com [--name "Ops"] [--role OPERATOR|SUPPORT]
 *   node dist/cli.js demo:seed [--reset]      demo workspaces (refused in production)
 *
 * Creates an operator-console account and prints a generated password once. This is
 * how the first operator is created on a fresh deployment (make aws-operator runs it as
 * a one-off ECS task); further operators are invited from the console.
 */
import crypto from "crypto";
import { systemRepos } from "./repositories/base.repository";
import { hashPw } from "./middleware/platform-auth";
import { pool } from "./db/kysely";
import { EMAIL_RE } from "./core/validate";
import { runDemoSeed } from "./demo/seed";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function operatorCreate() {
  const email = String(arg("email") || "").trim().toLowerCase();
  const name = String(arg("name") || "Platform operator").trim();
  const role = String(arg("role") || "OPERATOR").toUpperCase();
  if (!EMAIL_RE.test(email)) throw new Error("--email is required and must be an address");
  if (!["OPERATOR", "SUPPORT"].includes(role)) throw new Error("--role must be OPERATOR or SUPPORT");
  const sys = systemRepos();
  if (await sys.platformAdmins.findOne((a: any) => a.email === email)) throw new Error(`An operator with ${email} already exists`);
  const password = crypto.randomBytes(18).toString("base64url");
  await sys.platformAdmins.insert({ email, name, role, status: "ACTIVE", passwordHash: hashPw(password) });
  // eslint-disable-next-line no-console
  console.log(`\n  Operator created: ${email} (${role})\n  One-time password: ${password}\n  Sign in to the operator console, then enrol two-factor authentication under Security.\n`);
}

const commands: Record<string, () => Promise<void>> = {
  "operator:create": operatorCreate,
  "demo:seed": () => runDemoSeed({ reset: process.argv.includes("--reset") }),
};

const cmd = process.argv[2];
(async () => {
  if (!cmd || !commands[cmd]) {
    // eslint-disable-next-line no-console
    console.error(`Usage: node dist/cli.js <${Object.keys(commands).join(" | ")}> [options]`);
    process.exit(2);
  }
  await commands[cmd]();
  await pool.end();
})().catch(async (e) => {
  // eslint-disable-next-line no-console
  console.error(e instanceof Error ? e.message : e);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
