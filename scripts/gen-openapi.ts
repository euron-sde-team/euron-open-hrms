/**
 * Generate docs/api/openapi.yaml from the route files, so the reference can never drift
 * from the code: every endpoint, its guards and its doc comment come from the source.
 *
 *   pnpm openapi          regenerate
 *   pnpm openapi --check  exit 1 if docs/api/openapi.yaml is out of date (CI)
 *
 * The route layer is declarative by design (path, guards, controller), which is what
 * makes this possible. Request and response bodies are described in the route doc
 * comments; typed schemas per endpoint are on the roadmap.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "apps", "api", "src");
const OUT = path.join(ROOT, "docs", "api", "openapi.yaml");

const tagDescriptions = new Map<string, string>();

type Op = { method: string; path: string; summary: string; access: string; tag: string; security: string | null; operationId: string };

const app = fs.readFileSync(path.join(SRC, "app.ts"), "utf8");
const files = new Map<string, string>();
for (const m of app.matchAll(/import (\w+) from "\.\/(routes\/[\w.-]+)";/g)) files.set(m[1], m[2]);

// Mount points, in app.ts order, with whether authRequired guards them.
const mounts: { prefix: string; ident: string; auth: boolean }[] = [];
for (const m of app.matchAll(/app\.use\("(\/api[^"]*)",\s*([^)]*)\)/g)) {
  const parts = m[2].split(",").map((s) => s.trim());
  const ident = parts[parts.length - 1];
  if (files.has(ident)) mounts.push({ prefix: m[1], ident, auth: parts.includes("authRequired") });
}

/** Turn a guard expression into the access it requires. */
function accessOf(guards: string[], consts: Map<string, string>): string {
  const out: string[] = [];
  for (const g of guards) {
    const name = g.trim();
    if (!name || name.startsWith("upload") || /Limiter$/.test(name) || name === "authRequired") continue;
    if (name === "staffOnly") out.push("staff");
    else if (name === "settingsAdmin") out.push("permission: settings.manage");
    else if (consts.has(name)) out.push(consts.get(name)!);
    else {
      const perm = name.match(/requirePermission\(([^)]*)\)/);
      const role = name.match(/requireOperatorRole\(([^)]*)\)/);
      if (perm) out.push(`permission: ${perm[1].replace(/"/g, "").split(",").map((s) => s.trim()).join(" or ")}`);
      else if (role) out.push(`operator role: ${role[1].replace(/"/g, "").split(",").map((s) => s.trim()).join(" or ")}`);
    }
  }
  return out.join("; ");
}

const ops: Op[] = [];
for (const { prefix, ident, auth } of mounts) {
  const file = files.get(ident)!;
  const text = fs.readFileSync(path.join(SRC, file + ".ts"), "utf8");
  // The router's leading doc comment, single or multi-line: its first paragraph describes the tag.
  const block = text.match(/^\/\*\*([\s\S]*?)\*\//)?.[1] || "";
  const header = (block.replace(/^\s*\*\s?/gm, "").trim().split(/\n\s*\n/)[0] || "").replace(/\s+/g, " ").trim();
  const tag = prefix.replace(/^\/api\/?/, "") || "root";
  // Named guards declared in the file: const leaveConfig = requirePermission("a", "b");
  const consts = new Map<string, string>();
  for (const c of text.matchAll(/const (\w+) = (requirePermission|requireOperatorRole)\(([^)]*)\);/g)) {
    const list = c[3].replace(/"/g, "").split(",").map((s) => s.trim()).join(" or ");
    consts.set(c[1], c[2] === "requirePermission" ? `permission: ${list}` : `operator role: ${list}`);
  }
  for (const c of text.matchAll(/const (\w+) = (staffOnly|settingsAdmin);/g)) consts.set(c[1], c[2] === "staffOnly" ? "staff" : "permission: settings.manage");

  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const m = line.match(/^router\.(get|post|put|patch|delete)\("([^"]+)",\s*(.*)\);\s*$/);
    if (!m) return;
    const args = m[3].split(/,\s*(?![^()]*\))/).slice(0, -1);
    const handler = m[3].match(/wrap\((?:\w+)\.(\w+)\)\s*$/)?.[1] || `${m[1]}${m[2]}`;
    // "listTypes" -> "List types": the controller name is the fallback summary.
    const fromHandler = handler.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()).replace(/ ([A-Z])(?=[a-z])/g, (_x, c) => " " + c.toLowerCase());
    // The doc comment right above the route (single or multi-line).
    let doc = "";
    let j = i - 1;
    if (j >= 0 && lines[j].trim().endsWith("*/")) {
      const buf: string[] = [];
      for (; j >= 0; j--) {
        buf.unshift(lines[j]);
        if (lines[j].trim().startsWith("/**")) break;
      }
      doc = buf.join(" ").replace(/\/\*\*|\*\//g, "").replace(/^\s*\*\s?/gm, "").replace(/\s*\*\s+/g, " ").replace(/\s+/g, " ").trim();
    }
    const full = (prefix + (m[2] === "/" ? "" : m[2])).replace(/\/$/, "") || "/";
    // Drop the "METHOD /api/path (staff)," prefix the comments start with.
    const summary = doc.replace(/^(GET|POST|PUT|PATCH|DELETE)\s+\S+\s*(\([^)]*\))?\s*[,:.]?\s*/i, "").replace(/^[,:]\s*/, "");
    const isPlatform = prefix.startsWith("/api/platform");
    const isPublicPlatform = isPlatform && /\/auth\//.test(full);
    const security = isPlatform ? (isPublicPlatform ? null : "operatorBearer") : auth ? "tenantBearer" : null;
    ops.push({
      method: m[1],
      path: full.replace(/:(\w+)/g, "{$1}"),
      summary: summary || fromHandler,
      access: accessOf(args, consts),
      tag,
      security,
      operationId: `${tag.replace(/[^a-zA-Z0-9]+(.)?/g, (_x, c) => (c ? c.toUpperCase() : ""))}_${handler}`,
    });
  });
  if (header) tagDescriptions.set(tag, header.replace(/^\/api\/?\S*:\s*/, ""));
}

