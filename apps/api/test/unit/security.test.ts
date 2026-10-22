/**
 * Security-relevant building blocks that need no database: PII sealing, the
 * production configuration guards, log redaction, the workspace-suspension gate,
 * and the tenant-scoping registry.
 */
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { seal, open, isEnvelope, keyScheme, ENCRYPTED_FIELDS } from "../../src/security/pii";
import { assertSecrets, assertEmailFlow, assertStorage, DEV_DEFAULTS } from "../../src/core/config";
import { redactUrl } from "../../src/core/logger";
import { workspaceBlock, TENANT_AUD } from "../../src/middleware/auth";
import { TABLES } from "../../src/repositories/base.repository";
import { escapeHtml } from "../../src/core/util";
import { brandFor } from "../../src/domain/brand";
import { domainForOrg } from "../../src/domain/onboard-util";
import { awsClientConfig, awsRegion } from "../../src/core/aws";

const key = crypto.randomBytes(32);
const aad = Buffer.from("open-hrms|employees|org-a|row-1|kyc");

describe("PII envelope", () => {
  const value = { aadhaar: "123456789012", pan: "ABCDE1234F" };

  it("round-trips any JSON value", () => {
    expect(open(key, seal(key, value, aad), aad)).toEqual(value);
    expect(open(key, seal(key, ["a", 1], aad), aad)).toEqual(["a", 1]);
  });
  it("never stores the plaintext", () => {
    const env = seal(key, value, aad);
    expect(JSON.stringify(env)).not.toContain("123456789012");
    expect(isEnvelope(env)).toBe(true);
  });
  it("uses a fresh IV per seal, so equal values do not produce equal ciphertexts", () => {
    expect(seal(key, value, aad).ct).not.toBe(seal(key, value, aad).ct);
  });
  it("refuses a ciphertext moved to another row, field or workspace", () => {
    const env = seal(key, value, aad);
    for (const other of ["open-hrms|employees|org-a|row-2|kyc", "open-hrms|employees|org-a|row-1|bank", "open-hrms|employees|org-b|row-1|kyc"]) {
      expect(() => open(key, env, Buffer.from(other))).toThrow();
    }
  });
  it("refuses a tampered ciphertext", () => {
    const env = seal(key, value, aad);
    const ct = Buffer.from(env.ct, "base64");
    ct[0] ^= 0xff;
    expect(() => open(key, { ...env, ct: ct.toString("base64") }, aad)).toThrow();
  });
  it("refuses the wrong key", () => {
    expect(() => open(crypto.randomBytes(32), seal(key, value, aad), aad)).toThrow();
  });
  it("treats plaintext legacy values as not sealed", () => {
    expect(isEnvelope({ aadhaar: "1" })).toBe(false);
    expect(isEnvelope(null)).toBe(false);
  });
  it("selects the key scheme from the environment", () => {
    expect(keyScheme({})).toBe("local");
    expect(keyScheme({ KMS_KEY_ID: "alias/x" })).toBe("kms");
    expect(keyScheme({ KMS_MODE: "local", KMS_KEY_ID: "alias/x" })).toBe("local");
    expect(() => keyScheme({ KMS_MODE: "vault" })).toThrow();
  });
  it("only seals tables the repository knows, and never a hot column", () => {
    const byTable = Object.fromEntries(Object.values(TABLES).map((m: any) => [m.table, m]));
    for (const [table, fields] of Object.entries(ENCRYPTED_FIELDS)) {
      expect(byTable[table], table).toBeDefined();
      for (const f of fields) expect(byTable[table].cols, `${table}.${f}`).not.toContain(f);
    }
  });
});

describe("Tenant scoping registry", () => {
  it("every table with an orgId column is tenant-scoped, except the deliberate globals", () => {
    const globals = new Set(["auth_tokens"]);
    for (const [name, meta] of Object.entries(TABLES) as [string, any][]) {
      if (meta.cols.includes("orgId") && !globals.has(meta.table)) expect(meta.tenant, name).toBe(true);
    }
  });
  it("the organizations root and operator accounts are never tenant-scoped", () => {
    expect(TABLES.organizations.tenant).toBe(false);
    expect(TABLES.platformAdmins.tenant).toBe(false);
  });
});

