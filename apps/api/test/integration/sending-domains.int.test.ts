/**
 * Workspace sending domains, end to end through SES.
 *
 * Every workspace can send its mail from its own domain. The lifecycle under test:
 *
 *   1. an admin adds mail.<domain>: the API creates the SES identity (Easy DKIM + a
 *      MAIL FROM subdomain) and returns the DNS records to publish
 *   2. until those records exist the domain is PENDING and mail keeps going out from the
 *      platform's verified address, never from the unverified domain (SES would reject it)
 *   3. the records are published (this test plays the workspace's DNS admin and writes
 *      them to Route53), the check flips the domain to VERIFIED and adopts a From address
 *   4. mail now leaves from the workspace's own domain; other workspaces are unaffected
 *   5. removing the domain deletes the SES identity and reverts to the platform sender
 *
 * Runs whenever the API is pointed at SES on an emulator (MAIL_MODE=ses with
 * AWS_ENDPOINT_URL, as in `make test-matrix`); the emulator verifies an identity only once
 * its DKIM CNAMEs are present in its Route53, exactly like AWS. Delivered mail is read
 * back from Mailpit, which the emulator relays to.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Route53Client,
  CreateHostedZoneCommand,
  ChangeResourceRecordSetsCommand,
  DeleteHostedZoneCommand,
  ListResourceRecordSetsCommand,
} from "@aws-sdk/client-route-53";
import { SESv2Client, GetEmailIdentityCommand } from "@aws-sdk/client-sesv2";
import { ACCOUNTS, client, seedFixtures, startServer } from "./fixtures";

const ON_EMULATOR = process.env.MAIL_MODE === "ses" && !!process.env.AWS_ENDPOINT_URL;
const MAILPIT = (process.env.MAILPIT_URL || "http://localhost:8025").replace(/\/$/, "");
const APEX = `acme-${Date.now().toString(36)}.example.com`;
const DOMAIN = `mail.${APEX}`;

type MailpitMessage = { From: { Address: string; Name: string }; To: { Address: string }[]; Subject: string };

async function mailTo(address: string, subjectIncludes: string): Promise<MailpitMessage | undefined> {
  for (let i = 0; i < 20; i++) {
    const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`);
    const d = (await r.json()) as { messages: MailpitMessage[] };
    const hit = d.messages.find((m) => m.Subject.includes(subjectIncludes));
    if (hit) return hit;
    await new Promise((res) => setTimeout(res, 250));
  }
  return undefined;
}

describe.skipIf(!ON_EMULATOR)("Workspace sending domains (SES)", () => {
  let server: { base: string; close: () => Promise<void> };
  let api: ReturnType<typeof client>;
  let admin = "";
  let zoneId = "";
  let records: { type: string; name: string; value: string; priority?: number; purpose?: string }[] = [];
  const r53 = new Route53Client({ region: process.env.AWS_REGION || "us-east-1", endpoint: process.env.AWS_ENDPOINT_URL });
  const ses = new SESv2Client({ region: process.env.AWS_REGION || "us-east-1", endpoint: process.env.AWS_ENDPOINT_URL });

  beforeAll(async () => {
    await seedFixtures();
    server = await startServer();
    api = client(server.base);
    admin = await api.login(ACCOUNTS.acmeAdmin);
    // A delegated zone for the sending subdomain, a common real-world setup.
    const zone = await r53.send(new CreateHostedZoneCommand({ Name: DOMAIN, CallerReference: DOMAIN }));
    zoneId = zone.HostedZone!.Id!.replace("/hostedzone/", "");
  });

  afterAll(async () => {
    // Leave the emulator as we found it.
    const all = await r53.send(new ListResourceRecordSetsCommand({ HostedZoneId: zoneId })).catch(() => null);
    const owned = (all?.ResourceRecordSets || []).filter((rr) => rr.Type !== "NS" && rr.Type !== "SOA");
    if (owned.length) {
      await r53.send(new ChangeResourceRecordSetsCommand({ HostedZoneId: zoneId, ChangeBatch: { Changes: owned.map((rr) => ({ Action: "DELETE", ResourceRecordSet: rr })) } })).catch(() => undefined);
    }
    await r53.send(new DeleteHostedZoneCommand({ Id: zoneId })).catch(() => undefined);
    await server?.close();
  });

  it("adding a domain creates the SES identity and returns the records to publish", async () => {
    const add = await api.call("POST", "/api/email-domain", admin, { domain: DOMAIN });
    expect(add.status).toBe(201);
    expect(add.data.status).toBe("PENDING");
    records = add.data.dnsRecords;
    expect(records.filter((x) => x.purpose === "DKIM" || x.type === "CNAME").length).toBe(3);
    expect(records.some((x) => x.type === "MX" && x.name === `bounce.${DOMAIN}`)).toBe(true);
    const identity = await ses.send(new GetEmailIdentityCommand({ EmailIdentity: DOMAIN }));
    expect(identity.DkimAttributes?.Status).not.toBe("SUCCESS");
    // Workspace domains get the platform's configuration set (TLS, suppression), not none.
    if (process.env.SES_CONFIGURATION_SET) expect(identity.ConfigurationSetName).toBe(process.env.SES_CONFIGURATION_SET);
  });

  it("while the domain is unverified, mail still goes out from the platform address", async () => {
    const t = await api.call("POST", "/api/email-domain/test", admin, {});
    expect(t.status).toBe(200);
    expect(t.data.usingCustomDomain).toBe(false);
    expect(t.data.delivered).toBe(true);
    const got = await mailTo(ACCOUNTS.acmeAdmin, "sending domain test");
    expect(got?.From.Address).not.toContain(DOMAIN);
  });

  it("a check before the records exist stays PENDING", async () => {
    const c = await api.call("POST", "/api/email-domain/check", admin, {});
    expect(c.status).toBe(200);
    expect(c.data.status).toBe("PENDING");
  });

  it("publishing the records verifies the domain and adopts a From address on it", { timeout: 60_000 }, async () => {
    const changes = records.map((rec) => ({
      Action: "UPSERT" as const,
      ResourceRecordSet: {
        Name: rec.name,
        Type: rec.type as any,
        TTL: 300,
        ResourceRecords: [{ Value: rec.type === "TXT" ? `"${rec.value}"` : rec.type === "MX" ? `${rec.priority ?? 10} ${rec.value}` : rec.value }],
      },
    }));
    await r53.send(new ChangeResourceRecordSetsCommand({ HostedZoneId: zoneId, ChangeBatch: { Changes: changes } }));
    // SES verifies asynchronously once DNS is in place (minutes on AWS, seconds on the
    // emulator), so check again until it settles, as an admin clicking "Check" would.
    let c = await api.call("POST", "/api/email-domain/check", admin, {});
    for (let i = 0; i < 30 && c.data.status !== "VERIFIED"; i++) {
      await new Promise((res) => setTimeout(res, 1000));
      c = await api.call("POST", "/api/email-domain/check", admin, {});
    }
    expect(c.data.status, JSON.stringify({ dkim: c.data.dkimStatus, mailFrom: c.data.mailFromStatus })).toBe("VERIFIED");
    expect(c.data.fromAddress).toBe(`hr@${DOMAIN}`);
  });

  it("mail now leaves from the workspace's own domain", async () => {
    const t = await api.call("POST", "/api/email-domain/test", admin, {});
    expect(t.data.usingCustomDomain).toBe(true);
    expect(t.data.from).toContain(`@${DOMAIN}`);
    expect(t.data.delivered).toBe(true);
    const got = await mailTo(ACCOUNTS.acmeAdmin, "sending domain test");
    expect(got).toBeTruthy();
  });

  it("another workspace keeps sending from the platform address", async () => {
    const other = await api.login(ACCOUNTS.globexAdmin);
    const t = await api.call("POST", "/api/email-domain/test", other, {});
    expect(t.data.usingCustomDomain).toBe(false);
    expect(t.data.from).not.toContain(DOMAIN);
  });

  it("a second workspace cannot claim the same domain", async () => {
    const other = await api.login(ACCOUNTS.globexAdmin);
    const claim = await api.call("POST", "/api/email-domain", other, { domain: DOMAIN });
    expect(claim.status).toBeGreaterThanOrEqual(400);
    expect(claim.status).toBeLessThan(500);
  });

  it("removing the domain deletes the SES identity and reverts to the platform sender", async () => {
    const del = await api.call("DELETE", "/api/email-domain", admin);
    expect(del.status).toBe(200);
    await expect(ses.send(new GetEmailIdentityCommand({ EmailIdentity: DOMAIN }))).rejects.toThrow();
    const t = await api.call("POST", "/api/email-domain/test", admin, {});
    expect(t.data.usingCustomDomain).toBe(false);
  });
});