function y(s: string): string {
  return JSON.stringify(s); // JSON strings are valid YAML scalars
}

const byPath = new Map<string, Op[]>();
for (const op of ops) byPath.set(op.path, [...(byPath.get(op.path) || []), op]);

const out: string[] = [];
out.push("# Generated by scripts/gen-openapi.ts from apps/api/src/routes. Do not edit by hand: run `pnpm openapi`.");
out.push("openapi: 3.1.0");
out.push("info:");
out.push("  title: Euron Open HRMS API");
out.push("  version: 0.1.0");
out.push("  description: |");
out.push("    The tenant plane (/api) serves a workspace's HR, managers and employees with a tenant session");
out.push("    token. The operator plane (/api/platform) serves platform operators with a separate token,");
out.push("    signed with a different secret and audience. Errors are `{ \"error\": string, \"code\"?: string }`;");
out.push("    unexpected failures return 500 with a `requestId` and never the underlying message.");
out.push("  license: { name: MIT, identifier: MIT }");
out.push("servers:");
out.push("  - url: http://localhost:5005");
out.push("    description: Local stack (make up)");
out.push("  - url: https://api.{domain}");
out.push("    variables: { domain: { default: example.com } }");
out.push("components:");
out.push("  securitySchemes:");
out.push("    tenantBearer: { type: http, scheme: bearer, bearerFormat: JWT, description: \"Tenant session from POST /api/auth/login (aud=tenant).\" }");
out.push("    operatorBearer: { type: http, scheme: bearer, bearerFormat: JWT, description: \"Operator session from POST /api/platform/auth/login (aud=platform).\" }");
out.push("  schemas:");
out.push("    Error:");
out.push("      type: object");
out.push("      required: [error]");
out.push("      properties: { error: { type: string }, code: { type: string }, requestId: { type: string } }");
out.push("tags:");
for (const tag of [...new Set(ops.map((o) => o.tag))]) {
  out.push(`  - name: ${y(tag)}`);
  if (tagDescriptions.get(tag)) out.push(`    description: ${y(tagDescriptions.get(tag)!)}`);
}
out.push("paths:");
for (const [p, list] of byPath) {
  out.push(`  ${y(p)}:`);
  for (const op of list) {
    out.push(`    ${op.method}:`);
    out.push(`      tags: [${y(op.tag)}]`);
    out.push(`      operationId: ${y(op.operationId)}`);
    if (op.summary) out.push(`      summary: ${y(op.summary.length > 120 ? op.summary.slice(0, 117).replace(/\s+\S*$/, "") + "..." : op.summary)}`);
    const desc = [op.summary.length > 120 ? op.summary : "", op.access ? `Requires ${op.access}.` : ""].filter(Boolean).join("\n\n");
    if (desc) out.push(`      description: ${y(desc)}`);
    out.push(`      security: ${op.security ? `[{ ${op.security}: [] }]` : "[]"}`);
    const params = [...op.path.matchAll(/\{(\w+)\}/g)].map((x) => x[1]);
    if (params.length) {
      out.push("      parameters:");
      for (const name of params) out.push(`        - { name: ${name}, in: path, required: true, schema: { type: string } }`);
    }
    out.push("      responses:");
    out.push("        \"2XX\": { description: Success }");
    out.push("        \"4XX\": { description: Client error, content: { application/json: { schema: { $ref: \"#/components/schemas/Error\" } } } }");
  }
}
const yaml = out.join("\n") + "\n";

if (process.argv.includes("--check")) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (current !== yaml) {
    console.error("docs/api/openapi.yaml is out of date: run `pnpm openapi`");
    process.exit(1);
  }
  console.log(`openapi: up to date (${ops.length} operations)`);
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, yaml);
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${ops.length} operations, ${byPath.size} paths`);
}