describe("Production configuration guards", () => {
  const strong = (c: string) => c.repeat(40);
  const good = {
    NODE_ENV: "production",
    JWT_SECRET: strong("a"),
    PLATFORM_JWT_SECRET: strong("b"),
    DOC_VERIFY_SECRET: strong("c"),
    PII_MASTER_KEY: crypto.randomBytes(32).toString("base64"),
    CORS_ORIGINS: "https://app.example.com,https://console.example.com",
  };
  it("a complete configuration passes", () => expect(assertSecrets(good as any)).toEqual([]));
  it("missing secrets are named", () => {
    expect(assertSecrets({ CORS_ORIGINS: "x" } as any).join("\n")).toMatch(/JWT_SECRET[\s\S]*PLATFORM_JWT_SECRET[\s\S]*DOC_VERIFY_SECRET[\s\S]*PII_MASTER_KEY/);
  });
  it("the committed development defaults are rejected", () => {
    expect(assertSecrets({ ...good, JWT_SECRET: DEV_DEFAULTS.JWT_SECRET } as any).join()).toMatch(/committed default/);
  });
  it("reusing one secret for two purposes is rejected", () => {
    expect(assertSecrets({ ...good, DOC_VERIFY_SECRET: good.JWT_SECRET } as any).join()).toMatch(/different values/);
  });
  it("open CORS is rejected", () => {
    expect(assertSecrets({ ...good, CORS_ORIGINS: "" } as any).join()).toMatch(/CORS_ORIGINS/);
  });
  it("a malformed PII master key is rejected", () => {
    expect(assertSecrets({ ...good, PII_MASTER_KEY: "short" } as any).join()).toMatch(/32 bytes/);
  });
  it("KMS mode needs a key id instead of a master key", () => {
    const { PII_MASTER_KEY: _drop, ...noLocal } = good;
    expect(assertSecrets({ ...noLocal, KMS_MODE: "aws" } as any).join()).toMatch(/KMS_KEY_ID/);
    expect(assertSecrets({ ...noLocal, KMS_MODE: "aws", KMS_KEY_ID: "alias/hrms-pii" } as any)).toEqual([]);
  });
  it("an outbox mailer, localhost links or an emulator SES endpoint are not production mail", () => {
    expect(assertEmailFlow({ MAIL_MODE: "outbox", APP_WEB_URL: "http://localhost:3410" } as any).length).toBeGreaterThan(1);
    expect(assertEmailFlow({ MAIL_MODE: "ses", AWS_REGION: "eu-west-1", AWS_ENDPOINT_URL: "http://floci:4566", APP_WEB_URL: "https://app.example.com", MAIL_FROM: "a@example.com" } as any).join()).toMatch(/emulator/);
    expect(assertEmailFlow({ MAIL_MODE: "ses", AWS_REGION: "eu-west-1", APP_WEB_URL: "https://app.example.com", MAIL_FROM: "a@example.com" } as any)).toEqual([]);
  });
  it("storage on local disk is flagged, S3 without a bucket too", () => {
    expect(assertStorage({ STORAGE: "local" } as any).length).toBe(1);
    expect(assertStorage({ STORAGE: "s3", AWS_REGION: "eu-west-1" } as any).join()).toMatch(/S3_BUCKET/);
    expect(assertStorage({ STORAGE: "s3", AWS_REGION: "eu-west-1", S3_BUCKET: "b" } as any)).toEqual([]);
  });
});

describe("Sessions and suspension", () => {
  it("tenant sessions carry their own audience", () => expect(TENANT_AUD).toBe("tenant"));
  it("a suspended or cancelled workspace is blocked with a machine-readable code", () => {
    for (const status of ["SUSPENDED", "CANCELLED"]) {
      const e = workspaceBlock({ status });
      expect(e?.status).toBe(403);
      expect(e?.code).toBe("WORKSPACE_SUSPENDED");
    }
  });
  it("active and unverified workspaces are not blocked here", () => {
    expect(workspaceBlock({ status: "ACTIVE" })).toBeNull();
    expect(workspaceBlock({})).toBeNull();
    expect(workspaceBlock(null)).toBeNull();
  });
});

describe("Logs and markup", () => {
  it("onboarding link tokens are masked in access logs", () => {
    expect(redactUrl("/api/onboarding/public/abc123secret/submit")).toBe("/api/onboarding/public/[redacted]/submit");
    expect(redactUrl("/api/onboarding/public/abc123secret?x=1")).toBe("/api/onboarding/public/[redacted]?x=1");
    expect(redactUrl("/api/employees")).toBe("/api/employees");
  });
  it("escapeHtml neutralises markup in names sent by email", () => {
    expect(escapeHtml(`<img src=x onerror="a()">&'`)).toBe("&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;");
    expect(escapeHtml(null)).toBe("");
  });
});

describe("Tenant settings instead of build-time constants", () => {
  it("a workspace without settings gets a neutral letterhead", () => {
    const b = brandFor({ name: "Initech", slug: "initech" });
    expect(b.name).toBe("Initech");
    expect(b.signatory).toEqual({ name: "Authorised Signatory", title: "" });
    expect(b.website).toBe("");
  });
  it("configured letterhead facts win", () => {
    const b = brandFor({ name: "Initech", website: "https://initech.example", tagline: "TPS", signatory: { name: "Bill L", title: "VP" }, branding: { color: "#123456" } });
    expect([b.website, b.tagline, b.signatory.name, b.color]).toEqual(["https://initech.example", "TPS", "Bill L", "#123456"]);
  });
  it("official addresses use the configured domain, then a verified sending domain, then a reserved name", () => {
    expect(domainForOrg({ slug: "initech", officialEmailDomain: "Initech.Example" })).toBe("initech.example");
    expect(domainForOrg({ slug: "initech", emailDomain: { domain: "mail.initech.example", status: "VERIFIED" } })).toBe("mail.initech.example");
    expect(domainForOrg({ slug: "initech", emailDomain: { domain: "mail.initech.example", status: "PENDING" } })).toBe("initech.example");
  });
});

describe("AWS client settings", () => {
  it("one region for every service unless a service overrides it", () => {
    const prev = { ...process.env };
    process.env.AWS_REGION = "eu-west-1";
    process.env.SES_REGION = "eu-central-1";
    expect(awsRegion("s3")).toBe("eu-west-1");
    expect(awsRegion("ses")).toBe("eu-central-1");
    process.env = prev;
  });
  it("an emulator endpoint applies to every client, and a service endpoint wins", () => {
    const prev = { ...process.env };
    process.env.AWS_ENDPOINT_URL = "http://floci:4566";
    process.env.S3_ENDPOINT = "http://minio:9000";
    expect(awsClientConfig("kms").endpoint).toBe("http://floci:4566");
    expect(awsClientConfig("s3").endpoint).toBe("http://minio:9000");
    process.env = prev;
  });
});
